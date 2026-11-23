/**
 * dsh-sweeper · deep pass (per-conversation model review).
 *
 * A conversation that has been idle for a week still remembers what it was
 * doing: which script was a throwaway probe, which file was the deliverable.
 * The rule-based scan cannot know that, so this module feeds a compact digest
 * of ONE conversation — its own tool calls, its own leftovers — to the user's
 * configured model and asks which of those leftovers nobody needs anymore.
 *
 * Boundaries (the plugin never crosses them):
 *   • conversation logs are opened read-only through `sessionPersistence`;
 *   • the digest is built from tool names, targets and short excerpts, and the
 *     request carries a synthetic session id so nothing is written back;
 *   • the model only ever answers with ids from the candidate list we handed
 *     it, and every id is re-validated on disk before it can be shown.
 */

import { randomUUID } from 'node:crypto'
import { _internal as scanRules } from './scan.js'
import { lstatSync, readFileSync, statSync } from 'node:fs'
import { WIN, normKey, isInside, baseOf, joinPath } from './paths.js'
import { dshHome, trashRoot, rejectionReason as defaultRejection } from './trash.js'

const PAGE = 2000
const WEEK = 7 * 24 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

const MAX_SESSIONS = 24
const MAX_CANDIDATES = 40
const MAX_DIGEST_CHARS = 12_000
const MAX_TOOL_LINES = 22
const MAX_ASK = 900
const MAX_ANSWER = 1_400
const MAX_TOKENS = 3_000
const TIMEOUT_MS = 150_000
const CONCURRENCY = 4

