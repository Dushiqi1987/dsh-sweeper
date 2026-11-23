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

import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { scan, _internal } from './scan.js'
import { dshHome, quarantine, restore, purge, listBatches, trashRoot, rejectionReason } from './trash.js'
import { review, applyVerdict } from './review.js'
import { planDeep, runDeep, vetDeepResult, forgetRestored } from './deep.js'

const BASE = '/plugins/dsh-sweeper'
const CACHE_MS = 60_000
const MAX_BODY = 1024 * 1024
const DAY = 24 * 60 * 60 * 1000

export const name = 'dsh-sweeper'

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {})

/**
 * Reject a browser-shaped request that is not same-origin ours.
 *
 * Only used when the Connection service (which owns DSH's authoritative
 * `requestRejection`) is absent — an older composition with a `webServer` but
 * no browser-authentication owner. Fail-closed on the three browser vectors a
 * plain route would otherwise accept:
 *   • `sec-fetch-site: cross-site` — a page on any origin driving this API;
 *   • an `Origin` that is not our own authority — the same, with CORS markers;
 *   • a non-loopback `Host` — DNS rebinding, where a name the attacker owns
 *     resolves to 127.0.0.1 so even `Origin === Host` looks "same-origin".
 * Non-browser callers (curl, scripts) carry no `Sec-Fetch-*`/`Origin` and a
 * loopback `Host`, so they keep working — the same shape DSH uses for `/api`.
 */
