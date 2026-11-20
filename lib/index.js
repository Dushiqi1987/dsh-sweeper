/**
 * dsh-sweeper · host half.
 *
 * Read-only scan + user-initiated, reversible cleanup:
 *   GET  /plugins/dsh-sweeper/report        report (cached, ?refresh=1 re-scans)
 *   POST /plugins/dsh-sweeper/delete        move selected items into a trash batch
 *   GET  /plugins/dsh-sweeper/trash         list trash batches
 *   POST /plugins/dsh-sweeper/restore       move a batch back
 *   POST /plugins/dsh-sweeper/purge         permanently remove a batch
 *   POST /plugins/dsh-sweeper/review        one model opinion over the candidates
 *   GET  /plugins/dsh-sweeper/health        scan state
 *
 * Deleting is only ever a rename into `DSH_HOME/plugin-data/dsh-sweeper/trash`
 * (see trash.js); nothing in this plugin unlinks a user file.
 */

import { randomBytes } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { scan, _internal } from './scan.js'
import { quarantine, restore, purge, listBatches, trashRoot } from './trash.js'
import { review, applyVerdict } from './review.js'

const BASE = '/plugins/dsh-sweeper'
const CACHE_MS = 60_000
const MAX_BODY = 1024 * 1024
const DAY = 24 * 60 * 60 * 1000

export const name = 'dsh-sweeper'

const fail = (status, message) => Object.assign(new Error(message), { status })

function recount(items) {
  const tiers = { safe: { count: 0, bytes: 0 }, unsure: { count: 0, bytes: 0 } }
  const kinds = {}
  for (const it of items) {
    const t = tiers[it.tier] === undefined ? tiers.unsure : tiers[it.tier]
    t.count += 1
    t.bytes += it.size || 0
    kinds[it.kind] = (kinds[it.kind] || 0) + 1
  }
  return { tiers, kinds }
}

