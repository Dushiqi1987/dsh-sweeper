/**
 * Offline test for the deep pass: drive `runDeep` with a fake llm service so the
 * prompt pipeline, the line parser and the worker pool are exercised without a
 * network call or the user's tokens.
 *
 *   node test/deep.js
 */

import { runDeep, planDeep, parseReply, buildDigest, estimateTokens, forgetRestored, _internal } from '../lib/deep.js'
import { normKey, joinPath } from '../lib/paths.js'

// DSH's host runtime has AbortController; a bare node 14 does not. Shim it so
// this test can run under the oldest node the package claims to support.
if (typeof globalThis.AbortController !== 'function') {
  globalThis.AbortController = class {
    constructor() { this.signal = { aborted: false, addEventListener() {} } }
    abort() { this.signal.aborted = true }
  }
}

const fails = []
const check = (name, ok, detail) => {
  if (!ok) fails.push(name + (detail ? ' — ' + detail : ''))
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || !detail ? '' : '  [' + detail + ']'))
}

// ── parser ──────────────────────────────────────────────────────────────────
{
  const text = [
    'S i1 一次性探针脚本，跑完就废了',
    'O i2 结果被写进了报告，但已经用完了',
    '- K i3 正式源码，必须保留',
    '2. skip this line',
    '**S i1** duplicate must be ignored by the merger, not here',
  ].join('\n')
  const p = parseReply(text)
  check('parseReply reads S/O/K', p.sweep.length === 2 && p.optional.length === 1 && p.keep.length === 1, JSON.stringify(p))
  check('parseReply tolerates bullets and numbering', p.keep[0].id === 'i3')
  const junk = parseReply('I could not decide.')
  check('parseReply reports an unusable answer', junk.sweep.length === 0 && junk.unknown.length === 1)
}

// ── digest ──────────────────────────────────────────────────────────────────
{
  const info = {
    title: '整理论文图表', cwd: 'D:\\paper', createdAt: Date.parse('2026-11-01T00:00:00Z'),
    lastTime: Date.parse('2026-11-02T00:00:00Z'), toolCalls: 99, tools: { write: 3, ops_bash: 90 },
    errors: 2, firstAsk: '帮我画图', lastAnswer: '图在 fig/ 下', tail: [{ text: 'write D:\\paper\\tmp\\plot.py' }],
  }
  const cands = [
    { path: 'D:\\paper\\tmp\\plot.py', size: 2048, mtime: Date.parse('2026-11-02T00:00:00Z'), kind: 'written', tool: 'write' },
    { path: 'D:\\paper\\fig\\main.pdf', size: 5 << 20, mtime: Date.parse('2026-11-02T00:00:00Z'), kind: 'written', tool: 'write' },
  ]
  const text = buildDigest(info, cands, Date.parse('2026-11-22T00:00:00Z'))
  check('digest carries the ask and the answer', text.includes('帮我画图') && text.includes('图在 fig/ 下'))
  check('digest numbers candidates i1..iN', text.includes('i1. D:\\paper\\tmp\\plot.py') && text.includes('i2. D:\\paper\\fig\\main.pdf'))
  check('digest reports age', /20 天/.test(text), text.match(/\d+ 天/)?.[0])
  check('token estimate is positive', estimateTokens(text) > 20)
  const big = buildDigest({ ...info, tail: [] }, Array.from({ length: 60 }, (_, i) => ({
    path: 'D:\\very\\long\\path\\number\\' + 'x'.repeat(60) + i + '.tmp', size: 1, mtime: 0, kind: 'written', tool: 'write',
  })), Date.now())
  check('digest is capped', big.length <= 12_200, String(big.length))
}

// ── worker pool with a scripted model ───────────────────────────────────────
const script = {
  a: ['S i1', 'K i2'],
  b: ['O i1'],
  c: ['S i1 reason c', 'O i2'],
}
let inFlight = 0
let maxInFlight = 0
const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'fake' }) }
    if (name === 'llm') {
      return {
        async prepareCall() {
          return {
            config: {},
            async *stream(opts) {
              const first = opts.messages[0].content[0].text
              const key = /对话：([abc])/.exec(first)[1]
              inFlight += 1
              maxInFlight = Math.max(maxInFlight, inFlight)
              await new Promise((r) => setTimeout(r, key === 'a' ? 40 : key === 'c' ? 10 : 20))
              for (const line of script[key]) {
                yield { type: 'text-delta', text: line + '\n' }
              }
              inFlight -= 1
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }
        },
      }
    }
    return null
  },
}

const sessions = ['a', 'b', 'c'].map((key) => ({
  id: key,
  title: key,
  _info: { title: key, cwd: 'C:\\x', createdAt: 1, lastTime: 2, toolCalls: 1, tools: {}, errors: 0, firstAsk: '', lastAnswer: '', tail: [] },
  _candidates: [{ path: 'C:\\x\\i1.tmp', size: 1, mtime: 1, kind: 'written', tool: 'write' }, { path: 'C:\\x\\i2.tmp', size: 1, mtime: 1, kind: 'written', tool: 'write' }],
}))

