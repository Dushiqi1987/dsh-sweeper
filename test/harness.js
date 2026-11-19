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
