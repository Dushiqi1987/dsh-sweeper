// Agentic audit for one conversation.
//
// The single-prompt version could only judge the paths the scanner had already
// collected, which by design means small scratch files: a 900 MB checkpoint or
// a rendered video usually leaves no write/edit call behind, so it never made
// the list, and "no candidates" read as "nothing to clean". This module lets
// the model look instead: a bounded tool loop walks the conversation's own
// workspace, sees real sizes, and names what it believes is dead.
//
// Safety is unchanged in kind: the tools are read-only, scoped to that
// conversation's workspace, and everything the model names is re-checked on
// the server (exists, not a link, not tracked, not DSH state) before it can
// appear on the page. Anything large or outside a scratch pattern is forced
// into the "decide yourself" tier, never the one-click one.
import { makeFsTools, rootsFor } from './fs-tools.js'
import { runAgentLoop } from './agent.js'
import { normKey, isInside } from './paths.js'

const SYSTEM = [
  'You audit one finished coding session and decide which files it left behind are now dead.',
  '',
  'You get a summary of the conversation and a numbered list of files it wrote. You may also',
  'look around its workspace with the read-only tools: list_dir, stat_path, find_files.',
  'Use them when the listed files are too small to matter or when you suspect a big artifact',
  '(model checkpoints, rendered video, datasets, caches) that never appeared in a write call.',
  '',
  'How to look, in this order:',
  '  1. list_dir the workspace root. Big artifacts are usually visible there.',
  '  2. call find_files once with minBytes = 10485760 and depth = 3, so a large',
  '     file that never showed up in a write call still gets a chance to be seen.',
  '  3. open one level deeper only where the sizes look suspicious.',
  '',
  'Rules:',
  '- Only name a path you have seen in the list or through a tool call. Never invent a path.',
  '- Never name a conversation log, an attachment, anything under the DSH state directory,',
  '  a git-tracked file, source code, configuration, documentation, or tests.',
  '- Prefer keep over delete when the summary suggests the user still needs the file.',
  '- Sizes matter: a large file deserves an explicit reason, because deleting it is expensive.',
  '- Many copies of the same big file (build outputs, several dated release folders) are a',
  '  strong signal; say which ones and why.',
  '',
  'Answer EXACTLY with one line per file and nothing else:',
  '  S <path or iN> | <one-line reason>   file is clearly disposable',
  '  O <path or iN> | <one-line reason>   probably disposable, user should decide',
  '  K <path or iN> | <one-line reason>   keep it',
].join('\n')

const MAX_LINES = 40

/**
 * Ask the model to audit one conversation with tools available.
 *
 * @param {object} ctx - host context.
 * @param {object} info - describeSession() output.
 * @param {string} digest - buildDigest() text.
 * @param {object} opts - { route, timeoutMs, signal, maxTurns, maxCalls, onCall }.
 * @returns {Promise<{verdict: object, turns: number, calls: number, ms: number, trace: Array}>}
 */
export async function auditWithTools(ctx, info, digest, opts = {}) {
  const roots = rootsFor(info.cwd, opts.extraRoots)
  const tools = makeFsTools({ roots, deny: opts.deny || [] })
  const started = Date.now()
  const goal = [
    digest,
    '',
    'Workspace of this conversation: ' + (info.cwd || '(unknown)'),
    '',
    'Decide now. Use the tools first if you need to see sizes or look deeper, then answer with',
    'the S/O/K lines only. Anything larger than a few megabytes deserves an explicit reason.',
  ].join('\n')
  const result = await runAgentLoop(ctx, {
    system: SYSTEM,
    goal,
    route: opts.route,
    tools,
    maxTurns: opts.maxTurns,
    maxCalls: opts.maxCalls,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    onCall: opts.onCall,
  })
  return {
    verdict: parseVerdict(result.text),
    turns: result.turns,
    calls: result.calls,
    ms: Date.now() - started,
    trace: result.trace,
    text: result.text,
  }
}

/**
 * Parse the S/O/K lines. A path after the letter may be an id (`i3`) or an
 * absolute path the model discovered; the caller decides which of those it can
 * accept.
 */
export function parseVerdict(text) {
  const out = { sweep: [], optional: [], keep: [], garbage: [] }
  const lines = String(text || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
    if (line === '') continue
    const match = /^([SOK])\s+(.+?)\s*(?:\|\s*(.*))?$/i.exec(line)
    if (!match) { out.garbage.push(line.slice(0, 120)); continue }
    const bucket = match[1].toUpperCase()
    let target = match[2].trim().replace(/^[`'"]+|[`'"]+$/g, '').replace(/[.,;]+$/, '')
    const reason = (match[3] || '').trim().slice(0, 160) || 'model judgement'
    if (target === '') { out.garbage.push(line.slice(0, 120)); continue }
    const entry = { id: target, reason }
    if (bucket === 'S') out.sweep.push(entry)
    else if (bucket === 'O') out.optional.push(entry)
    else out.keep.push(entry)
  }
  for (const key of ['sweep', 'optional', 'keep']) out[key] = out[key].slice(0, MAX_LINES)
  return out
}

/** True when the model answered with a path rather than a list id. */
export function looksLikePath(target) {
  return /^[A-Za-z]:[\\/]/.test(String(target || '')) || String(target || '').startsWith('/')
}

/** Keep only the paths that live inside the conversation's own workspace. */
export function insideWorkspace(target, cwd) {
  if (!looksLikePath(target) || !cwd) return false
  const key = normKey(target)
  const root = normKey(cwd)
  return !!key && !!root && (key === root || isInside(key, root))
}

export const _internal = { SYSTEM, parseVerdict }