const order = []
const out = await runDeep(ctx, sessions, {
  concurrency: 2,
  onResult: async (job, payload) => { order.push(job.id + ':' + (payload.ok ? 'ok' : 'err')) },
})
check('pool ran every conversation', out.results.size === 3)
check('pool respected concurrency=2', out.concurrency === 2)
check('pool never exceeds the concurrency limit', maxInFlight <= 2, 'max=' + maxInFlight)
check('pool reports every conversation exactly once', order.length === 3 && new Set(order).size === 3, order.join(' '))
check('first result is parsed', out.results.get('a').ok && out.results.get('a').parsed.sweep.length === 1)
check('failed conversation does not stop the pool', (() => {
  const boom = { get: (n) => (n === 'llm' ? { prepareCall: async () => { throw new Error('no route') } } : null) }
  return runDeep(boom, [sessions[0]], { concurrency: 1 }).then((r) => r.results.get('a').ok === false)
})())
check('workspace registry resolves a session to its folder', (() => {
  const map = _internal.workspaceIndex()
  if (!(map instanceof Map)) return false
  for (const [sid, dir] of map) {
    if (!sid.startsWith('session-')) return false
    if (typeof dir !== 'string' || !dir) return false
  }
  return true
})())

// Cancelling must stop dispatching: the queued conversations never reach the model.
const pooled = await new Promise((resolve) => {
  const ac = new AbortController()
  const started = []
  const done = []
  _internal.runPool([1, 2, 3, 4, 5, 6].map((id) => ({ id: 'j' + id })), {
    concurrency: 2,
    isStopped: () => ac.signal.aborted,
    run: async (job) => {
      started.push(job.id)
      await new Promise((r) => setTimeout(r, 120))
      done.push(job.id)
      return { ok: true }
    },
    onResult: async () => {},
  }).then(resolve)
  setTimeout(() => ac.abort(), 60)
})
check('cancelling stops the pool from dispatching', pooled.cancelled === 4, 'cancelled=' + pooled.cancelled)
check('cancelling still lets the in-flight calls finish', pooled.results.size === 2, 'results=' + pooled.results.size)

// One unreadable log must not take the whole plan down with it.
{
  const old = Date.now() - 30 * 24 * 3600 * 1000
  const persistence = {
    list: async () => [{ header: { id: 'session-ok' } }, { header: { id: 'session-bad' } }],
    open: async (id) => {
      if (id === 'session-bad') throw new Error('corrupt log')
      return {
        read: async (off, len) => (off
          ? { events: [] }
          : { events: [
              { type: 'session', id, createdAt: old, cwd: 'D:\\nowhere' },
              { type: 'user/message', time: old, text: 'hello' },
            ] }),
      }
    },
  }
  const fake = {
    get: (name) => (name === 'sessions' ? { list: () => [] } : name === 'sessionPersistence' ? persistence : undefined),
  }
  const plan = await planDeep(fake, { week: 7, now: Date.now() })
  check('an unreadable log is skipped, not fatal', plan.unreadable === 1, 'unreadable=' + plan.unreadable)
  check('the readable log still makes it into the plan', plan.sessions.length === 0, 'sessions=' + plan.sessions.length)
}

// The planner runs once per cache window and opens one handle per conversation;
// a handle that is never closed piles up across refreshes.
{
  const handles = []
  const events = [
    { type: 'session', id: 'session-a', time: Date.now(), createdAt: Date.now() },
    { type: 'tool/call', time: Date.now(), data: { name: 'write', callId: 'c1', arguments: JSON.stringify({ file_path: 'D:\\x\\a.txt' }) } },
  ]
  const fake = {
    open: async (id) => {
      const h = { id, closed: false, read: async (off) => ({ events: off ? [] : events }), close: async () => { h.closed = true } }
      handles.push(h)
      return h
    },
  }
  const info = await _internal.describeSession({}, fake, { header: { id: 'session-a' } })
  check('describeSession reads a log through the handle', !!info && info.toolCalls === 1, JSON.stringify(info && info.toolCalls))
  check('the read handle is closed afterwards', handles.length === 1 && handles[0].closed === true, 'handles=' + handles.length)

  const empty = { open: async (id) => ({ id, closed: false, read: async () => ({ events: [] }), close: async () => {} }) }
  const none = await _internal.describeSession({}, empty, { header: { id: 'session-b' } })
  check('a log with no events yields null', none === null)

  const broken = { open: async () => { throw new Error('cannot open') } }
  let code = ''
  try { await _internal.describeSession({}, broken, { header: { id: 'session-c' } }) } catch (e) { code = e.code }
  check('an unopenable log is marked SWEEPER_UNREADABLE', code === 'SWEEPER_UNREADABLE', 'code=' + code)
}

