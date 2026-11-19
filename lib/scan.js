/**
 * dsh-sweeper · static scan of tool-execution traces.
 *
 * Read-only: the only filesystem effects are `stat`, and (optionally) `git ls-files`.
 * Nothing here deletes, moves, writes into a session, or touches an attachment object.
 */

import { execFile } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path'
import { WIN, isAbsPath, joinPath, normKey as pathKey, isInside } from './paths.js'

const WEEK = 7 * 24 * 60 * 60 * 1000
const DSH_HOME_KEY = normKey(String(process.env.DSH_HOME || join(homedir(), '.dsh')))
const AGENTS_HOME_KEY = normKey(join(homedir(), '.agents'))

const insideDsh = (key) => isInside(key, DSH_HOME_KEY) || isInside(key, AGENTS_HOME_KEY)
const PAGE = 2000

const PRODUCER_TOOLS = new Set(['write', 'ops_write_file', 'edit', 'ops_edit_file'])
const PATH_ARGS = ['file_path', 'path', 'source_path', 'target_path', 'output_path', 'dest', 'files']

const SCRATCH = /(?:[\\/]\.scratch(?:[\\/]|$)|[\\/]tmp[\\/]|[\\/]temp[\\/]|_tmp|(?:^|[\\/])repro-|(?:^|[\\/])shot-|\.tmp$|\.bak$|__pycache__)/i
/** Paths that are unambiguously machine scratch space (not just "written by the agent"). */
const DEEP_TEMP = /(?:[\\/]\.scratch[\\/]|[\\/]tmp[\\/]|[\\/]temp[\\/]|__pycache__[\\/]|\.bak$|\.tmp$)/i
const SPILL = /(?:^|[\\/])dsh-spill-[^\\/]+[\\/]/i
const SPILL_TEXT = /(?:stored at:\s*)?((?:[A-Za-z]:[\\/]|\/)[^\r\n"]*?dsh-spill-[^\r\n"]*?\.(?:txt|log|json|md|html|xml|csv))/i

function normKey(p) {
  return pathKey(p)
}

function idOf(entry) {
  if (!entry) return null
  if (entry.id) return entry.id
  if (entry.sessionId) return entry.sessionId
  const h = entry.header
  if (h && (h.id || h.sessionId)) return h.id || h.sessionId
  return null
}

function spilledBy(sessionId, spillPath) {
  const uuid = String(sessionId || '').replace(/^session-/, '').replace(/-/g, '')
  if (uuid.length < 12) return false
  return String(spillPath).toLowerCase().includes('session-' + uuid.slice(0, 12).toLowerCase())
}

function last2(key) {
  const parts = key.split(WIN ? '\\' : '/').filter(Boolean)
  return parts.slice(-2).join(WIN ? '\\' : '/')
}

