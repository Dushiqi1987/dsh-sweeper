/**
 * dsh-sweeper · model review (dynamic pass).
 *
 * The scan is deterministic; this module adds one optional opinion on top of it.
 * It sends the candidate list to the host's configured model and asks for a
 * line-oriented verdict. Nothing here touches the filesystem: the caller decides,
 * and only `tier === 'safe'` items may be acted on automatically.
 *
 * Safety model (assume the model can be wrong or adversarial):
 *   - the model only ever sees ids from the current report;
 *   - ids are re-validated against that report;
 *   - a model verdict of `delete` on an `unsure` item is downgraded to a question;
 *   - the prompt forbids inventing paths, commands, or deletions outside the list.
 */

import { randomUUID } from 'node:crypto'
import { normKey } from './paths.js'

const SYSTEM = `你是 DSH 插件 dsh-sweeper 的「文件复核员」。唯一任务：在给定的候选清单里，判断哪些是可以安全删除的临时垃圾。

硬性约束（违反任意一条都算失败）：
1. 只能使用候选清单里出现的 id，禁止提到清单外的路径、目录、文件名、通配符或命令。
2. 禁止输出 shell / PowerShell / Python 代码，也不要建议"执行删除命令"。插件自己负责把文件移进回收站。
3. 绝对不能建议删除：会话记录、聊天历史、附件、.dsh 目录内的任何内容、被 git 跟踪的文件、用户文档/图片/数据、正式源码。
4. 除了下列格式的行，不要输出任何其它文字（不要解释、不要标题、不要 markdown 代码块）。

清单分两段：
A 段「候选」的 id 形如 i12，用下面三种回答：
D <id>            ← 可以安全删除
K <id>            ← 保留
Q <id> <问题>     ← 拿不准，用一句简短中文问用户

B 段「清单外观察到的文件」的 id 形如 x7，等你主动判断要不要清理：
A <id>            ← 可以无脑清理（明确的构建/临时/缓存产物，删了不会有任何损失）
S <id>            ← 可选清理（像是垃圾，但用户可能还要，让用户决定）
K <id>            ← 保留（源码、配置、数据、文档，或看不出是垃圾）

B 段判断要更保守：只根据路径、文件名、大小、闲置天数判断；拿不准就 K，不要为了让清单变长而瞎猜。绝对不要给出 B 段之外的任何 id。

判断标准：
- 一次性临时产物（.scratch/、tmp/、__pycache__、*.bak、调试脚本 shot-*.mjs、repro-*.py 这类）→ D
- 看起来属于某个项目的正式源码、配置、文档、数据集 → K
- 删除后用户可能后悔、或信息不足以判断 → Q`

// A stand-in conversation id: some providers (opencode-go) require a session
// header for routing, but this plugin never reads or writes a real session log.
const REVIEW_SESSION_ID = randomUUID()

const MAX_ITEMS = 100
const MAX_HINTS = 80
const MAX_TOKENS = 4000
const TIMEOUT_MS = 120_000

function stripFence(text) {
  const s = String(text || '').trim()
  const m = s.match(/```(?:[a-z]*)\s*([\s\S]*?)```/i)
  return (m ? m[1] : s).trim()
}

/** Line protocol: `D <id>` / `K <id>` / `Q <id> <question>`. Tolerates bullets and numbering. */
function parseLines(text) {
  const out = { delete: [], keep: [], ask: [], sweep: [], optional: [], note: '' }
  let matched = 0
  let ignored = 0
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
    if (!line) continue
    const m = line.match(/^([DKOQASdkoqas])\s*[:：]?\s+(\S+)\s*(.*)$/)
    if (!m) { ignored++; continue }
    matched++
    const mark = m[1].toUpperCase()
    const id = m[2]
    const rest = (m[3] || '').trim()
    if (mark === 'D') out.delete.push(id)
    else if (mark === 'A') out.sweep.push(id)
    else if (mark === 'S') out.optional.push(id)
    else if (mark === 'K') out.keep.push(id)
    else out.ask.push({ id, question: rest.slice(0, 300) })
  }
  return { verdict: out, matched, ignored }
}

function parseJSONish(text) {
  const raw = stripFence(text)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim()) : [])
    return {
      delete: ids(parsed.delete),
      sweep: ids(parsed.sweep),
      optional: ids(parsed.optional),
      keep: ids(parsed.keep),
      ask: Array.isArray(parsed.ask)
        ? parsed.ask.filter((a) => a && typeof a === 'object' && typeof a.id === 'string')
          .map((a) => ({ id: String(a.id).trim(), question: String(a.question || '').slice(0, 300) }))
        : [],
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 500) : '',
    }
  } catch { return null }
}

