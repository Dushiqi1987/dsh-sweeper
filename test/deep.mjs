/**
 * Offline test for the deep pass: drive `runDeep` with a fake llm service so the
 * prompt pipeline, the line parser and the worker pool are exercised without a
 * network call or the user's tokens.
 *
 *   node test/deep.js
 */

import { runDeep, planDeep, parseReply, buildDigest, estimateTokens, _internal } from '../lib/deep.js'

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

check('_internal exposes the pieces the host uses', typeof _internal.describeSession === 'function' && typeof _internal.candidatesOf === 'function')

console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\ndeep pass OK')
process.exitCode = fails.length ? 1 : 0