function toks(text) {
  const out = []
  if (!text) return out
  const t = text.length > 200_000 ? text.slice(0, 200_000) : text
  const abs = /(?:[A-Za-z]:[\\/]|\/)[^\s"'<>|*?\n]{2,400}/g
  const rel = /(?:^|[\s"'`(:=])((?:\.{0,2}[\\/])?(?:[\w.@$-]+[\\/]){1,12}[\w.@$-]+\.[A-Za-z0-9]{1,8})(?=$|[\s"'`),:;\]}])/g
  let m
  while ((m = abs.exec(t))) out.push({ raw: m[0], abs: true })
  while ((m = rel.exec(t))) out.push({ raw: m[1], abs: false })
  return out
}

function textOf(ev) {
  const d = ev && ev.data
  if (!d) return ''
  if (typeof d.arguments === 'string') return d.arguments
  const msg = d.message
  if (msg && Array.isArray(msg.content)) {
    let s = ''
    for (const c of msg.content) if (c && typeof c.text === 'string') s += c.text + '\n'
    return s
  }
  return ''
}

async function forEachEvent(handle, fn) {
  const limit = 200_000
  let off = 0
  for (;;) {
    let page
    try { page = await handle.read(off, PAGE) } catch { return }
    const evs = Array.isArray(page) ? page : (page && page.events) || []
    if (!evs.length) return
    for (const ev of evs) fn(ev)
    off += evs.length
    if (evs.length < PAGE) return
    if (off > limit) return
  }
}

function statOf(p) {
  try {
    const st = statSync(p)
    return { exists: true, size: st.size, mtime: st.mtimeMs, dir: st.isDirectory() }
  } catch {
    return { exists: false, size: 0, mtime: 0, dir: false }
  }
}

function gitTracked(p, cache) {
  const root = findRepo(p, cache)
  if (!root) return null
  return new Promise((resolve) => {
    const rel = p.slice(root.length).replace(/^[\\/]+/, '')
    execFile('git', ['-C', root, 'ls-files', '--error-unmatch', '--', rel], { timeout: 3000, windowsHide: true },
      (err) => resolve(err ? false : true))
  })
}

function findRepo(p, cache) {
  let dir = dirname(p)
  const seen = []
  for (;;) {
    if (cache.has(dir)) { const hit = cache.get(dir); for (const s of seen) cache.set(s, hit); return hit }
    seen.push(dir)
    try {
      if (statSync(dir + sep + '.git').isDirectory()) { for (const s of seen) cache.set(s, dir); return dir }
    } catch { /* keep walking */ }
    const up = dirname(dir)
    if (up === dir) { for (const s of seen) cache.set(s, null); return null }
    dir = up
  }
}

/**
 * @param {object} ctx cordis context (with sessions / sessionPersistence mounted)
 * @param {{now?: number, week?: number}} opts
 */

/**
 * Directory part of a scratch path, e.g.
 *   D:\OpenFuture\.scratch\shot-1.mjs -> D:\OpenFuture\.scratch
 *   ...\Temp\dsh-spill-abc\session-1\x.txt -> ...\Temp\dsh-spill-abc\session-1
 * Used only to decide where to *look* for hints; nothing here writes.
 */
const TEMP_ROOTS = (() => {
  const out = new Set()
  for (const v of [tmpdir(), process.env.TEMP, process.env.TMP]) {
    if (v) out.add(normKey(v).replace(/[\\/]+$/, ''))
  }
  return out
})()

function scratchRootOf(raw) {
  const s = String(raw || '')
  if (!s || s.includes('\ufffd') || s.includes('[object')) return null
  // dsh's own spill directory is an exact, unmistakable root
  const spill = s.match(/^(.*?[\\/]dsh-spill-[^\\/]+)[\\/]/i)
  if (spill) return spill[1]
  const m = s.match(/^(.*?[\\/](?:\.scratch|tmp|temp|__pycache__))[\\/]/i)
  if (!m) return null
  const root = m[1]
  // never walk the whole OS temp directory: it holds other apps' files
  if (TEMP_ROOTS.has(normKey(root).replace(/[\\/]+$/, ''))) return null
  return root
}

const HINT_LIMIT = 160
const HINT_DEPTH = 3
const HINT_SKIP = new Set(['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '.next', 'target'])

/** Files that live in a scratch directory but never appeared in any session log. */
function collectHints(roots, artifacts, cutoff, now) {
  const out = []
  const seen = new Set(artifacts.keys())
  const queue = roots.slice(0, 40).map((r) => ({ dir: r, depth: 0 }))
  while (queue.length && out.length < HINT_LIMIT) {
    const { dir, depth } = queue.shift()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (out.length >= HINT_LIMIT) break
      if (ent.isSymbolicLink()) continue
      const full = joinPath(dir, ent.name)
      if (ent.isDirectory()) {
        if (depth < HINT_DEPTH && !HINT_SKIP.has(ent.name.toLowerCase())) queue.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!ent.isFile()) continue
      const key = normKey(full)
      if (!key || seen.has(key)) continue
      const st = statOf(full)
      if (!st.exists || st.dir) continue
      if (st.mtime > cutoff) continue          // still fresh, or not provably idle
      seen.add(key)
      out.push({
        path: full,
        key,
        root: scratchRootOf(full) || dir,
        size: st.size,
        mtime: st.mtime,
        ageDays: Math.floor((now - st.mtime) / 86_400_000),
      })
    }
  }
  out.sort((a, b) => b.size - a.size)
  return out
}

export async function scan(ctx, opts = {}) {
  const started = Date.now()
  const now = opts.now ?? Date.now()
  const week = opts.week ?? WEEK
  const cutoff = now - week

  const persistence = ctx.get ? ctx.get('sessionPersistence') : ctx.sessionPersistence
  if (!persistence) throw new Error('sessionPersistence service is not available')
  const liveIds = new Set()
  try {
    const sessions = (ctx.get ? ctx.get('sessions') : ctx.sessions)
    const arr = sessions && typeof sessions.list === 'function' ? sessions.list() : []
    for (const s of arr || []) { const lid = idOf(s); if (lid) liveIds.add(String(lid)) }
  } catch { /* live detection is best effort */ }

  const snapshots = await persistence.list()
  const list = Array.isArray(snapshots) ? snapshots : [...(snapshots || [])]

  const artifacts = new Map()   // key -> record
  const suffix = new Map()      // last2 -> Set<key>
  const callMeta = new Map()    // callId -> {name, ok, time, turn, step}
  const unreadable = []
  const stats = { sessions: 0, events: 0, toolCalls: 0, errors: 0, openJobs: 0 }

  const titleOf = new Map()
  const addArtifact = (raw, producer) => {
    const key = normKey(raw)
    if (!key) return null
    let rec = artifacts.get(key)
    if (!rec) {
      rec = {
        key, raw, producers: [], firstTime: producer ? producer.time : 0,
        refCount: 0, lastRef: producer ? producer.time : 0, kind: 'other',
      }
      artifacts.set(key, rec)
      const s2 = last2(key)
      if (!suffix.has(s2)) suffix.set(s2, new Set())
      suffix.get(s2).add(key)
    }
    if (producer) {
      rec.producers.push(producer)
      if (!rec.firstTime || producer.time < rec.firstTime) rec.firstTime = producer.time
    }
    return rec
  }

  // ── pass 1: producers, spill paths, job bookkeeping ─────────────────────
  for (const snap of list) {
    const id = idOf(snap)
    if (!id) continue
    let handle
    try { handle = await persistence.open(id, 'read') } catch { unreadable.push(String(id)); continue }
    stats.sessions++
    const jobs = new Set()
    const localCalls = []
    try {
      await forEachEvent(handle, (ev) => {
        stats.events++
        const type = ev && ev.type
        const d = (ev && ev.data) || {}
        const time = (ev && ev.time) || 0
        if (type === 'session/title') {
          const t = d.title || (d.message && d.message.title) || ''
          if (typeof t === 'string' && t) titleOf.set(String(id), t)
        } else if (type === 'tool/call') {
          stats.toolCalls++
          const callId = d.callId || (d.message && d.message.toolCallId) || ''
          const meta = { name: d.name || '?', ok: true, time, turn: d.turn, step: d.step }
          callMeta.set(String(callId), meta)
          localCalls.push(String(callId))
          if (PRODUCER_TOOLS.has(meta.name)) {
            let args = {}
            try { args = JSON.parse(d.arguments || '{}') } catch { args = {} }
            for (const k of PATH_ARGS) {
              const v = args[k]
              if (typeof v === 'string' && v) {
                addArtifact(v, { sessionId: String(id), tool: meta.name, callId: String(callId), time, turn: d.turn, step: d.step })
              } else if (Array.isArray(v)) {
                for (const x of v) if (typeof x === 'string') addArtifact(x, { sessionId: String(id), tool: meta.name, callId: String(callId), time, turn: d.turn, step: d.step })
              }
            }
          }
        } else if (type === 'tool/result') {
          const msg = d.message || {}
          const callId = String(msg.toolCallId || d.callId || '')
          const meta = callMeta.get(callId)
          if (meta && msg.isError) { meta.ok = false; stats.errors++ }
          const text = textOf(ev)
          if (text) {
            const m = SPILL_TEXT.exec(text)
            if (m) {
              const p = m[1].replace(/\s+$/, '')
              addArtifact(p, {
                sessionId: String(id), tool: (meta && meta.name) || '?', callId,
                time, turn: d.turn, step: d.step, spill: true,
              })
            }
          }
        } else if (type === 'job/registered') {
          const jid = d.jobId || d.id
          if (jid) jobs.add(String(jid))
        } else if (type === 'job/settled') {
          const jid = d.jobId || d.id
          if (jid) jobs.delete(String(jid))
        }
      })
    } catch (err) {
      unreadable.push(String(id))
    } finally {
      try { await handle.close() } catch { /* ignore */ }
    }
    stats.openJobs += jobs.size
    const title = titleOf.get(String(id))
    if (title) for (const c of localCalls) { const m = callMeta.get(c); if (m) m.title = title }
  }

  // ── pass 2: references (any later text that names a known path) ─────────
  for (const snap of list) {
    const id = idOf(snap)
    if (!id || unreadable.includes(String(id))) continue
    let handle
    try { handle = await persistence.open(id, 'read') } catch { continue }
    const sid = String(id)
    try {
      await forEachEvent(handle, (ev) => {
        const type = ev && ev.type
        if (type !== 'tool/call' && type !== 'tool/result' && type !== 'assistant/message') return
        const time = (ev && ev.time) || 0
        const text = textOf(ev)
        if (!text) return
        const d = (ev && ev.data) || {}
        const callId = String(d.callId || (d.message && d.message.toolCallId) || '')
        // A real "use" is a later tool call that names the path as an argument
        // (running the script, reading the file). Plain mentions inside output
        // text still count for the 7-day protection, but not for the split.
        const strong = type === 'tool/call' && !!callId

        const bump = (k, t) => {
          const rec = artifacts.get(k)
          if (!rec || t <= rec.firstTime) return
          rec.refCount++
          if (t > rec.lastRef) { rec.lastRef = t; rec.lastRefSession = sid }
          if (!strong) return
          if (rec.producers.some((pr) => pr.callId === callId)) return
          if (!rec.useCalls) rec.useCalls = new Set()
          if (rec.useCalls.has(callId)) return
          rec.useCalls.add(callId)
          rec.uses = (rec.uses || 0) + 1
          if (t > (rec.lastUse || 0)) rec.lastUse = t
        }

        for (const t of toks(text)) {
          const key = t.abs ? normKey(t.raw) : null
          if (!key) {
            const parts = t.raw.replace(/\//g, '\\\\').split('\\\\').filter(Boolean)
            const s2 = parts.slice(-2).join('\\\\').toLowerCase()
            const set = suffix.get(s2)
            if (!set) continue
            for (const k of set) bump(k, time)
            continue
          }
          if (artifacts.has(key)) bump(key, time)
          else {
            const s2 = last2(key)
            const set = suffix.get(s2)
            if (set) for (const k of set) if (k.endsWith(key) || key.endsWith(k)) bump(k, time)
          }
        }
      })
    } catch { /* ignore */ } finally {
      try { await handle.close() } catch { /* ignore */ }
    }
  }

  // ── finalize ────────────────────────────────────────────────────────────
  const repoCache = new Map()
  const items = []
  const protectedCounts = { recent: 0, live: 0, tracked: 0, gone: 0, unsafe: 0 }

  for (const rec of artifacts.values()) {
    if (insideDsh(rec.key)) { protectedCounts.unsafe++; continue }
    const st = statOf(rec.raw)
    if (!st.exists || st.dir) { protectedCounts.gone++; continue }

    const producer = rec.producers[0] || null
    const meta = producer && producer.callId ? callMeta.get(producer.callId) : null
    const failed = !!(producer && producer.callId && callMeta.get(producer.callId) && callMeta.get(producer.callId).ok === false)
    const isSpill = SPILL.test(rec.key)
    const isScratch = !isSpill && SCRATCH.test(rec.key) && PRODUCER_TOOLS.has(producer ? producer.tool : '')
    const kind = isSpill ? 'spill' : isScratch ? 'scratch' : failed && st.size < 1024 ? 'failed' : 'other'
    if (kind === 'other') continue

    // Protection follows real use (a later tool call naming the path), not every
    // chat mention: otherwise the report's own output would protect its items.
    const lastUse = Math.max(rec.lastUse || 0, st.mtime || 0, rec.firstTime || 0)
    const age = now - lastUse
    const inLive = (producer && liveIds.has(producer.sessionId)) ||
      (isSpill && [...liveIds].some((lid) => spilledBy(lid, rec.key)))

    if (age < week) { protectedCounts.recent++; continue }
    if (inLive) { protectedCounts.live++; continue }

    const tracked = await gitTracked(rec.raw, repoCache)
    if (tracked === true) { protectedCounts.tracked++; continue }

    const uses = rec.uses || 0
    const reasons = []
    let tier = 'unsure'
    const clearlyTemp = DEEP_TEMP.test(rec.key)
    if (kind === 'spill') {
      reasons.push('遗留在系统临时目录的完整工具输出')
      if (uses === 0) { tier = 'safe'; reasons.push('之后再没被当文件打开或执行过') }
      else reasons.push('之后还被用过 ' + uses + ' 次')
    } else if (kind === 'scratch') {
      if (clearlyTemp && uses === 0 && !failed) {
        tier = 'safe'
        reasons.push('临时目录里的脚本/产物')
        reasons.push('产生后再没被用过')
      } else if (clearlyTemp) {
        if (uses > 0) reasons.push('临时目录，但之后还被用过 ' + uses + ' 次')
        else reasons.push('临时目录')
      } else {
        reasons.push('由 write/edit 写出，目录不像明确的临时目录')
      }
    }
    if (failed) { tier = 'unsure'; reasons.push('产生它的工具调用失败了，可能是半成品') }
    if (st.size > 1024 * 1024) { tier = 'unsure'; reasons.push('体积超过 1 MB') }

    items.push({
      path: rec.raw,
      key: rec.key,
      kind,
      tier,
      reasons,
      size: st.size,
      mtime: st.mtime,
      ageDays: Math.floor(age / 86_400_000),
      lastUseAt: lastUse,
      refs: rec.refCount,
      uses,
      failed,
      tracked,
      session: producer ? { id: producer.sessionId, title: (callMeta.get(producer.callId) || {}).title || titleOf.get(producer.sessionId) || null } : null,
      tool: producer ? producer.tool : null,
      turn: producer ? producer.turn : null,
      step: producer ? producer.step : null,
      at: rec.firstTime || null,
    })
  }

  const rootSet = new Set()
  for (const rec of artifacts.values()) {
    if (!SCRATCH.test(rec.key)) continue
    const r = scratchRootOf(rec.raw)
    if (r && !insideDsh(normKey(r)) && r.length < 180) rootSet.add(r)
  }
  let hints = []
  try { hints = collectHints([...rootSet], artifacts, cutoff, now) } catch { hints = [] }

  items.sort((a, b) => b.size - a.size || String(a.path).localeCompare(String(b.path)))
  const capped = items.slice(0, 2000)

  const tiers = { safe: { count: 0, bytes: 0 }, unsure: { count: 0, bytes: 0 } }
  for (const it of capped) { const t = tiers[it.tier] || tiers.unsure; t.count++; t.bytes += it.size }

  return {
    generatedAt: now,
    durationMs: Date.now() - started,
    weekDays: Math.round(week / 86_400_000),
    home: safeHome(),
    stats: {
      ...stats,
      artifacts: artifacts.size,
      candidates: items.length,
      listed: capped.length,
      liveSessions: liveIds.size,
      unreadableSessions: unreadable.length,
    },
    protected: protectedCounts,
    tiers,
    unreadable,
    items: capped,
    hints,
    truncated: items.length > capped.length,
  }
}

function safeHome() {
  try { return homedir() } catch { return '' }
}

export const _internal = { normKey, toks, last2, SCRATCH, DEEP_TEMP, SPILL, scratchRootOf, collectHints, gitTracked }
