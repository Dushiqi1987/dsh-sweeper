const fs = require('fs')
const path = require('path')
const React = require('react')
const { renderToString } = require('react-dom/server')

const SRC = path.join(__dirname, '..', 'lib', 'client.js')

global.window = { __ModuleLoader__: { load(cfg) { global.__cfg = cfg } } }
global.document = {
  getElementById() { return { remove() {} } },
  head: { appendChild() {} },
  createElement() { return {} },
  addEventListener() {}, removeEventListener() {},
}
global.location = { reload() {} }
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })

const seed = (k, d) => `(global.__SEED && global.__SEED.${k} !== undefined ? global.__SEED.${k} : ${d})`

let src = fs.readFileSync(SRC, 'utf8')
const swaps = [
  ["const [status, setStatus] = useState('loading')", `const [status, setStatus] = useState(${seed('status', "'loading'")})`],
  ['const [report, setReport] = useState(null)', `const [report, setReport] = useState(${seed('report', 'null')})`],
  ['const [error, setError] = useState(null)', `const [error, setError] = useState(${seed('error', 'null')})`],
  ['const [selected, setSelected] = useState(() => new Set())', `const [selected, setSelected] = useState(${seed('selected', 'new Set()')})`],
  ["const [tab, setTab] = useState('report')", `const [tab, setTab] = useState(${seed('tab', "'report'")})`],
  ['const [dialog, setDialog] = useState(null)', `const [dialog, setDialog] = useState(${seed('dialog', 'null')})`],
  ['const [busy, setBusy] = useState(false)', `const [busy, setBusy] = useState(${seed('busy', 'false')})`],
  ['const [toast, setToast] = useState(null)', `const [toast, setToast] = useState(${seed('toast', 'null')})`],
  ["const [trash, setTrash] = useState({ batches: [], root: '' })", `const [trash, setTrash] = useState(${seed('trash', "{ batches: [], root: '' }")})`],
  ['const [extraSel, setExtraSel] = useState(() => new Set())', `const [extraSel, setExtraSel] = useState(${seed('extraSelected', 'new Set()')})`],
  ['const [review, setReview] = useState(null)', `const [review, setReview] = useState(${seed('review', 'null')})`],
  ['const [reviewing, setReviewing] = useState(false)', `const [reviewing, setReviewing] = useState(${seed('reviewing', 'false')})`],
  ['const [reviewErr, setReviewErr] = useState(null)', `const [reviewErr, setReviewErr] = useState(${seed('reviewErr', 'null')})`],
  ['const [deepPlan, setDeepPlan] = useState(null)', `const [deepPlan, setDeepPlan] = useState(${seed('deepPlan', 'null')})`],
  ['const [deepJob, setDeepJob] = useState(null)', `const [deepJob, setDeepJob] = useState(${seed('deepJob', 'null')})`],
  ['const [deepPlanning, setDeepPlanning] = useState(false)', `const [deepPlanning, setDeepPlanning] = useState(${seed('deepPlanning', 'false')})`],
  ['const [deepConsent, setDeepConsent] = useState(false)', `const [deepConsent, setDeepConsent] = useState(${seed('deepConsent', 'false')})`],
  ['const [deepErr, setDeepErr] = useState(null)', `const [deepErr, setDeepErr] = useState(${seed('deepErr', 'null')})`],
  ['const [deepSel, setDeepSel] = useState(() => new Set())', `const [deepSel, setDeepSel] = useState(${seed('deepSelected', 'new Set()')})`],
]
for (const [a, b] of swaps) {
  if (!src.includes(a)) throw new Error('seed anchor missing: ' + a)
  src = src.replace(a, b)
}
src = src
  .replace(/^window\.__ModuleLoader__\.load\(\{/, '(function(){ const __cfg = ({')
  .replace(/\n\}\)\s*$/, '\n}); return __cfg })()')

const cfg = eval(src)
const mod = cfg.factory((n) => (n === 'react' ? React : require(n)))
let captured = null
mod.apply({ slots: { inject(n, run) { run() }, register(def, comp) { if (def.name === 'settings.section') captured = comp; return () => {} } } })
if (!captured) throw new Error('no settings.section component registered')