function parseVerdict(text) {
  if (!String(text || '').trim()) throw new Error('model returned an empty answer')
  const lines = parseLines(text)
  if (lines.matched > 0) return { ...lines.verdict, matched: lines.matched, ignored: lines.ignored }
  const json = parseJSONish(text)
  if (json) return { ...json, matched: json.delete.length + json.keep.length + json.ask.length, ignored: 0 }
  throw new Error('model answer has no decisions (first 200 chars: ' + String(text).trim().slice(0, 200) + ')')
}

function resolveRoute(ctx, override) {
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '')
  if (pick(override && override.provider) && pick(override && override.model)) {
    return { provider: pick(override.provider), model: pick(override.model) }
  }
  try {
    const svc = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
    const cur = svc && typeof svc.currentSelection === 'function' ? svc.currentSelection() : null
    if (cur && pick(cur.provider) && pick(cur.model)) {
      return { provider: pick(cur.provider), model: pick(cur.model) }
    }
  } catch { /* fall through */ }
  throw new Error('no model route: configure provider/model in the plugin row or set a default model')
}

function collectText(chunk, acc) {
  if (!chunk || typeof chunk !== 'object') return
  acc.types[chunk.type] = (acc.types[chunk.type] || 0) + 1
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') { acc.deltas += chunk.text; return }
  if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') {
    acc.blocks += chunk.block.text
  }
  if (chunk.type === 'finish' && acc.finish === null) acc.finish = JSON.stringify(chunk).slice(0, 400)
  if (chunk.type === 'error' && acc.error === null) acc.error = JSON.stringify(chunk).slice(0, 400)
}

/**
 * Ask the configured model to triage the current candidate list.
 * @param {object} ctx host context (needs `llm`, optionally `agentDefaultModel`).
 * @param {object} report the current scan report.
 * @param {{model?: {provider?: string, model?: string}, timeoutMs?: number}} opts
 */
export async function review(ctx, report, opts = {}) {
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
  if (!llm || typeof llm.prepareCall !== 'function') throw new Error('the host llm service is not available')
  const route = resolveRoute(ctx, opts.model)
  const items = (report.items || []).slice(0, MAX_ITEMS)
  if (!items.length) {
    return { model: route, verdict: { delete: [], keep: [], ask: [], note: '', matched: 0, ignored: 0 }, reviewed: 0, skipped: 0, ms: 0 }
  }

  const payload = items.map((it, i) => ({
    id: 'i' + (i + 1),
    p: it.path,
    t: it.tier,
    k: it.kind,
    b: it.size,
    d: it.ageDays,
    u: it.uses,
    f: !!it.failed,
  }))
  const hints = (report.hints || []).slice(0, MAX_HINTS)
  const extra = hints.map((h, i) => ({
    id: 'x' + (i + 1),
    p: h.path,
    b: h.size,
    d: h.ageDays,
  }))
  const user = [
    '字段含义：id=编号（原样复制），p=路径，t=档位（safe=无脑删 / unsure=需确认），k=来源，b=字节数，d=闲置天数，u=产生后被工具使用次数，f=产生它那次调用是否失败。',
    '',
    'A 段 · 候选清单（这些已经被规则筛过一轮）：',
    JSON.stringify(payload),
    '',
    'B 段 · 清单外观察到的文件（在已知临时目录里、但任何会话日志都没提到过；只根据路径和闲置天数判断）：',
    JSON.stringify(extra),
    '',
    '请按格式逐行输出判断。',
  ].join('\n')

  const started = Date.now()
  const controller = new AbortController()
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const acc = { deltas: '', blocks: '', types: {}, finish: null, error: null }
  try {
    const call = await llm.prepareCall({ ...route, maxTokens: MAX_TOKENS }, controller.signal, (controls) => controls)
    const messages = [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: user }],
      source: { kind: 'dsh-sweeper' },
    }]
    for await (const chunk of call.stream({
      ...call.config,
      messages,
      system: SYSTEM,
      sessionId: REVIEW_SESSION_ID,
      purpose: 'sweeper-review',
      signal: controller.signal,
    })) collectText(chunk, acc)
  } catch (err) {
    if (controller.signal.aborted) throw new Error('model call timed out after ' + Math.round(timeoutMs / 1000) + 's')
    throw err
  } finally {
    clearTimeout(timer)
  }

  const text = acc.deltas || acc.blocks
  const trace = { types: acc.types, finish: acc.finish, error: acc.error, chars: text.length }
  let verdict
  try { verdict = parseVerdict(text) } catch (err) {
    const wrapped = new Error((err && err.message) || String(err))
    wrapped.trace = trace
    throw wrapped
  }
  const translated = translateVerdict(verdict, items, hints)
  return {
    model: route,
    verdict: translated.verdict,
    proposals: translated.proposals,
    hints: hints.length,
    unknownIds: translated.unknown,
    reviewed: items.length,
    skipped: (report.items || []).length - items.length,
    ms: Date.now() - started,
    answerChars: text.length,
    raw: String(text || '').slice(0, 6000),
    trace,
  }
}