function fallbackRejection(req) {
  const headers = req && req.headers
  if (!headers || typeof headers !== 'object') return undefined
  const header = (name) => {
    const value = headers[name]
    return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
  }
  if (header('sec-fetch-site') === 'cross-site') return 403
  const host = header('host')
  const origin = header('origin')
  if (origin !== undefined && host !== undefined) {
    try {
      if (new URL(origin).host !== host) return 403
    } catch { return 403 }
  }
  if (host !== undefined) {
    const hostname = host.replace(/:\d+$/, '').toLowerCase()
    const loopback = hostname === 'localhost' || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    if (!loopback) return 403
  }
  return undefined
}

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
    // Bumped whenever something moved on disk (delete/restore). A scan that was
    // already running describes the disk as it was before that move, so the
    // pass checks this counter afterwards and runs once more if it changed.
    epoch: 0,
    passes: 0,
    routes: new Map(),
    extra: { sweep: [], optional: [], rejected: [], byKey: new Map() },
  }
  // The in-process self test lives outside apply(); it reaches the report through here.
  ctx.__sweeperState = state
  ctx.__sweeperNoteChanged = () => noteDiskChanged()

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

  // ── deep pass: one model call per idle conversation ───────────────────────
  // Each conversation knows what it was doing; the scan cannot. The model is
  // asked, per conversation, which of *that conversation's* leftovers are dead
  // weight. Its answer is untrusted like any other model output: an item only
  // becomes selectable when it is still the same file, is not tracked by git,
  // and (for the "safe" bucket) sits in a place the scan already treats as
  // throwaway space. Anything else lands in "optional" or is rejected.
  let deepJob = null
  let deepPlan = null
  let deep = null
  let deepPlanAt = 0

  const deepVet = (session, parsed) => vetDeepResult(session, parsed)

  const mergeDeep = (job) => {
    // A cancelled pass can still have a model call in flight when the next pass
    // starts. Its late callback must not repaint the page with the old rows.
    if (deepJob && job !== deepJob) return deep
    const byKey = new Map()
    const sweep = []
    const optional = []
    for (const id of job.order) {
      const s = job.sessions.get(id)
      if (!s) continue
      for (const it of s.items) {
        if (byKey.has(it.key)) continue
        byKey.set(it.key, it)
        ;(it.tier === 'safe' ? sweep : optional).push(it)
      }
    }
    const rejected = []
    for (const id of job.order) {
      const s = job.sessions.get(id)
      if (!s) continue
      for (const r of s.rejected || []) rejected.push(r)
    }
    deep = { job, byKey, sweep, optional, rejected }
    return deep
  }

  const planView = (plan) => ({
    generatedAt: Date.now(),
    week: plan.week,
    concurrency: plan.concurrency,
    totalEstTokens: plan.totalEstTokens,
    skipped: plan.skipped || 0,
    unreadable: plan.unreadable || 0,
    sessions: plan.sessions.map((s) => ({
      id: s.id, title: s.title, cwd: s.cwd, ageDays: s.ageDays, toolCalls: s.toolCalls,
      candidates: s.candidates, hidden: s.hidden || 0, estTokens: s.estTokens,
    })),
  })

  const deepView = (job) => ({
    id: job.id,
    state: job.state,
    startedAt: job.startedAt,
    ms: Date.now() - job.startedAt,
    week: job.week,
    concurrency: job.concurrency,
    model: job.model || null,
    totals: {
      sessions: job.order.length,
      done: job.done,
      failed: job.fail,
      candidates: job.order.reduce((n, id) => n + ((job.sessions.get(id) || {}).candidates || 0), 0),
      hidden: job.order.reduce((n, id) => n + ((job.sessions.get(id) || {}).hidden || 0), 0),
      estTokens: job.estTokens,
      ms: job.ms,
    },
    sessions: job.order.map((id) => {
      const s = job.sessions.get(id)
      return {
        id, title: s.title, cwd: s.cwd, ageDays: s.ageDays, toolCalls: s.toolCalls,
        candidates: s.candidates, estTokens: s.estTokens, status: s.status,
        ms: s.ms, error: s.error, found: s.items.length,
        debug: job.debug ? s.debug : undefined,
      }
    }),
    sweep: deep ? deep.sweep : [],
    optional: deep ? deep.optional : [],
    rejected: ((deep && deep.rejected) || []).concat(job.rejectedAll || []),
  })

  /** Publish a finished report: the token belongs to the report, not to one GET. */
  const publish = (report) => {
    if (report !== state.report) {
      state.report = report
      state.publishedAt = Date.now()
      state.token = randomBytes(9).toString('hex')
      state.byKey = new Map(report.items.map((it) => [it.key, it]))
      state.extra = { sweep: [], optional: [], rejected: [], byKey: new Map() }
      // A rescan while a deep pass is streaming must not orphan that pass: the
      // job keeps writing into `deep`, and the page keeps polling it. The rows
      // are re-checked against the disk when they are acted on, so keeping them
      // is safe even though the report they came from is gone.
      if (!deepJob || deepJob.state !== 'running') {
        deep = null
        deepJob = null
        deepPlan = null
        deepPlanAt = 0
      }
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
    // Coalesce: everyone who asks while a pass is in flight waits for the same
    // pass, and that promise only settles after the report is published. The
    // old shape cleared `state.running` in `finally` and published afterwards,
    // which left a window where a second caller saw no running pass and started
    // its own full scan on top of the one that had just finished.
    if (state.running) return state.running
    state.running = (async () => {
      try {
        let epoch = state.epoch
        let report = null
        for (let i = 0; i < 3; i++) {
          state.passes += 1
          report = await scan(ctx, { week: weekDays * DAY })
          if (state.epoch === epoch) break
          epoch = state.epoch
        }
        state.lastError = null
        return publish(report)
      } catch (err) {
        state.lastError = (err && err.message) || String(err)
        try { ctx.logger && ctx.logger.warn && ctx.logger.warn('[dsh-sweeper] scan failed: %s', state.lastError) } catch { /* ignore */ }
        throw err
      } finally {
        state.running = null
      }
    })()
    return state.running
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
    // A client that goes away mid-body would otherwise leave this promise (and
    // whatever the route holds next to it) pending forever.
    req.on('close', () => done(reject, fail(400, 'request closed before the body arrived')))
  })

  // The Connection service is read per request, not captured at registration:
  // webServer and connection arrive independently, and a late-arriving
  // authenticator must still fence the routes registered before it.
  const rejectionFor = (req) => {
    let connection
    try { connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined } catch { connection = undefined }
    return typeof connection?.requestRejection === 'function'
      ? connection.requestRejection(req)
      : fallbackRejection(req)
  }

  const handle = (fn) => async (req, res) => {
    const rejection = rejectionFor(req)
    if (rejection !== undefined) {
      if (!res.writableEnded && !res.headersSent) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
      }
      return
    }
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
    if (body.token !== state.token) {
      // A second tab (or a rescan) rotated the token. The selection on that page
      // points at a list that no longer exists, so say so plainly and tell the
      // page it may refresh by itself.
      throw fail(409, 'this list is out of date because the report was refreshed elsewhere; scanning again', { stale: true })
    }
  }

  /**
   * Note that the disk changed: a scan in flight will run again after it, and
   * the deep plan must be recomputed because its candidate counts came from
   * stat() at plan time. Invalidating the plan here (instead of at each call
   * site) is the fix for a miss: `/review` cleaned files and left the plan
   * cache alone, so the next minute still served rows for files in the bin.
   */
  const noteDiskChanged = () => {
    state.epoch += 1
    state.publishedAt = 0
    deepPlanAt = 0
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
    const route = (path, fn) => {
      state.routes.set(path, fn)
      ctx.__sweeperRoutes = state.routes
      return inner.effect(() => web.register({ kind: 'exact', path, handler: handle(fn) }), 'dsh-sweeper: ' + path)
    }

    route(BASE + '/report', async (req, res) => {
      // `run` already coalesces concurrent callers onto one pass and resolves
      // with the published view, so a second `publish` here would hand the
      // report a fresh token while the page is still holding the old one.
      const force = /[?&]refresh=1/.test(String((req && req.url) || ''))
      sendJSON(res, 200, await run(force))
    })

    route(BASE + '/delete', async (req, res) => {
      const body = await readBody(req)
      requireToken(body)
      const keys = Array.isArray(body.keys) ? [...new Set(body.keys.map(String))].slice(0, 5000) : []
      if (!keys.length) throw fail(400, 'no keys selected')
      if (body.confirmed !== true) throw fail(400, 'confirmation required')

      const deepPick = body.deep === true
      const extraPick = body.extra === true
      const source = deepPick ? (deep ? deep.byKey : new Map()) : extraPick ? state.extra.byKey : state.byKey
      const picked = []
      const refused = []
      for (const key of keys) {
        if (deepPick && !deep) {
          refused.push({ key, reason: 'the deep pass has no results yet' })
          continue
        }
        const item = source.get(key)
        if (!item) {
          refused.push({
            key,
            reason: deepPick ? 'not in the current deep results' : extraPick ? 'not in the current model proposals' : 'not in the current report',
          })
          continue
        }
        picked.push(item)
      }
      if (!picked.length) {
        sendJSON(res, 200, { batch: null, moved: [], failed: [], refused, tiers: state.report ? state.report.tiers : null, items: state.report ? state.report.items.length : 0 })
        return
      }
      if (picked.some((it) => it.tier === 'unsure') && body.acknowledge !== true) {
        throw fail(400, 'selection contains uncertain items; acknowledge them explicitly')
      }
      const note = body.note || (deepPick ? 'deep review' : extraPick ? 'model proposal' : 'manual selection')
      const result = await quarantine(picked, { note })
      noteDiskChanged()
      let tiers
      if (deepPick) {
        const gone = new Set(result.moved || [])
        for (const id of deepJob ? deepJob.order : []) {
          const row = deepJob.sessions.get(id)
          if (row) row.items = row.items.filter((it) => !gone.has(it.key))
        }
        if (deepJob) mergeDeep(deepJob)
        tiers = state.report ? state.report.tiers : null
      } else if (extraPick) {
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
      sendJSON(res, 200, { ...result, movedBytes, refused, tiers, deep: deepPick ? deepView(deepJob) : undefined, items: state.report ? state.report.items.length : 0 })
    })

    // Dynamic pass: one model opinion over the current candidate list. Items the
    // model marks delete AND that are tier 'safe' are moved to the trash right
    // away; everything else becomes a question for the user.
    route(BASE + '/review', async (req, res) => {
      const body = await readBody(req)
      requireToken(body)
      if (state.reviewing) throw fail(409, 'a model review is already running')
      const report = state.report
      const tokenAt = state.token
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
        // A rescan during the model call replaces the token. Acting on the old
        // list would move files the user is no longer looking at.
        if (state.token !== tokenAt) {
          sendJSON(res, 409, { error: 'the report changed while the model was reading it; nothing was moved — rescan and try again' })
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
          noteDiskChanged()
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

    // ── deep pass ────────────────────────────────────────────────────────────
    // Step 1 costs nothing but log reads and says how much the review would
    // cost in tokens, so the page can ask before anything is sent anywhere.
    route(BASE + '/deep/plan', async (req, res) => {
      const force = /[?&]refresh=1/.test(String((req && req.url) || ''))
      const cached = !force && !!deepPlan && Date.now() - deepPlanAt < cacheMs
      if (cached) {
        sendJSON(res, 200, { ...planView(deepPlan), cached: true, plannedAt: deepPlanAt })
        return
      }
      const plan = await planDeep(ctx, { week: weekDays, limit: 24 })
      deepPlan = plan
      deepPlanAt = Date.now()
      sendJSON(res, 200, { ...planView(plan), cached: false, plannedAt: deepPlanAt })
    })

    // Step 2: send each idle conversation's digest to the model, at most four
    // at a time, and merge each answer as it lands (the UI poll /deep/status).
    route(BASE + '/deep/start', async (req, res) => {
      const body = await readBody(req)
      requireToken(body)
      if (body.consent !== true) throw fail(400, 'this sends conversation summaries to your model; confirm it explicitly')
      if (deepJob && deepJob.state === 'running') throw fail(409, 'a deep pass is already running')
      let plan = (!deepPlan || body.refresh === true) ? await planDeep(ctx, { week: weekDays, limit: 24 }) : deepPlan
      const cap = Number(body.maxSessions)
      // `maxSessions` only limits this run. Caching the slice would make the
      // page show "1 conversation" for the next minute after a test run.
      const runPlan = (Number.isFinite(cap) && cap > 0 && plan.sessions.length > cap)
        ? { ...plan, sessions: plan.sessions.slice(0, cap) }
        : plan
      deepPlan = plan
      deepPlanAt = Date.now()
      if (!runPlan.sessions.length) {
        sendJSON(res, 200, { jobId: null, sessions: 0, reason: 'no idle conversation still owns files' })
        return
      }
      const job = {
        id: randomUUID().slice(0, 8),
        startedAt: Date.now(),
        state: 'running',
        week: weekDays,
        concurrency: Math.max(1, Math.min(Number(body.concurrency) || runPlan.concurrency, 8)),
        model: body.model && body.model.model ? String(body.model.model) : null,
        done: 0,
        fail: 0,
        ms: 0,
        estTokens: runPlan.sessions.reduce((n, s) => n + (s.estTokens || 0), 0),
        order: runPlan.sessions.map((s) => s.id),
        sessions: new Map(),
        cancelled: false,
        debug: body.debug === true,
        // Aborting this stops the calls that are already streaming, so 停止
        // does not keep spending tokens on the queued conversations.
        abort: typeof AbortController === 'function' ? new AbortController() : null,
      }
      for (const s of runPlan.sessions) {
        job.sessions.set(s.id, { ...s, status: 'queued', ms: 0, error: null, items: [] })
      }
      if (!job.model) {
        try {
          const sel = ctx.get('agentDefaultModel')
          const pick = sel && typeof sel.currentSelection === 'function' ? sel.currentSelection() : null
          if (pick && pick.provider && pick.model) job.model = pick.provider + '/' + pick.model
        } catch (err) { /* the label is cosmetic; never block the pass */ }
      }
      deepJob = job
      deep = null
      runDeep(ctx, runPlan.sessions, {
        concurrency: job.concurrency,
        model: body.model,
        timeoutMs: body.timeoutMs,
        signal: job.abort ? job.abort.signal : undefined,
        onResult: async (session, payload) => {
          const row = job.sessions.get(session.id)
          if (!row) return
          try {
            if (job.cancelled) { row.status = 'cancelled'; return }
            if (!payload.ok) {
              row.status = 'failed'
              row.error = payload.error || 'model call failed'
              job.fail += 1
              mergeDeep(job)
              return
            }
            if (job.debug) {
              row.debug = {
                estTokens: payload.estTokens,
                digestChars: payload.digestChars,
                parsed: payload.parsed,
                trace: payload.trace,
                raw: String(payload.raw || '').slice(0, 1500),
              }
            }
            const veto = await deepVet(row, payload.parsed)
            row.items = veto.sweep.concat(veto.optional)
            row.rejected = veto.rejected
            row.status = 'done'
            row.ms = payload.ms || 0
            row.estTokens = payload.estTokens || row.estTokens
            job.done += 1
            if (job.rejectedAll === undefined) job.rejectedAll = []
            job.rejectedAll = job.rejectedAll.concat(veto.rejected)
            mergeDeep(job)
          } catch (err) {
            row.status = 'failed'
            row.error = 'vetting failed: ' + ((err && err.message) || String(err))
            job.fail += 1
            mergeDeep(job)
          }
        },
      }).then(() => {
        // anything the pool never got to is cancelled, not left looking queued
        for (const row of job.sessions.values()) if (row.status === 'queued') row.status = 'cancelled'
        job.state = job.cancelled ? 'cancelled' : 'done'
        job.ms = Date.now() - job.startedAt
        mergeDeep(job)
      }).catch((err) => {
        job.state = 'failed'
        job.ms = Date.now() - job.startedAt
        job.error = (err && err.message) || String(err)
      })
      sendJSON(res, 202, { jobId: job.id, sessions: job.order.length, estTokens: job.estTokens, concurrency: job.concurrency })
    })

    route(BASE + '/deep/status', async (req, res) => {
      if (!deepJob) { sendJSON(res, 200, { job: null }); return }
      sendJSON(res, 200, { job: deepView(deepJob) })
    })

    route(BASE + '/deep/cancel', async (req, res) => {
      const body = await readBody(req)
      if (!deepJob || deepJob.state !== 'running') throw fail(409, 'no deep pass is running')
      if (body.jobId && body.jobId !== deepJob.id) throw fail(409, 'that deep pass is not the current one')
      deepJob.cancelled = true
      if (deepJob.abort) { try { deepJob.abort.abort() } catch (err) { /* already aborted */ } }
      sendJSON(res, 200, { cancelled: true, jobId: deepJob.id })
    })


    route(BASE + '/trash', async (req, res) => {
      sendJSON(res, 200, { root: trashRoot(), batches: await listBatches() })
    })

    route(BASE + '/restore', async (req, res) => {
      const body = await readBody(req)
      const result = await restore(body.batchId)
      // Files that just went back to their old places must not stay on the page
      // as candidates: otherwise the next "clean" click would drop them into the
      // bin again, which makes restore look like it did nothing.
      // One call covers all three caches: the report, the scan-in-flight epoch
      // and the deep plan counts.
      noteDiskChanged()
      forgetRestored(deep, deepJob, result.restoredPaths)
      if (deepJob) mergeDeep(deepJob)
      if (state.extra) forgetRestored(state.extra, null, result.restoredPaths)
      sendJSON(res, 200, result)
    })

    route(BASE + '/purge', async (req, res) => {
      const body = await readBody(req)
      if (body.confirmed !== true) throw fail(400, 'confirmation required')
      const gone = await purge(body.batchId)
      if (gone.missing) throw fail(404, 'that batch is already gone')
      sendJSON(res, 200, gone)
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
        passes: state.passes,
        reviewing: state.reviewing,
        trashRoot: trashRoot(),
        weekDays,
      })
    })
  })

  applySelfTest(ctx)
}