const now = Date.now()
const mk = (i, tier, o) => Object.assign({
  key: 'k' + i, path: 'D:\\OpenFuture\\.scratch\\shot-' + i + '.mjs', kind: 'scratch', tier,
  reasons: ['临时目录里的脚本/产物', '产生后再没被用过'], size: 1000 + i * 731, ageDays: 8 + i, uses: 0,
  failed: false, session: i % 2 ? { id: 's' + i, title: '会话 ' + i } : null, mtime: now,
}, o || {})
const items = [
  mk(1, 'safe'), mk(2, 'safe', { path: 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-spill-abc\\session-1\\x-web_fetch.txt', kind: 'spill', size: 66422 }),
  mk(3, 'safe', { path: 'D:\\OpenFuture\\proj\\tmp\\build-out\\index.js', size: 99122 }),
  mk(4, 'unsure', { path: 'D:\\OpenFuture\\.scratch\\launch-p3.2.ps1', reasons: ['临时目录，但之后还被用过 1 次'], uses: 1 }),
  mk(5, 'unsure', { kind: 'failed', failed: true, reasons: ['产生它的工具调用失败了，可能是半成品'], size: 640 }),
]
const report = {
  generatedAt: now - 60000, durationMs: 12649, weekDays: 7,
  trashRoot: 'C:\\Users\\x\\.dsh\\plugin-data\\dsh-sweeper\\trash',
  stats: { sessions: 46, events: 100464, toolCalls: 16400, errors: 420, openJobs: 6, artifacts: 578, candidates: 5, listed: 5, liveSessions: 15, unreadableSessions: 0 },
  protected: { recent: 66, live: 15, tracked: 0, gone: 71, unsafe: 2 },
  tiers: { safe: { count: 3, bytes: 167000 }, unsure: { count: 2, bytes: 3000 } },
  unreadable: [], truncated: false, token: 'tok', items,
}
const review = {
  model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, ms: 13866, reviewed: 5, skipped: 0, note: '看起来都是调试产物',
  moved: [items[0].key, items[1].key, items[2].key], movedBytes: 167000,
  batch: { id: 'mwm3flop-pekl0l', count: 3, bytes: 167000 },
  asks: [{ key: items[3].key, path: items[3].path, tier: 'unsure', size: items[3].size, question: '这个启动脚本用过一次，还要留着复用吗？' }],
  extra: {
    hints: 42,
    sweep: [
      { key: 'x1', path: 'D:\\OpenFuture\\.scratch\\build\\out\\bundle.js', size: 99122, ageDays: 21 },
      { key: 'x2', path: 'D:\\OpenFuture\\.scratch\\.cache\\types.d.ts', size: 4120, ageDays: 33 },
    ],
    optional: [
      { key: 'x3', path: 'D:\\OpenFuture\\.scratch\\notes\\case-study.md', size: 8123, ageDays: 14 },
      { key: 'x4', path: 'D:\\OpenFuture\\.scratch\\shot-2026-10.png', size: 220144, ageDays: 19 },
    ],
    rejected: [{ path: 'D:\\OpenFuture\\.scratch\\app.ts', reason: 'tracked by git' }],
  },
  unknown: ['unmatched: i99'], failed: [], kept: [],
}
const trash = { root: report.trashRoot, batches: [{ id: 'mwm3flop-pekl0l', createdAt: now - 5000, count: 3, bytes: 167000, note: 'model review' }] }

const deepRow = (i, o) => Object.assign({
  key: 'dk' + i, path: 'D:\\OpenFuture\\.scratch\\deep-' + i + '.py', tier: 'safe', kind: 'scratch',
  size: 3000 + i * 991, ageDays: 12 + i, refs: 0, uses: 0, failed: false,
  reasons: ['模型判断：临时脚本，摘要里没提要留'], origin: 'deep', session: { id: 'sess-' + i, title: '重构抓取脚本 ' + i },
}, o || {})
const deepSweep = [deepRow(1), deepRow(2, { path: 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-spill-zz\\session-9\\a-web_fetch.txt', kind: 'spill', size: 88213 })]
const deepOptional = [
  deepRow(3, { tier: 'unsure', path: 'D:\\OpenFuture\\.scratch\\launch.ps1', reasons: ['模型判断：像启动脚本，可能还要用'] }),
  deepRow(4, { tier: 'unsure', path: 'D:\\OpenFuture\\.scratch\\notes\\plan.md', size: 5120, reasons: ['模型判断：笔记文件，不确定'] }),
]
const deepPlan = {
  week: 7, concurrency: 4, totalEstTokens: 24180,
  sessions: [
    { id: 'sess-1', title: '重构抓取脚本', cwd: 'D:\\OpenFuture', ageDays: 12, toolCalls: 288, candidates: 4, estTokens: 9310 },
    { id: 'sess-2', title: '论文插图批处理', cwd: 'C:\\Users\\x\\Desktop\\iccv', ageDays: 19, toolCalls: 94, candidates: 2, estTokens: 6120 },
    { id: 'sess-3', title: '数据清洗脚本', cwd: 'D:\\OpenFuture', ageDays: 31, toolCalls: 402, candidates: 9, estTokens: 8750 },
  ],
}
const deepJob = {
  id: 'dp-1', state: 'running', startedAt: now - 22000, week: 7, concurrency: 4,
  model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
  totals: { sessions: 3, done: 1, failed: 0, candidates: 15, estTokens: 24180, ms: 22000 },
  sessions: [
    { id: 'sess-1', title: '重构抓取脚本', cwd: 'D:\\OpenFuture', ageDays: 12, toolCalls: 288, candidates: 4, estTokens: 9310, status: 'done', ms: 6800, found: 3 },
    { id: 'sess-2', title: '论文插图批处理', cwd: 'C:\\Users\\x\\Desktop\\iccv', ageDays: 19, toolCalls: 94, candidates: 2, estTokens: 6120, status: 'running' },
    { id: 'sess-3', title: '数据清洗脚本', cwd: 'D:\\OpenFuture', ageDays: 31, toolCalls: 402, candidates: 9, estTokens: 8750, status: 'queued' },
  ],
  sweep: deepSweep, optional: deepOptional, rejected: [{ path: 'D:\\OpenFuture\\.scratch\\keep.ts', reason: 'tracked by git' }],
}

const cases = [
  ['loading', { status: 'loading', report: null }],
  ['ready', { status: 'ready', report }],
  ['refreshing', { status: 'refreshing', report }],
  ['empty', { status: 'ready', report: { ...report, items: [], tiers: { safe: { count: 0, bytes: 0 }, unsure: { count: 0, bytes: 0 } } } }],
  ['error', { status: 'error', error: 'sessionPersistence service is not available' }],
  ['review', { status: 'ready', report, tab: 'review', review }],
  ['reviewSel', { status: 'ready', report, tab: 'review', review, extraSelected: new Set(['x3']) }],
  ['reviewErr', { status: 'ready', report, tab: 'review', reviewErr: 'model review failed: MissingSessionID' }],
  ['trash', { status: 'ready', report, tab: 'trash', trash }],
  ['dialog', { status: 'ready', report, dialog: { kind: 'delete', keys: [], count: 3, bytes: 167000, unsure: 1 } }],
  ['purge', { status: 'ready', report, tab: 'trash', trash, dialog: { kind: 'purge', batchId: 'mwm3flop-pekl0l', count: 3, bytes: 167000 } }],
  ['selected', { status: 'ready', report, selected: new Set([items[0].key, items[3].key]) }],
  ['deepPlan', { status: 'ready', report, tab: 'deep', deepPlan }],
  ['deepRun', { status: 'ready', report, tab: 'deep', deepPlan, deepJob }],
  ['deepSel2', { status: 'ready', report, tab: 'deep', deepPlan, deepJob, deepSelected: new Set(['dk3']) }],
  ['deepDone', { status: 'ready', report, tab: 'deep', deepPlan, deepJob: { ...deepJob, state: 'done', totals: { ...deepJob.totals, done: 3, candidates: 33 } } }],
  ['deepErr2', { status: 'ready', report, tab: 'deep', deepPlan, deepErr: 'model is not configured' }],
  ['deepDialog', { status: 'ready', report, tab: 'deep', deepPlan, deepJob, dialog: { kind: 'deepDelete', keys: ['dk1', 'dk3'], count: 2, bytes: 8912, unsure: 1 } }],
  ['deepSkip', { status: 'ready', report, tab: 'deep', deepPlan: { week: 7, concurrency: 4, totalEstTokens: 0, skipped: 9, sessions: [] } }],
  ['deepSkip2', { status: 'ready', report, tab: 'deep', deepPlan: { ...deepPlan, skipped: 9 } }],
  ['deepLost', { status: 'ready', report, tab: 'deep', deepPlan, deepJob: { ...deepJob, state: 'lost' }, deepErr: '后台已经没有这次分析的记录（DSH 可能重启过），返回的结果不会自己回来。' }],
]

let failed = 0
for (const [name, s] of cases) {
  global.__SEED = s
  try {
    const html = renderToString(React.createElement(captured))
    if (!html || html.length < 200) throw new Error('render produced ' + html.length + ' chars')
    const bad = html.match(/.{0,30}(undefined|NaN|\[object Object\]).{0,30}/)
    console.log((bad ? 'WARN ' : 'PASS ') + name.padEnd(10), String(html.length).padStart(5) + ' chars' + (bad ? '  ← ' + bad[0] : ''))
    if (bad) failed++
  } catch (err) {
    failed++
    console.log('FAIL ' + name + '\n    ' + String((err && err.stack) || err).split('\n').slice(0, 5).join('\n    '))
  }
}
console.log(failed ? 'PROBLEMS: ' + failed : 'ALL STATES OK')
process.exit(failed ? 1 : 0)