const PRODUCER_TOOLS = new Set(['write', 'ops_write_file', 'edit', 'ops_edit_file'])
const PATH_ARGS = ['file_path', 'path', 'source_path', 'target_path', 'output_path', 'dest', 'files']
const SPILL_RE = /[A-Za-z]:[\\/][^\s"'<>|*?]*dsh-spill-[^\s"'<>|*?]+/g
const REVIEW_SESSION_ID = randomUUID()
// A long conversation can write thousands of files; only the tail matters for
// candidates, and the array is kept per planned session in memory.
const MAX_ARTIFACTS = 4000

export const SYSTEM = [
  '你是一个“工作区垃圾审计员”。你会看到一段已经结束的编程对话的摘要，以及这次对话在生产环境中留下的、目前仍然存在的文件清单。',
  '你的任务：判断清单里的每个文件现在是否还需要。只能依据这份摘要，不要凭文件名臆测。',
  '',
  '硬性规则：',
  '- 只能引用清单给出的编号；不要发明路径；不要输出任何命令或脚本；不要建议删除清单以外的东西。',
  '- 以下一律判 K（保留）：会话记录/聊天历史/附件、~/.dsh 内的任何东西、git 跟踪的文件、源码/配置/文档/测试/依赖清单等正式产物、用户明确要求过保留或交付的东西、你无法确定的东西。',
  '- S = 可以无脑删：明显是这次对话的临时产物（探针脚本、一次性转换、截图、草稿、缓存），摘要里没有任何“之后还要用/要交付/用户想要”的迹象。',
  '- O = 可选删：大概是临时产物，但摘要里有不确定因素（被文档引用、看起来像最终产物、看不出用途）。',
  '- K = 必须保留：源码、配置、文档、测试、正式产物，或任何判断不了的情况。',
  '',
  '输出格式：每个编号一行，不要输出其它任何内容，不要加代码块，不要加前后说明：',
  'S i3 一句话理由',
  'O i7 一句话理由',
  'K i2 一句话理由',
].join('\n')

const ms = (n) => (Number.isFinite(n) && n > 0 ? n : 0)

function idOf(snap) {
  if (!snap || typeof snap !== 'object') return ''
  if (typeof snap.id === 'string') return snap.id
  const h = snap.header
  if (h && (h.id || h.sessionId)) return h.id || h.sessionId
  return ''
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return ''
  let out = ''
  for (const part of message.content) if (part && typeof part.text === 'string') out += part.text + '\n'
  return out
}

function failMsg(d) {
  const err = d && d.error
  if (!err) return ''
  return String(err.name || err.code || 'error').slice(0, 60)
}

/** Rough token estimate: CJK characters count as one, the rest as a quarter. */
export function estimateTokens(text) {
  const s = String(text || '')
  let cjk = 0
  let other = 0
  for (const ch of s) {
    const code = ch.codePointAt(0)
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1
    else if (code >= 0x3000 && code <= 0x303f) cjk += 1
    else if (code >= 0xff00 && code <= 0xffef) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 4)
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

async function readAll(handle, limit = 200_000) {
  const events = []
  let off = 0
  for (;;) {
    let page
    try { page = await handle.read(off, PAGE) } catch { return { events, truncated: events.length > 0 } }
    const list = Array.isArray(page) ? page : (page && page.events) || []
    if (!list.length) return { events, truncated: false }
    for (const ev of list) events.push(ev)
    off += list.length
    if (list.length < PAGE) return { events, truncated: false }
    // Stopping at the cap means everything after this point was never seen. The
    // digest has to say so, otherwise the model judges a conversation by its
    // opening and the row looks like a complete read.
    if (off > limit) return { events, truncated: true }
  }
}

function argPaths(args, out) {
  if (!args || typeof args !== 'object') return
  for (const field of PATH_ARGS) {
    const v = args[field]
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x)
  }
}

/** Pull one conversation apart into the pieces the prompt needs. */
export async function describeSession(ctx, persistence, snapshot) {
  const id = idOf(snapshot)
  if (!id) return null
  let handle
  try { handle = await persistence.open(id, 'read') } catch (err) {
    // Tell the planner this one is unreadable rather than just absent: a log
    // the host cannot open is a fact worth showing, not a silent skip.
    const e = new Error('unreadable session log: ' + ((err && err.message) || String(err)))
    e.code = 'SWEEPER_UNREADABLE'
    throw e
  }
  let read = { events: [], truncated: false }
  try {
    read = await readAll(handle)
  } finally {
    // planDeep runs once per cache window and opens one handle per conversation;
    // not closing them would pile up file handles across refreshes.
    try { await handle.close() } catch { /* the host may not expose close */ }
  }
  const events = read.events
  if (!events.length) return null

  const info = {
    id, title: '', cwd: '', createdAt: 0, lastTime: 0, events: events.length,
    truncated: !!read.truncated,
    toolCalls: 0, tools: {}, firstAsk: '', lastAnswer: '', tail: [],
    artifacts: [], spill: [], errors: 0,
  }
  const calls = new Map()

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    if (info.lastTime && typeof ev.time === 'number') info.lastTime = Math.max(info.lastTime, ev.time)
    else if (typeof ev.time === 'number') info.lastTime = ev.time
    const t = ev.type
    if (t === 'session') {
      info.createdAt = ms(ev.createdAt) || ms(ev.time)
      info.cwd = typeof ev.cwd === 'string' ? ev.cwd : ''
      info.lastTime = info.lastTime || ms(ev.createdAt)
      continue
    }
    if (t === 'session/title') {
      const d = ev.data || {}
      const title = typeof d.title === 'string' ? d.title : (typeof d === 'string' ? d : '')
      if (title) info.title = title.trim().slice(0, 120)
      continue
    }
    if (t === 'user/message' && !info.firstAsk) {
      const text = textOf(ev.data && ev.data.message)
      if (text.trim()) info.firstAsk = clip(text, MAX_ASK)
      continue
    }
    if (t === 'assistant/message') {
      const text = textOf(ev.data && ev.data.message)
      if (text.trim()) info.lastAnswer = clip(text, MAX_ANSWER)
      continue
    }
    if (t === 'tool/call') {
      const d = ev.data || {}
      const name = String(d.name || '?')
      info.toolCalls += 1
      info.tools[name] = (info.tools[name] || 0) + 1
      calls.set(String(d.callId || ''), { name, args: d.arguments })
      const targets = []
      try { argPaths(JSON.parse(d.arguments || '{}'), targets) } catch { /* not JSON */ }
      if (PRODUCER_TOOLS.has(name)) {
        for (const p of targets) {
          if (info.artifacts.length < MAX_ARTIFACTS) info.artifacts.push({ path: p, tool: name, time: ms(ev.time) })
        }
      }
      const shown = targets.slice(0, 1).map((p) => clip(p, 90))
      if (name === 'ops_bash' || name === 'pwsh') {
        try {
          const a = JSON.parse(d.arguments || '{}')
          if (typeof a.command === 'string') shown.push(clip(a.command, 90))
        } catch { /* ignore */ }
      }
      info.tail.push({ name, text: [name, ...shown].join(' '), time: ms(ev.time) })
      if (info.tail.length > 200) info.tail.shift()
      continue
    }
    if (t === 'tool/result') {
      const d = ev.data || {}
      const msg = d.message || {}
      if (msg.isError) info.errors += 1
      const text = textOf(msg)
      if (text.includes('dsh-spill-')) {
        const found = text.match(SPILL_RE) || []
        for (const p of found) info.spill.push({ path: p, tool: (calls.get(String(msg.toolCallId)) || {}).name || '?', time: ms(ev.time) })
      }
    }
  }
  return info
}