// ── in-process self test ───────────────────────────────────────────────────
// The HTTP routes sit behind DSH's browser trust check, so a terminal cannot
// call them. When `<plugin-data>/selftest.json` exists at load, this drives the
// real handlers in-process instead: scan → deep plan → one conversation's model
// call → the exact JSON the page polls. It never calls /delete or /purge.
const SELFTEST_REPORT = 'selftest-out.json'

function makeFakeRequest(method, url, body) {
  const listeners = new Map()
  const req = {
    method,
    url,
    headers: { 'x-dsh-sweeper': '1', 'content-type': 'application/json' },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
      return req
    },
    destroy() {},
  }
  setTimeout(() => {
    const emit = (event, value) => (listeners.get(event) || []).forEach((fn) => fn(value))
    if (body !== undefined) emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
    emit('end')
  }, 0)
  return req
}

function makeFakeResponse(resolve) {
  return {
    statusCode: 0,
    headersSent: false,
    writeHead(code, headers) { this.statusCode = code; this.headersSent = true; this.headers = headers },
    setHeader() {},
    end(payload) { resolve({ status: this.statusCode || 200, body: String(payload == null ? '' : payload) }) },
    write() {},
  }
}

export function applySelfTest(ctx) {
  const dir = dshHome() + '/plugin-data/dsh-sweeper'
  const trigger = dir + '/selftest.json'
  if (!existsSync(trigger)) return
  let triggerCfg = {}
  try { triggerCfg = JSON.parse(readFileSync(trigger, 'utf8')) || {} } catch (err) { triggerCfg = {} }
  setTimeout(async () => {
    const out = { at: new Date().toISOString(), steps: [], timeline: [], error: null }
    const call = (method, path, body) =>
      new Promise((resolve, reject) => {
        const fn = ctx.__sweeperRoutes && ctx.__sweeperRoutes.get(String(path).split('?')[0])
        if (!fn) return reject(new Error('route not found: ' + path))
        const res = makeFakeResponse(resolve)
        Promise.resolve(fn(makeFakeRequest(method, path, body), res)).catch(reject)
      })
    try {
      const t0 = Date.now()
      // Test-only: pretend something moved while the scan is running, so the
      // pass has to notice the epoch change and read the disk again.
      if (triggerCfg.mutateDuringScan) {
        setTimeout(() => {
          try { ctx.__sweeperNoteChanged(); out.mutatedAt = Date.now() - t0 } catch { /* ignore */ }
        }, 400)
      }
      const scanOut = await call('GET', '/plugins/dsh-sweeper/report?refresh=1')
      const report = JSON.parse(scanOut.body)
      out.scanPasses = ctx.__sweeperState ? ctx.__sweeperState.passes : null
      out.steps.push({ step: 'scan', status: scanOut.status, items: (report.items || []).length, tiers: report.tiers, protected: report.protected, unreadable: (report.unreadable || []).length, truncated: !!report.truncated, scanMs: report.durationMs })
      const planOut = await call('GET', '/plugins/dsh-sweeper/deep/plan?refresh=1')
      const plan = JSON.parse(planOut.body)
      out.steps.push({ step: 'plan', status: planOut.status, sessions: (plan.sessions || []).length, estTokens: plan.estTokens, concurrency: plan.concurrency })
      if (triggerCfg.deep === false) {
        out.note = 'deep step skipped by trigger'
      } else if (!plan.sessions || !plan.sessions.length) {
        out.note = 'no idle conversation still owns files; nothing was sent to the model'
      } else {
        const startOut = await call('POST', '/plugins/dsh-sweeper/deep/start', {
          token: report.token,
          consent: true,
          maxSessions: Math.max(1, Math.min(Number(triggerCfg.sessions) || 1, 12)),
          concurrency: Math.max(1, Math.min(Number(triggerCfg.concurrency) || 1, 4)),
          debug: triggerCfg.debug === true,
        })
        const started = JSON.parse(startOut.body)
        out.steps.push({ step: 'start', status: startOut.status, jobId: started.jobId, sessions: started.sessions, estTokens: started.estTokens })
        if (Number(triggerCfg.cancelAfterMs) > 0) {
          setTimeout(() => {
            call('POST', '/plugins/dsh-sweeper/deep/cancel', { jobId: started.jobId })
              .then((r) => out.steps.push({ step: 'cancel', status: r.status, at: Date.now() - t0 }))
              .catch((err) => out.steps.push({ step: 'cancel', status: 'error', error: String(err && err.message) }))
          }, Number(triggerCfg.cancelAfterMs))
        }
        let status = null
        for (let i = 0; i < 150; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          const st = await call('GET', '/plugins/dsh-sweeper/deep/status')
          const parsed = JSON.parse(st.body)
          status = parsed.job
          if (status) {
            out.timeline.push({
              t: Date.now() - t0,
              done: status.totals ? status.totals.done : 0,
              failed: status.totals ? status.totals.failed : 0,
              rows: (status.sessions || []).map((row) => row.id.slice(0, 12) + ':' + row.status),
            })
          }
          if (!status || status.state !== 'running') break
        }
        out.deep = status
        out.steps.push({ step: 'status', state: status && status.state, sweep: status ? status.sweep.length : 0, optional: status ? status.optional.length : 0, rejected: status ? status.rejected.length : 0 })
      }
      // Test-only: let the trigger hand the review pass a fixture list. Nothing
      // is ever moved from here — the review call below runs with autoDelete off.
      // Read-only check of the stale-tab contract: a wrong token must be
      // refused *before* anything is looked at, and the refusal must say the
      // list is out of date so the page can refresh itself.
      if (triggerCfg.staleToken) {
        // Either shape is fine here: the handler may answer 409 or reject with
        // the same error object. What matters is that no file was touched.
        let stale = { status: 0, stale: false, error: '' }
        try {
          const r = await call('POST', '/plugins/dsh-sweeper/delete', {
            token: 'token-from-another-tab', keys: [], confirmed: true,
          })
          let body = {}
          try { body = JSON.parse(r.body) } catch { body = {} }
          stale = { status: r.status, stale: body.stale === true, error: body.error || '' }
        } catch (err) {
          stale = { status: (err && err.status) || 0, stale: !!(err && err.stale), error: (err && err.message) || String(err) }
        }
        out.staleToken = stale
        out.steps.push({ step: 'stale-token', status: stale.status, stale: stale.stale })
      }

      // Read-only check of the plan cache: after the plugin notes a disk change,
      // the next plan must be recomputed instead of served from the 60s cache.
      // Test-only: hand back the published report so the replay fixtures can be
      // checked against a real response instead of a hand-written one.
      if (triggerCfg.captureReport && ctx.__sweeperState && ctx.__sweeperState.report) {
        out.reportView = ctx.__sweeperState.report
        out.steps.push({ step: 'report-view', items: out.reportView.items.length })
      }

      if (triggerCfg.planStale) {
        const first = JSON.parse((await call('GET', '/plugins/dsh-sweeper/deep/plan?refresh=1')).body)
        try { ctx.__sweeperNoteChanged() } catch { /* older host */ }
        const second = JSON.parse((await call('GET', '/plugins/dsh-sweeper/deep/plan')).body)
        const invalidated = second.plannedAt !== first.plannedAt
        out.planStale = { before: first.plannedAt, after: second.plannedAt, invalidated, cached: second.cached === true }
        out.steps.push({ step: 'plan-stale', invalidated, cached: second.cached === true })
      }

      if (Array.isArray(triggerCfg.items) && triggerCfg.items.length) {
        const items = triggerCfg.items.map((it, n) => ({
          key: it.key, path: it.path, tier: it.tier === 'unsure' ? 'unsure' : 'safe',
          kind: it.kind || 'scratch', size: it.size || 0, mtime: it.mtime || Date.now(),
          ageDays: it.ageDays || 10, refs: 0, uses: 0, failed: false,
          reasons: ['fixture'], origin: 'fixture', n: n + 1,
        }))
        const safe = items.filter((i) => i.tier === 'safe')
        const bytes = (arr) => arr.reduce((n, i) => n + (i.size || 0), 0)
        const tiers = {
          safe: { count: safe.length, bytes: bytes(safe) },
          unsure: { count: items.length - safe.length, bytes: bytes(items) - bytes(safe) },
        }
        const st = ctx.__sweeperState
        if (st && st.report) st.report = Object.assign({}, st.report, { items, tiers })
        out.steps.push({ step: 'fixture', items: items.length, tiers })
      }
      if (triggerCfg.review === true) {
        const revOut = await call('POST', '/plugins/dsh-sweeper/review', { token: report.token, autoDelete: false })
        const rev = JSON.parse(revOut.body)
        out.steps.push({
          step: 'review', status: revOut.status, model: rev.model, ms: rev.ms,
          reviewed: rev.reviewed, auto: (rev.auto || []).length, asks: (rev.asks || []).length,
          unknown: (rev.unknown || []).length, extra: rev.extra ? {
            hints: rev.extra.hints, sweep: (rev.extra.sweep || []).length,
            optional: (rev.extra.optional || []).length, rejected: (rev.extra.rejected || []).length,
          } : null,
        })
        out.review = rev
      }
      out.ms = Date.now() - t0
    } catch (err) {
      out.error = (err && err.message) || String(err)
    }
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(dir + '/' + SELFTEST_REPORT, JSON.stringify(out, null, 2), 'utf8')
      unlinkSync(trigger)
    } catch { /* ignore */ }
  }, 2000)
}

export const inject = ['webServer']
