// Tiny replay server: serves the real client bundle plus a fake API.
// Purpose: render the actual settings page in a real browser and watch
// "whoever returns first updates first" without touching the real DSH host.
//
//   node test/browser/server.mjs              # synthetic payload (deterministic staging)
//   REAL=1 node test/browser/server.mjs       # replay the last on-disk selftest capture
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
// The page's ?stale= is remembered: the delete POST carries no query of its own.
let STALE = process.env.STALE || ''
const LOST = process.env.LOST || ''
const root = path.resolve(here, '..')             // test/
const repo = path.resolve(here, '..', '..')       // package root

const STATIC = {
  '/': path.join(here, 'page.html'),
  '/client.js': path.join(repo, 'lib', 'client.js'),
  '/react.js': path.join(root, 'node_modules', 'react', 'umd', 'react.development.js'),
  '/react-dom.js': path.join(root, 'node_modules', 'react-dom', 'umd', 'react-dom.development.js'),
}

import { ITEM, REPORT, SESSIONS, SWEEP } from './fixtures.mjs'

// ── optional: replay the last capture written by the in-host selftest ──────
let REAL = null
let REAL_REVIEW = null
if (process.env.REAL) {
  try {
    const raw = await readFile(path.join(os.homedir(), '.dsh', 'plugin-data', 'dsh-sweeper', 'selftest-out.json'), 'utf8')
    const cap = JSON.parse(raw)
    REAL = cap.deep || null
    REAL_REVIEW = cap.review || null
  } catch (e) {
    console.error('REAL=1 but no capture:', e.message)
  }
}

const realSessions = REAL ? REAL.sessions.map(s => ({
  id: s.id, title: s.title, cwd: s.cwd, ageDays: s.ageDays,
  toolCalls: s.toolCalls, candidates: s.candidates, estTokens: s.estTokens,
})) : []

let start = 0
let polls = 0

function status() {
  polls += 1
  const el = polls * 900

  if (REAL) {
    // one real conversation: keep the row queued for two polls so the
    // "whoever returns first" progression is still visible, then reveal the
    // model's own verdicts one item per poll.
    const sessions = REAL.sessions.map(s => polls < 2
      ? { ...s, status: 'queued', ms: 0, found: 0 }
      : { ...s, status: 'done', ms: s.ms || 7778, found: s.candidates })
    // verdicts land one per poll, so the page shows the model's own list grow
    const revealed = Math.max(0, Math.min(REAL.sweep.length, polls - 1))
    const finished = polls >= REAL.sweep.length + 2
    return {
      id: REAL.id, state: finished ? 'done' : 'running', startedAt: start || Date.now(),
      ms: REAL.ms, week: REAL.week, concurrency: REAL.concurrency, model: REAL.model,
      totals: { ...REAL.totals, done: finished ? 1 : 0, ms: el },
      sessions,
      sweep: REAL.sweep.slice(0, revealed),
      optional: REAL.optional || [],
      rejected: (REAL.rejected || []).slice(0, revealed ? undefined : 0),
    }
  }

  // synthetic mode: the pool returns out of order on purpose (2 → 3 → 1)
  const doneAt = [4, 2, 3]
  const sessions = SESSIONS.map((s, i) => {
    const done = polls >= doneAt[i]
    return { ...s, status: done ? 'done' : 'queued', ms: done ? 1500 + i * 400 : 0, error: null, found: done ? (i === 0 ? 5 : i === 1 ? 2 : 0) : 0 }
  })
  const finished = sessions.filter(s => s.status === 'done').length
  const state = finished === sessions.length ? 'done' : 'running'
  return {
    id: 'job-harness', state, startedAt: start || Date.now(), ms: el, week: 7,
    concurrency: 4, model: 'opencode-go/deepseek-v4.1-flash',
    totals: { sessions: sessions.length, done: finished, failed: 0, candidates: 10, estTokens: 2814, ms: el },
    sessions,
    sweep: finished ? SWEEP : [],
    optional: [],
    rejected: finished ? [{ path: 'C:\\Users\\demo\\Desktop\\iccv\\weights\\model.pth', reason: '超过 50 MB，不在建议范围内' }] : [],
  }
}

