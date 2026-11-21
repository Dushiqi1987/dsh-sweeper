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
const root = path.resolve(here, '..')             // test/
const repo = path.resolve(here, '..', '..')       // package root

const STATIC = {
  '/': path.join(here, 'page.html'),
  '/client.js': path.join(repo, 'lib', 'client.js'),
  '/react.js': path.join(root, 'node_modules', 'react', 'umd', 'react.development.js'),
  '/react-dom.js': path.join(root, 'node_modules', 'react-dom', 'umd', 'react-dom.development.js'),
}

const ITEM = (key, size, days, extra) => ({
  key, path: key, kind: 'scratch', tier: extra && extra.tier || 'safe',
  size, mtime: Date.now() - days * 86400000, ageDays: days,
  refs: 0, uses: 0, failed: false, tracked: false,
  reasons: [extra && extra.reason || 'temporary script under .scratch, never referenced again'],
  session: { id: 'session-1e39c0aa', title: 'P4b mock launch' },
  tool: 'write', turn: 3, step: 2, at: Date.now() - days * 86400000,
})

const REPORT = {
  token: 'tk-harness',
  trashRoot: 'C:\\Users\\demo\\.dsh\\plugin-data\\dsh-sweeper\\trash',
  ageMs: 1200, durationMs: 9700, weekDays: 7, truncated: false, unreadable: 0,
  lastError: null,
  stats: { sessions: 46, events: 100464, calls: 16400, artifacts: 578, errors: 420, openJobs: 6, ms: 9700 },
  protected: { recent: 66, live: 15, tracked: 0, gone: 92, unsafe: 0 },
  tiers: { safe: { count: 2, bytes: 6003 }, unsure: { count: 1, bytes: 1786 } },
  items: [
    ITEM('D:\\OpenFuture\\.scratch\\launch-p4b.ps1', 896, 12),
    ITEM('D:\\OpenFuture\\.scratch\\probe.sh', 39, 12),
    ITEM('D:\\OpenFuture\\.scratch\\graph-restore.ts', 1786, 9, { tier: 'unsure', reason: 'temp file, but a later call read it once' }),
  ],
}

const SESSIONS = [
  { id: 'session-1e39c0aa', title: 'P4b mock launch', cwd: 'D:\\OpenFuture', ageDays: 12, toolCalls: 61, candidates: 5, estTokens: 994 },
  { id: 'session-aa8200b1', title: 'ICCV figure export', cwd: 'C:\\Users\\demo\\Desktop\\iccv', ageDays: 21, toolCalls: 130, candidates: 3, estTokens: 1180 },
  { id: 'session-458d1c02', title: 'v02a UI smoke', cwd: 'D:\\OpenFuture', ageDays: 8, toolCalls: 22, candidates: 2, estTokens: 640 },
]

const SWEEP = [
  ITEM('D:\\OpenFuture\\.scratch\\launch-p4b.ps1', 896, 12),
  ITEM('D:\\OpenFuture\\.scratch\\probe.sh', 39, 12),
  ITEM('D:\\OpenFuture\\.scratch\\start-p4b-mock.ps1', 851, 12),
  ITEM('D:\\OpenFuture\\.scratch\\launch-p3.2.ps1', 960, 14),
  ITEM('D:\\OpenFuture\\.scratch\\v02a-ui-test.mjs', 8399, 11),
  ITEM('C:\\Users\\demo\\Desktop\\iccv\\tmp\\figure-32.png', 41210, 20),
  ITEM('C:\\Users\\demo\\Desktop\\iccv\\tmp\\plot_ablation.py', 2210, 20),
]

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
    rejected: finished ? [{ path: 'C:\\Users\\demo\\Desktop\\iccv\\weights\\model.pth', reason: 'larger than 50 MB' }] : [],
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

  if (p === '/plugins/dsh-sweeper/report') return json(res, 200, REPORT)
  if (p === '/plugins/dsh-sweeper/trash') return json(res, 200, { root: REPORT.trashRoot, batches: [] })
  if (p === '/plugins/dsh-sweeper/deep/plan') {
    const sessions = REAL ? realSessions : SESSIONS
    const totalEstTokens = sessions.reduce((n, s) => n + (s.estTokens || 0), 0)
    return json(res, 200, { sessions, skipped: 9, week: 7, concurrency: REAL ? REAL.concurrency : 4, totalEstTokens })
  }
  if (p === '/plugins/dsh-sweeper/deep/start' && req.method === 'POST') {
    start = Date.now(); polls = 0
    const n = REAL ? realSessions.length : SESSIONS.length
    const est = (REAL ? realSessions : SESSIONS).reduce((a, s) => a + (s.estTokens || 0), 0)
    return json(res, 202, { jobId: 'job-harness', sessions: n, estTokens: est, concurrency: 4 })
  }
  if (p === '/plugins/dsh-sweeper/deep/status') return json(res, 200, { job: start ? status() : null })
  if (p === '/plugins/dsh-sweeper/deep/cancel') return json(res, 200, { ok: true })
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