function blockedRoots() {
  const roots = []
  const home = dshHome()
  if (home) roots.push(normKey(home))
  const trash = trashRoot()
  if (trash) roots.push(normKey(trash))
  const userHome = process.env.USERPROFILE || process.env.HOME
  if (userHome) roots.push(normKey(joinPath(userHome, '.agents')))
  return roots.filter(Boolean)
}

/**
 * Existing files this conversation produced, filtered to things a model could
 * legitimately be asked about. Anything inside DSH's own home, anything the
 * trash already holds, or anything we cannot stat is left out entirely — the
 * model never sees it, so it can never vote for it.
 */
export function candidatesOf(info, ctx = {}) {
  const seen = new Set()
  const out = []
  const roots = blockedRoots()
  void ctx

  const push = (raw, kind, tool, time) => {
    const key = normKey(raw)
    if (!key || seen.has(key)) return
    // Only artifacts that already look like scratch. Project sources and configs
    // are not this pass's business: sending them spends tokens to be told "keep".
    if (kind !== 'spill' && !scanRules.SCRATCH.test(key)) return
    seen.add(key)
    if (roots.some((r) => r && isInside(key, r))) return
    // stat the path the log actually recorded: normKey lowercases on Windows,
    // and the page should show the real casing (Linux/macOS are case sensitive).
    const shown = String(raw || '').replace(/\//g, WIN ? '\\' : '/')
    let st
    try { st = statSync(shown) } catch { try { st = statSync(key) } catch { return } }
    if (!st.isFile()) return
    if (st.size > 50 * 1024 * 1024) return
    out.push({ key, path: shown, kind, tool, time, size: st.size, mtime: st.mtimeMs })
  }
  for (const a of info.artifacts) push(a.path, 'written', a.tool, a.time)
  for (const s of info.spill) push(s.path, 'spill', s.tool, s.time)
  out.sort((a, b) => a.mtime - b.mtime)
  const capped = out.slice(0, MAX_CANDIDATES)
  // How many candidates this conversation actually has, so the page can say
  // "40 of 63 sent" instead of quietly reviewing the first 40 and looking
  // complete. Non-enumerable: the array is serialised into job rows as-is.
  Object.defineProperty(capped, 'hidden', { value: out.length - capped.length, enumerable: false })
  return capped
}


function ageText(time, now) {
  if (!time) return '未知'
  const days = Math.floor((now - time) / DAY)
  return days <= 0 ? '今天' : days + ' 天'
}

function sizeText(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

/** Build the digest + candidate map for one conversation. */
export function buildDigest(info, candidates, now = Date.now()) {
  const lines = []
  lines.push('对话：' + (info.title || '(无标题)'))
  if (info.cwd) lines.push('工作目录：' + info.cwd)
  lines.push('时间：' + (info.createdAt ? new Date(info.createdAt).toISOString().slice(0, 10) : '?')
    + ' → ' + (info.lastTime ? new Date(info.lastTime).toISOString().slice(0, 10) : '?')
    + '（最后活动 ' + ageText(info.lastTime, now) + '前）')
  if (info.truncated) {
    out.push('')
    out.push('注意：这段对话的事件超过 ' + info.events + ' 条，下面只覆盖了最早的部分；')
    out.push('它最近在做什么没有被读到，判断时请把这一点算进去。')
  }
  const tools = Object.entries(info.tools).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => k + ' ' + v).join(' / ')
  lines.push('工具调用：' + info.toolCalls + ' 次（' + (tools || '无') + '），其中 ' + info.errors + ' 次失败')
  if (info.firstAsk) lines.push('', '用户最初的请求：' + info.firstAsk)
  if (info.lastAnswer) lines.push('', '最近一次回答（可能是交付结论）：' + info.lastAnswer)
  if (info.tail.length) {
    lines.push('', '最近 ' + Math.min(MAX_TOOL_LINES, info.tail.length) + ' 次工具调用：')
    for (const step of info.tail.slice(-MAX_TOOL_LINES)) lines.push('- ' + step.text)
  }
  lines.push('', '这次对话留下、目前仍然存在的文件（只能从这些编号里选）：')
  if (candidates.hidden) {
    lines.push('- 清单只列了前 ' + candidates.length + ' 个；这段对话还有 ' + candidates.hidden + ' 个临时文件没有列出来（不影响你判断上面的）')
  }
  if (!candidates.length) lines.push('- （没有）')
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    lines.push('i' + (i + 1) + '. ' + c.path + ' | ' + sizeText(c.size) + ' | '
      + ageText(c.mtime, now) + ' | ' + c.kind + ' | 由 ' + (c.tool || '?') + ' 产生')
  }

  let text = lines.join('\n')
  if (text.length > MAX_DIGEST_CHARS) text = text.slice(0, MAX_DIGEST_CHARS) + '\n…（摘要已截断，未列出的文件不要判断）'
  return text
}