function normPath(p) {
  return normKey(p)
}

/**
 * Map whatever the model wrote back onto report keys.
 * Accepts a short label (i3), the key itself, or a case/separator variant of the path.
 */
function translateVerdict(verdict, items, hints = []) {
  const hintByLabel = new Map(hints.map((h, i) => ['x' + (i + 1), h]))
  const hintByKey = new Map(hints.map((h) => [h.key, h]))
  const hintOf = (label) => {
    if (typeof label !== 'string') return null
    const raw = label.trim().toLowerCase()
    if (!raw) return null
    if (hintByLabel.has(raw)) return hintByLabel.get(raw)
    const n = normPath(raw)
    if (n && hintByKey.has(n)) return hintByKey.get(n)
    return null
  }
  const proposals = { sweep: [], optional: [], unknown: [] }
  const seenProposal = new Set()
  const propose = (bucket, label) => {
    const h = hintOf(label)
    if (!h) { proposals.unknown.push(String(label).slice(0, 200)); return }
    if (seenProposal.has(h.key)) return
    seenProposal.add(h.key)
    proposals[bucket].push(h)
  }
  for (const l of verdict.sweep || []) propose('sweep', l)
  for (const l of verdict.optional || []) propose('optional', l)
  const byLabel = new Map(items.map((it, i) => ['i' + (i + 1), it.key]))
  const byKey = new Map(items.map((it) => [it.key, it.key]))
  const byPath = new Map()
  for (const it of items) {
    const n = normPath(it.path)
    if (n) byPath.set(n, it.key)
  }
  const unknown = []
  const keyOf = (label) => {
    if (typeof label !== 'string') return null
    const raw = label.trim()
    if (!raw) return null
    if (byLabel.has(raw)) return byLabel.get(raw)
    const lower = raw.toLowerCase()
    if (byLabel.has(lower)) return byLabel.get(lower)
    if (byKey.has(raw)) return raw
    const n = normPath(raw)
    if (n && byPath.has(n)) return byPath.get(n)
    if (byKey.has(n)) return n
    unknown.push(raw.slice(0, 200))
    return null
  }
  const out = { delete: [], keep: [], ask: [], note: verdict.note || '' }
  for (const l of verdict.delete || []) { const k = keyOf(l); if (k) out.delete.push(k) }
  for (const l of verdict.keep || []) { const k = keyOf(l); if (k) out.keep.push(k) }
  for (const a of verdict.ask || []) {
    const k = keyOf(a.id)
    if (k) out.ask.push({ id: k, question: a.question || '' })
  }
  return { verdict: out, unknown, proposals }
}

/** Turn a raw verdict into actions that are legal for this report. */
export function applyVerdict(report, verdict) {
  const byKey = new Map((report.items || []).map((it) => [it.key, it]))
  const auto = []
  const asks = []
  const kept = []
  const unknown = []
  const seen = new Set()
  const once = (k) => (seen.has(k) ? false : (seen.add(k), true))

  for (const key of verdict.delete || []) {
    const it = byKey.get(key)
    if (!it) { unknown.push(key); continue }
    if (!once(key)) continue
    if (it.tier === 'safe') auto.push(it)
    else {
      asks.push({
        key,
        path: it.path,
        tier: it.tier,
        size: it.size,
        question: '模型认为可以删，但它属于「不确定」档：' + ((it.reasons || []).join('；') || '没有更多信息'),
      })
    }
  }
  for (const a of verdict.ask || []) {
    const it = byKey.get(a.id)
    if (!it) { unknown.push(a.id); continue }
    if (!once(a.id)) continue
    asks.push({ key: a.id, path: it.path, tier: it.tier, size: it.size, question: a.question || '这个还留着吗？' })
  }
  for (const key of verdict.keep || []) {
    if (!byKey.has(key)) { unknown.push(key); continue }
    if (!once(key)) continue
    kept.push(key)
  }
  return { auto, asks, kept, unknown }
}