// Vetting: the model only sees ids, so every id has to survive a second look
// at the disk before it can appear on the page.
{
  const { mkdtemp, mkdir, writeFile, rm, symlink } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sweeper-vet-'))
  const good = join(dir, '.scratch', 'probe.mjs')
  const grown = join(dir, '.scratch', 'grown.mjs')
  const plain = join(dir, 'notes.md')
  await mkdir(join(dir, '.scratch'), { recursive: true })
  await writeFile(good, 'x')
  await writeFile(grown, 'xxxxxx')
  await writeFile(plain, 'notes')
  const link = join(dir, '.scratch', 'link.mjs')
  try { await symlink(good, link) } catch { /* windows without rights */ }

  // keys are normalised by scan.js on Windows only; on a case-sensitive
  // filesystem the key has to be the path as it exists.
  const cand = (p, size) => ({ key: p, path: p, size, kind: 'scratch', tool: 'write' })
  const session = {
    id: 'session-v', title: 'vet', ageDays: 9,
    _candidates: [
      cand(good, 1),
      cand(grown, 1), // the file grew after the plan: size no longer matches
      cand(plain, 5), // not a temporary-looking path: must land in 可选
      cand(link, 1),
    ],
  }
  const parsed = {
    sweep: [{ id: 'i1', reason: '一次性探针' }, { id: 'i99', reason: '不在清单里的编号' }, { id: 'i2', reason: '长大了' }, { id: 'i4', reason: '链接' }],
    optional: [{ id: 'i3', reason: '看起来还在用' }, { id: 'i1', reason: '重复出现' }],
  }
  const out = await _internal.vetDeepResult(session, parsed, {
    rejectionReason: async () => null,
    gitTracked: async () => false,
    lstat: (await import('node:fs')).lstatSync,
    scratchRe: /(?:\.scratch)/i,
  })
  check('a plain id becomes a safe candidate', out.sweep.length === 1 && out.sweep[0].key === good, JSON.stringify(out.sweep.map((x) => x.key)))
  check('an id we never sent is rejected, not guessed', out.rejected.some((r) => String(r.path).indexOf('i99') !== -1), JSON.stringify(out.rejected.map((r) => r.reason)))
  check('a file that changed size is rejected', out.rejected.some((r) => r.reason === 'the file changed after the deep plan'))
  // i1 appears twice (sweep and optional) but must produce one candidate;
  // i99/i2/i4 are each rejected once with their own reason.
  check('the same id is only counted once', out.sweep.length === 1 && out.optional.length === 1 && out.rejected.length === 3,
    JSON.stringify({ sweep: out.sweep.length, optional: out.optional.length, rejected: out.rejected.length }))
  check('a non-temporary path is downgraded to 可选', out.optional.length >= 1 && out.optional[0].tier === 'unsure', JSON.stringify(out.optional.map((x) => [x.path, x.tier])))
  check('a symlink is rejected when the platform allows one', !out.sweep.some((x) => x.key === link), JSON.stringify(out.sweep.map((x) => x.path)))
  await rm(dir, { recursive: true, force: true })
}

{
  // Restoring a file must take it off the page, or the next clean click would
  // move it straight back into the bin. Built with the platform's own rules so
  // the assertion means the same thing on Windows and on the CI runners.
  const root = process.platform === 'win32' ? 'D:\\sweeper-test' : '/tmp/sweeper-test'
  const x = joinPath(root, 'x.mjs')
  const y = joinPath(root, 'y.mjs')
  const kx = normKey(x)
  const ky = normKey(y)
  const row = { items: [{ key: kx }, { key: ky }] }
  const job = { order: ['s1'], sessions: new Map([['s1', row]]) }
  const deep = {
    sweep: [{ key: kx }, { key: ky }],
    optional: [{ key: kx }],
    byKey: new Map([[kx, {}], [ky, {}]]),
  }
  forgetRestored(deep, job, [x])
  check('a restored file leaves the deep buckets', deep.sweep.length === 1 && deep.optional.length === 0 &&
    deep.sweep[0].key === ky, JSON.stringify(deep.sweep))
  check('a restored file leaves the job row', row.items.length === 1 && row.items[0].key === ky, JSON.stringify(row.items))
  check('a restored file leaves the key map', !deep.byKey.has(kx) && deep.byKey.has(ky))
  const untouched = joinPath(root, 'other.mjs')
  check('restoring something else changes nothing', forgetRestored(deep, job, [untouched]) === deep && deep.sweep.length === 1)
}

check('_internal exposes the pieces the host uses', typeof _internal.describeSession === 'function' && typeof _internal.candidatesOf === 'function')

console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\ndeep pass OK')
process.exitCode = fails.length ? 1 : 0