export function parseReply(text) {
  const out = { sweep: [], optional: [], keep: [], unknown: [], raw: String(text || '').slice(0, 4000) }
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s>*\-•\d.、)]+/, '').trim()
    const m = /^(S|O|K)\s*[.:：]?\s*(i\d+)\b\s*(.*)$/i.exec(line)
    if (!m) continue
    const kind = m[1].toUpperCase()
    const id = m[2].toLowerCase()
    const why = m[3].replace(/^[-–—:：\s]+/, '').trim().slice(0, 160)
    if (kind === 'S') out.sweep.push({ id, reason: why })
    else if (kind === 'O') out.optional.push({ id, reason: why })
    else out.keep.push({ id, reason: why })
  }
  if (!out.sweep.length && !out.optional.length && !out.keep.length) out.unknown.push({ id: '', reason: 'model returned no usable line' })
  return out
}

/** One conversation → one model call. */
export async function askConversation(ctx, info, candidates, opts = {}) {
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
  if (!llm || typeof llm.prepareCall !== 'function') throw new Error('the host llm service is not available')
  const route = resolveRoute(ctx, opts.model)
  const digest = buildDigest(info, candidates, opts.now || Date.now())
  const started = Date.now()
  const controller = new AbortController()
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // A cancelled pass must also stop the calls that are already streaming,
  // otherwise pressing 停止 would still burn tokens for every queued session.
  const external = opts.signal
  const onAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }
  const acc = { deltas: '', blocks: '', types: {}, finish: null, error: null }
  try {
    const call = await llm.prepareCall({ ...route, maxTokens: MAX_TOKENS }, controller.signal, (controls) => controls)
    const messages = [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: digest }],
      source: { kind: 'dsh-sweeper' },
    }]
    for await (const chunk of call.stream({
      ...call.config,
      messages,
      system: SYSTEM,
      sessionId: REVIEW_SESSION_ID,
      purpose: 'sweeper-deep',
      signal: controller.signal,
    })) collectText(chunk, acc)
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(external && external.aborted
        ? 'model call cancelled'
        : 'model call timed out after ' + Math.round(timeoutMs / 1000) + 's')
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (external && typeof external.removeEventListener === 'function') external.removeEventListener('abort', onAbort)
  }
  const text = acc.deltas || acc.blocks
  const parsed = parseReply(text)
  return { parsed, digestChars: digest.length, estTokens: estimateTokens(digest), ms: Date.now() - started, trace: acc.types }
}