function json(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local')
  const p = url.pathname
  if (process.env.LOG_REQ === '1') console.log('REQ', req.method, p, url.searchParams.toString())

  // Error walkthrough: FAIL=report,deep,trash,start makes the chosen endpoints
  // misbehave so the error cards and retry affordances can be inspected.
  const FAIL = new Set(String(process.env.FAIL || '').split(',').filter(Boolean))
  const boom = (name, status, message) => {
    if (!FAIL.has(name)) return false
    if (name === 'report') json(res, status, { error: message, token: null })
    else json(res, status, { error: message })
    return true
  }

  if (req.method === 'GET' && STATIC[p]) {
    try {
      const body = await readFile(STATIC[p])
      const type = p.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'
      res.writeHead(200, { 'content-type': type })
      return res.end(body)
    } catch (e) {
      res.writeHead(404); return res.end('missing ' + p)
    }
  }

  // Empty walkthrough: EMPTY=1 (or ?empty=1) answers every endpoint with an
  // empty result, so the four tabs' empty states can be read side by side.
  const EMPTY = process.env.EMPTY === '1' || url.searchParams.get('empty') === '1'
  const emptyReport = () => ({ ...REPORT, items: [],
    stats: { ...REPORT.stats, candidates: 0, sessions: 0, toolCalls: 0 },
    tiers: { safe: { count: 0, bytes: 0 }, unsure: { count: 0, bytes: 0 } } })

  if (p === '/plugins/dsh-sweeper/report') {
    if (url.searchParams.get('stale')) STALE = url.searchParams.get('stale')
    if (boom('report', 500, 'scan failed while reading the session logs')) return
    return json(res, 200, EMPTY ? emptyReport() : REPORT)
  }
  if (p === '/plugins/dsh-sweeper/trash') {
    if (boom('trash', 500, 'the quarantine index could not be read')) return
    if (EMPTY) return json(res, 200, { root: REPORT.trashRoot, batches: [] })
    return json(res, 200, {
    root: REPORT.trashRoot,
    batches: [
      { id: 'mreplay1-aaaaaa', count: 5, bytes: 11068, createdAt: 1795278403226, note: 'deep review' },
      { id: 'mreplay2-bbbbbb', count: 1, bytes: 76317, createdAt: 1795192003226, note: 'scan' },
      { id: 'mreplay3-cccccc', count: 2, bytes: 4120, createdAt: 1795105003226, note: 'model proposal' },
    ],
  })
  }
  if (p === '/plugins/dsh-sweeper/deep/plan') {
    if (boom('deep', 503, 'the model provider is not reachable right now')) return
    if (EMPTY) return json(res, 200, { sessions: [], skipped: 0, week: 7, concurrency: 4, totalEstTokens: 0 })
    const sessions = REAL ? realSessions : SESSIONS
    const totalEstTokens = sessions.reduce((n, s) => n + (s.estTokens || 0), 0)
    return json(res, 200, { sessions, skipped: 9, week: 7, concurrency: REAL ? REAL.concurrency : 4, totalEstTokens })
  }
  if (p === '/plugins/dsh-sweeper/deep/start' && req.method === 'POST') {
    if (boom('start', 502, 'model call failed: provider returned 502')) return
    start = Date.now(); polls = 0
    const n = REAL ? realSessions.length : SESSIONS.length
    const est = (REAL ? realSessions : SESSIONS).reduce((a, s) => a + (s.estTokens || 0), 0)
    return json(res, 202, { jobId: 'job-harness', sessions: n, estTokens: est, concurrency: 4 })
  }
  // LOST=1 simulates the host forgetting a running job — exactly what happens
  // after a DSH restart, which is also what a plugin reload is.
  if (p === '/plugins/dsh-sweeper/deep/status') {
    if (LOST === '1' && start) return json(res, 200, { job: null })
    return json(res, 200, { job: start ? status() : null })
  }
  if (p === '/plugins/dsh-sweeper/deep/cancel') return json(res, 200, { ok: true })
  // Stale-tab walkthrough: `?stale=gone` answers a delete with every row
  // refused (another tab cleaned them first), `?stale=409` answers with the
  // out-of-date token error. Both are states a second tab really hits.
  if (p === '/plugins/dsh-sweeper/delete' && req.method === 'POST') {
    if (boom('delete', 500, 'the quarantine rejected every path')) return
    if (STALE === '409') {
      return json(res, 409, { error: 'this list is out of date because the report was refreshed elsewhere; scanning again', stale: true })
    }
    if (STALE === 'gone') {
      return json(res, 200, {
        batch: null, moved: [], failed: [], items: REPORT.items,
        refused: REPORT.items.map((i) => ({ path: i.path, key: i.key, reason: 'gone' })),
      })
    }
    return json(res, 200, {
      batch: { id: 'mreplay3-cccccc', count: REPORT.items.length, bytes: 6003 },
      moved: REPORT.items.map((i) => i.key), failed: [], refused: [], items: [],
    })
  }
  if (p === '/plugins/dsh-sweeper/review' && req.method === 'POST') {
    console.log('review hit', new Date().toISOString(), JSON.stringify(req.headers).slice(0,120))
    if (process.env.REAL && REAL_REVIEW) return json(res, 200, REAL_REVIEW)
    return json(res, 200, {
      model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, ms: 9600,
      reviewed: REPORT.items.length, skipped: 0, note: 'harness', tiers: REPORT.tiers,
      auto: REPORT.items.filter(i => i.tier === 'safe').slice(0, 2),
      asks: REPORT.items.filter(i => i.tier === 'unsure').slice(0, 1)
        .map(i => ({ key: i.key, path: i.path, tier: i.tier, size: i.size, question: 'harness: still needed?' })),
      kept: [], unknown: [], failed: [], moved: 0, movedBytes: 0,
      extra: { sweep: [], optional: [], rejected: [], hints: 0, moved: 0, movedBytes: 0 },
    })
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'no route ' + p }))
})

const port = Number(process.env.PORT || 8731)
server.listen(port, '127.0.0.1', () => console.log('ready http://127.0.0.1:' + port + '/' + (REAL ? ' (real capture)' : '')))