export function apply(ctx, config = {}) {
  const state = {
    report: null,
    publishedAt: 0,
    token: null,
    byKey: new Map(),
    running: null,
    reviewing: false,
    lastError: null,
    extra: { sweep: [], optional: [], rejected: [], byKey: new Map() },
  }

  const svc = (c, key) => (typeof c.get === 'function' ? c.get(key) : c[key])
  const weekDays = Number(config.weekDays) > 0 ? Number(config.weekDays) : 7
  const cacheMs = Number(config.cacheSeconds) >= 0 ? Number(config.cacheSeconds) * 1000 : CACHE_MS

  /**
   * Model proposals are untrusted. Accept one only if it is literally one of the
   * files the scan itself observed, still exists unchanged, is not a link, is not
   * inside DSH/git, and is small enough to be a leftover. Anything else is dropped
   * with a reason (fail-closed, never "best effort").
   */
  const vetProposals = async (proposals, report) => {
    const known = new Map((report.hints || []).map((h) => [h.key, h]))
    const out = { sweep: [], optional: [], rejected: [] }
    const seen = new Set()
    for (const bucket of ['sweep', 'optional']) {
      for (const p of proposals[bucket] || []) {
        const h = known.get(p.key)
        if (!h) { out.rejected.push({ path: p.path, reason: 'not one of the files the scan observed' }); continue }
        if (seen.has(h.key)) continue
        const why = await checkProposal(h)
        if (why) { out.rejected.push({ path: h.path, reason: why }); continue }
        seen.add(h.key)
        out[bucket].push({ key: h.key, path: h.path, size: h.size, ageDays: h.ageDays, bucket })
      }
    }
    return out
  }

  const checkProposal = async (h) => {
    let st
    try { st = lstatSync(h.path) } catch { return 'the file is gone' }
    if (!st.isFile()) return st.isSymbolicLink() ? 'it is a link' : 'it is not a regular file'
    if (st.isSymbolicLink()) return 'it is a link'
    if (st.size !== h.size) return 'the file changed after the scan'
    if (st.size > 50 * 1024 * 1024) return 'larger than 50 MB'
    if (Math.abs(st.mtimeMs - h.mtime) > 2000) return 'the file changed after the scan'
    let tracked = 'unknown'
    try { tracked = await _internal.gitTracked(h.path, new Map()) } catch { tracked = 'unknown' }
    if (tracked === true) return 'tracked by git'
    if (tracked === 'unknown') return 'git could not confirm whether it is tracked'
    return ''
  }

  /** Publish a finished report: the token belongs to the report, not to one GET. */
  const publish = (report) => {
    if (report !== state.report) {
      state.report = report
      state.publishedAt = Date.now()
      state.token = randomBytes(9).toString('hex')
      state.byKey = new Map(report.items.map((it) => [it.key, it]))
      state.extra = { sweep: [], optional: [], rejected: [], byKey: new Map() }
    }
    return {
      ...report,
      token: state.token,
      trashRoot: trashRoot(),
      ageMs: Date.now() - state.publishedAt,
      lastError: state.lastError,
    }
  }

  const run = async (force) => {
    if (!force && state.report && Date.now() - state.publishedAt < cacheMs) return publish(state.report)
    if (state.running) return state.running.then(publish)
    state.running = (async () => {
      try {
        const report = await scan(ctx, { week: weekDays * DAY })
        state.lastError = null
        return report
      } catch (err) {
        state.lastError = (err && err.message) || String(err)
        try { ctx.logger && ctx.logger.warn && ctx.logger.warn('[dsh-sweeper] scan failed: %s', state.lastError) } catch { /* ignore */ }
        throw err
      } finally {
        state.running = null
      }
    })()
    return state.running.then(publish)
  }

  const sendJSON = (res, status, body) => {
    if (res.writableEnded || res.headersSent) return
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-length': Buffer.byteLength(text),
    })
    res.end(text)
  }

  const readBody = (req) => new Promise((resolve, reject) => {
    if (req.method !== 'POST') return reject(fail(405, 'POST required'))
    if (String(req.headers['x-dsh-sweeper'] || '') !== '1') return reject(fail(403, 'missing x-dsh-sweeper header'))
    let settled = false
    const done = (fn, value) => { if (settled) return; settled = true; fn(value) }
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      if (settled) return
      size += c.length
      if (size > MAX_BODY) {
        done(reject, fail(413, 'body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try { done(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { done(reject, fail(400, 'bad JSON')) }
    })
    req.on('error', (err) => done(reject, err))
    req.on('aborted', () => done(reject, fail(400, 'request aborted')))
  })

  const handle = (fn) => async (req, res) => {
    try { await fn(req, res) } catch (err) {
      sendJSON(res, (err && err.status) || 500, { error: (err && err.message) || String(err) })
    }
  }

  const requireReport = () => {
    if (!state.report) throw fail(409, 'no report yet; scan first')
    return state.report
  }

  const requireToken = (body) => {
    requireReport()
    if (body.token !== state.token) throw fail(409, 'report is stale; rescan')
  }

  const dropKeys = (keys) => {
    const gone = new Set(keys)
    state.report.items = state.report.items.filter((it) => !gone.has(it.key))
    state.byKey = new Map(state.report.items.map((it) => [it.key, it]))
    const { tiers, kinds } = recount(state.report.items)
    state.report.tiers = tiers
    state.report.stats.candidates = state.report.items.length
    state.report.stats.kinds = kinds
    return tiers
  }

  ctx.inject(['webServer'], (inner) => {
    const web = svc(inner, 'webServer')
    if (!web || typeof web.register !== 'function') return
    const route = (path, fn) => inner.effect(() => web.register({ kind: 'exact', path, handler: handle(fn) }), 'dsh-sweeper: ' + path)

    route(BASE + '/report', async (req, res) => {
      if (state.running) {
        const report = await state.running
        sendJSON(res, 200, publish(report))
        return
      }
      const force = /[?&]refresh=1/.test(String((req && req.url) || ''))
      sendJSON(res, 200, await run(force))
    })

    route(BASE + '/delete', async (req, res) => {
      const body = await readBody(req)
      requireToken(body)
      const keys = Array.isArray(body.keys) ? [...new Set(body.keys.map(String))].slice(0, 5000) : []
      if (!keys.length) throw fail(400, 'no keys selected')
      if (body.confirmed !== true) throw fail(400, 'confirmation required')

      const source = body.extra === true ? state.extra.byKey : state.byKey
      const picked = []
      const refused = []
      for (const key of keys) {
        const item = source.get(key)
        if (!item) {
          refused.push({ key, reason: body.extra === true ? 'not in the current model proposals' : 'not in the current report' })
          continue
        }
        picked.push(item)
      }
      if (!picked.length) {
        sendJSON(res, 200, { batch: null, moved: [], failed: [], refused, tiers: state.report.tiers })
        return
      }
      if (picked.some((it) => it.tier === 'unsure') && body.acknowledge !== true) {
        throw fail(400, 'selection contains uncertain items; acknowledge them explicitly')
      }
      const result = await quarantine(picked, { note: body.note || (body.extra === true ? 'model proposal' : 'manual selection') })
      let tiers
      if (body.extra === true) {
        const gone = new Set(result.moved || [])
        state.extra.sweep = state.extra.sweep.filter((it) => !gone.has(it.key))
        state.extra.optional = state.extra.optional.filter((it) => !gone.has(it.key))
        for (const k of gone) state.extra.byKey.delete(k)
        tiers = state.report.tiers
      } else {
        tiers = dropKeys(result.moved || [])
      }
      const sizeOf = new Map(picked.map((it) => [it.key, it.size || 0]))
      const movedBytes = (result.moved || []).reduce((n, k) => n + (sizeOf.get(k) || 0), 0)
      sendJSON(res, 200, { ...result, movedBytes, refused, tiers, items: state.report.items.length })
    })

    // Dynamic pass: one model opinion over the current candidate list. Items the
    // model marks delete AND that are tier 'safe' are moved to the trash right
    // away; everything else becomes a question for the user.
    route(BASE + '/review', async (req, res) => {
      const body = await readBody(req)
      requireToken(body)
      if (state.reviewing) throw fail(409, 'a model review is already running')
      const report = state.report
      state.reviewing = true
      try {
        let out
        try {
          out = await review(ctx, report, { model: body.model, timeoutMs: body.timeoutMs })
        } catch (err) {
          sendJSON(res, 502, {
            error: 'model review failed: ' + ((err && err.message) || String(err)),
            trace: (err && err.trace) || null,
          })
          return
        }
        const plan = applyVerdict(report, out.verdict)
        const veto = await vetProposals(out.proposals || {}, report)
        state.extra = {
          sweep: veto.sweep,
          optional: veto.optional,
          rejected: veto.rejected,
          byKey: new Map(veto.sweep.concat(veto.optional).map((it) => [it.key, it])),
        }
        let moved = []
        let movedBytes = 0
        let failed = []
        let batch = null
        const sizeOf = new Map(report.items.map((it) => [it.key, it.size || 0]))
        if (plan.auto.length && body.autoDelete !== false) {
          const result = await quarantine(plan.auto, { note: 'model review' })
          moved = result.moved || []
          failed = result.failed || []
          batch = result.batch
          movedBytes = moved.reduce((n, k) => n + (sizeOf.get(k) || 0), 0)
          if (moved.length) dropKeys(moved)
        }
        // Proposals are never acted on unless the caller opts in explicitly.
        let extraMoved = []
        let extraMovedBytes = 0
        if (body.extraAuto === true && state.extra.sweep.length) {
          const result = await quarantine(state.extra.sweep, { note: 'model proposal' })
          extraMoved = result.moved || []
          failed = failed.concat(result.failed || [])
          const gone = new Set(extraMoved)
          const extraSize = new Map(state.extra.sweep.map((it) => [it.key, it.size || 0]))
          extraMovedBytes = extraMoved.reduce((n, k) => n + (extraSize.get(k) || 0), 0)
          state.extra.sweep = state.extra.sweep.filter((it) => !gone.has(it.key))
          for (const k of gone) state.extra.byKey.delete(k)
        }
        sendJSON(res, 200, {
          model: out.model,
          ms: out.ms,
          reviewed: out.reviewed,
          skipped: out.skipped,
          note: out.verdict && out.verdict.note ? out.verdict.note : '',
          auto: plan.auto.map((it) => ({ key: it.key, path: it.path, size: it.size })),
          autoBytes: plan.auto.reduce((n, it) => n + (it.size || 0), 0),
          batch,
          moved,
          movedBytes,
          failed,
          asks: plan.asks,
          kept: plan.kept,
          unknown: plan.unknown.concat((out.unknownIds || []).map((x) => 'unmatched: ' + x)),
          extra: {
            sweep: state.extra.sweep,
            optional: state.extra.optional,
            rejected: state.extra.rejected,
            hints: out.hints || 0,
            moved: extraMoved,
            movedBytes: extraMovedBytes,
          },
          raw: body.debug ? out.raw : undefined,
          trace: out.trace,
          tiers: report.tiers,
          items: report.items.length,
        })
      } finally {
        state.reviewing = false
      }
    })

    route(BASE + '/trash', async (req, res) => {
      sendJSON(res, 200, { root: trashRoot(), batches: await listBatches() })
    })

    route(BASE + '/restore', async (req, res) => {
      const body = await readBody(req)
      const result = await restore(body.batchId)
      // The in-memory report no longer describes the disk: force a rescan.
      state.publishedAt = 0
      sendJSON(res, 200, result)
    })

    route(BASE + '/purge', async (req, res) => {
      const body = await readBody(req)
      if (body.confirmed !== true) throw fail(400, 'confirmation required')
      sendJSON(res, 200, await purge(body.batchId))
    })

    route(BASE + '/health', async (req, res) => {
      const r = state.report
      sendJSON(res, 200, {
        ok: true,
        error: state.lastError,
        hasReport: !!r,
        ageMs: r ? Date.now() - state.publishedAt : null,
        durationMs: r ? r.durationMs : null,
        items: r ? r.items.length : 0,
        tiers: r ? r.tiers : null,
        scanning: !!state.running,
        reviewing: state.reviewing,
        trashRoot: trashRoot(),
        weekDays,
      })
    })
  })
}

export const inject = ['webServer']