function collectText(chunk, acc) {
  if (!chunk || typeof chunk !== 'object') return
  acc.types[chunk.type] = (acc.types[chunk.type] || 0) + 1
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') { acc.deltas += chunk.text; return }
  if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') acc.blocks += chunk.block.text
  if (chunk.type === 'finish' && acc.finish === null) acc.finish = JSON.stringify(chunk).slice(0, 300)
  if (chunk.type === 'error' && acc.error === null) acc.error = JSON.stringify(chunk).slice(0, 300)
}

export function resolveRoute(ctx, override) {
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '')
  if (pick(override && override.provider) && pick(override && override.model)) {
    return { provider: pick(override.provider), model: pick(override.model) }
  }
  try {
    const svc = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
    const cur = svc && typeof svc.currentSelection === 'function' ? svc.currentSelection() : null
    if (cur && pick(cur.provider) && pick(cur.model)) return { provider: pick(cur.provider), model: pick(cur.model) }
  } catch { /* fall through */ }
  throw new Error('no model route: set a default model in DSH first')
}

/** session id -> workspace folder, from the registry DSH keeps for the sidebar. */
function workspaceIndex() {
  const out = new Map()
  try {
    const raw = JSON.parse(readFileSync(joinPath(joinPath(dshHome(), 'storages'), 'workspace.json'), 'utf8'))
    const tables = (raw && raw.tables) || {}
    for (const ws of Object.values(tables.workspaces || {})) {
      const dir = ws && typeof ws.path === 'string' ? ws.path : ''
      if (!dir) continue
      for (const sid of (ws.sessionIds || [])) if (sid) out.set(String(sid), dir)
    }
  } catch { /* no registry, no fallback */ }
  return out
}

/** Sessions that are idle for at least `week` and still own files on disk. */
export async function planDeep(ctx, opts = {}) {
  const persistence = ctx.get ? ctx.get('sessionPersistence') : ctx.sessionPersistence
  if (!persistence) throw new Error('sessionPersistence service is not available')
  const now = opts.now || Date.now()
  const week = Number(opts.week) > 0 ? Number(opts.week) : 7
  const cutoff = now - week * DAY

  const liveIds = new Set()
  const sessionsService = ctx.get ? ctx.get('sessions') : ctx.sessions
  if (!sessionsService || typeof sessionsService.list !== 'function') {
    // Without the live list the plugin cannot tell an idle conversation from one
    // that is running right now. Planning anyway would send a live conversation
    // to the model, so this fails closed instead.
    throw Object.assign(new Error('the session service is not available, so which conversations are idle cannot be told'), { status: 503 })
  }
  try {
    const arr = sessionsService.list()
    for (const s of arr || []) { const lid = idOf(s); if (lid) liveIds.add(String(lid)) }
  } catch (err) {
    throw Object.assign(new Error('the session service failed while listing live conversations: ' + ((err && err.message) || String(err))), { status: 503 })
  }

  const snapshots = await persistence.list()
  const list = Array.isArray(snapshots) ? snapshots : [...(snapshots || [])]
  const workspaces = workspaceIndex()
  const sessions = []
  let skipped = 0
  let unreadable = 0
  let totalEstTokens = 0
  for (const snap of list) {
    const id = idOf(snap)
    if (!id || liveIds.has(String(id))) continue
    // One log this build cannot parse must not cost the user the whole plan.
    let info = null
    try { info = await describeSession(ctx, persistence, snap) } catch { unreadable += 1; continue }
    if (!info) continue
    // Older logs have no cwd in the header; the sidebar registry still knows it.
    if (!info.cwd) info.cwd = workspaces.get(String(id)) || ''
    const lastUsed = info.lastTime || info.createdAt
    if (!lastUsed || lastUsed > cutoff) continue
    const candidates = candidatesOf(info, ctx)
    if (!candidates.length) { skipped += 1; continue }
    const digest = buildDigest(info, candidates, now)
    const estTokens = estimateTokens(digest)
    totalEstTokens += estTokens
    sessions.push({
      id, title: info.title || baseOf(info.cwd || '') || id,
      cwd: info.cwd, createdAt: info.createdAt, lastUsedAt: lastUsed,
      ageDays: Math.max(0, Math.floor((now - lastUsed) / DAY)),
      toolCalls: info.toolCalls,
      candidates: candidates.length,
      hidden: candidates.hidden || 0,
      truncated: !!info.truncated,
      estTokens,
      _info: info,
      _candidates: candidates,
    })
    if (sessions.length >= (opts.limit || MAX_SESSIONS)) break
  }
  sessions.sort((a, b) => b.candidates - a.candidates)
  return { sessions, totalEstTokens, concurrency: CONCURRENCY, week, skipped, unreadable }
}

/**
 * Run the per-conversation reviews with a bounded worker pool. Results arrive
 * one by one through `onResult`, so the UI can paint a row as soon as its
 * model call lands instead of waiting for the slowest one.
 */
/**
 * Bounded worker pool. Once `isStopped()` turns true no further job is
 * dispatched; the ones already streaming are expected to abort themselves.
 */
export async function runPool(jobs, opts = {}) {
  const concurrency = Math.max(1, Math.min(Number(opts.concurrency) || CONCURRENCY, 8))
  const queue = jobs.slice()
  const results = new Map()
  const isStopped = typeof opts.isStopped === 'function' ? opts.isStopped : () => false
  let active = 0
  let cancelled = 0

  await new Promise((resolve) => {
    const pump = () => {
      if (isStopped()) { cancelled += queue.length; queue.length = 0 }
      if (!queue.length && active === 0) return resolve()
      while (active < concurrency && queue.length) {
        const job = queue.shift()
        active += 1
        ;(async () => {
          let payload
          try {
            payload = await opts.run(job)
          } catch (err) {
            payload = { ok: false, error: (err && err.message) || String(err) }
          } finally {
            active -= 1
          }
          results.set(job.id, payload)
          try { if (opts.onResult) await opts.onResult(job, payload) } catch { /* listener must not kill the pool */ }
          pump()
        })()
      }
    }
    pump()
  })

  return { results, cancelled }
}

export async function runDeep(ctx, sessions, opts = {}) {
  const started = Date.now()
  const pooled = await runPool(sessions, {
    concurrency: opts.concurrency,
    isStopped: () => !!(opts.signal && opts.signal.aborted),
    run: async (job) => ({ ok: true, ...(await askConversation(ctx, job._info, job._candidates, opts)) }),
    onResult: opts.onResult,
  })
  return { results: pooled.results, cancelled: pooled.cancelled, ms: Date.now() - started, concurrency: Math.max(1, Math.min(Number(opts.concurrency) || CONCURRENCY, 8)) }
}

/**
 * Re-check every id the model named before any of it reaches the page.
 *
 * The model only sees ids; this turns ids back into paths and re-reads the
 * disk at answer time. Anything that no longer matches — an id we never sent,
 * a file that grew, a link, something git tracks — becomes a `rejected` entry
 * with a reason, never a candidate.
 */
/**
 * Drop the keys of files that were just restored from the trash.
 *
 * A restore puts a file back where it came from. If its deep/extra row stayed
 * on the page, the next "clean" click would move it into the bin again — the
 * restore would look like it did nothing. Both the buckets and the job rows are
 * cleared here so the page and the poll agree.
 */
export function forgetRestored(deep, job, paths) {
  const back = new Set((paths || []).map((p) => normKey(p)))
  if (!back.size) return deep
  if (deep) {
    deep.sweep = (deep.sweep || []).filter((it) => !back.has(it.key))
    deep.optional = (deep.optional || []).filter((it) => !back.has(it.key))
    for (const key of back) if (deep.byKey) deep.byKey.delete(key)
  }
  if (job && job.sessions) {
    for (const id of job.order || []) {
      const row = job.sessions.get(id)
      if (row && Array.isArray(row.items)) row.items = row.items.filter((it) => !back.has(it.key))
    }
  }
  return deep
}

export async function vetDeepResult(session, parsed, deps = {}) {
  const reject = deps.rejectionReason || defaultRejection
  const trackedOf = deps.gitTracked || scanRules.gitTracked
  const scratch = deps.scratchRe || scanRules.SCRATCH
  const statOf = deps.lstat || lstatSync
  const list = Array.isArray(session._candidates) ? session._candidates : Array.isArray(session.candidates) ? session.candidates : []
  const byId = new Map(list.map((c, i) => ['i' + (i + 1), c]))
  const out = { sweep: [], optional: [], rejected: [] }
  const seen = new Set()
  for (const bucket of ['sweep', 'optional']) {
    for (const p of parsed[bucket] || []) {
      const c = byId.get(p.id)
      if (!c) { out.rejected.push({ path: p.id || '(missing id)', reason: 'not one of the files this conversation produced' }); continue }
      if (seen.has(c.key)) continue
      const why = await reject(c.key)
      if (why) { out.rejected.push({ path: c.path, reason: why }); continue }
      let st
      try { st = statOf(c.key) } catch { out.rejected.push({ path: c.path, reason: 'the file is gone' }); continue }
      if (!st.isFile() || st.isSymbolicLink()) { out.rejected.push({ path: c.path, reason: 'it is not a regular file' }); continue }
      if (st.size !== c.size) { out.rejected.push({ path: c.path, reason: 'the file changed after the deep plan' }); continue }
      let tracked = 'unknown'
      try { tracked = await trackedOf(c.key, new Map()) } catch { tracked = 'unknown' }
      if (tracked === true) { out.rejected.push({ path: c.path, reason: 'tracked by git' }); continue }
      if (tracked === 'unknown') { out.rejected.push({ path: c.path, reason: 'git could not confirm whether it is tracked' }); continue }
      seen.add(c.key)
      const looksTemporary = c.kind === 'spill' || scratch.test(c.key)
      out[bucket].push({
        key: c.key,
        path: c.path,
        tier: bucket === 'sweep' && looksTemporary ? 'safe' : 'unsure',
        kind: c.kind === 'spill' ? 'spill' : 'scratch',
        size: st.size,
        mtime: st.mtimeMs,
        ageDays: session.ageDays,
        refs: 0,
        uses: 0,
        failed: false,
        reasons: [(p.reason || 'model judgement').slice(0, 160)],
        origin: 'deep',
        session: { id: session.id, title: session.title },
      })
    }
  }
  return out
}

export const _internal = {
  readAll, describeSession, candidatesOf, buildDigest, estimateTokens, parseReply, idOf, workspaceIndex, runPool, vetDeepResult }
