// A small, bounded ReAct loop over the host llm service.
//
// Why this exists: one prompt with a pre-cut candidate list can only judge what
// the plugin already chose to send. A conversation that produced a 900 MB
// checkpoint leaves no path in a write/edit call the scanner would keep, so the
// only way to find it is to let the model look: list a directory, see sizes,
// open one level deeper, then name what it thinks is dead.
//
// The loop is deliberately narrow. It never executes shell, never writes, and
// every tool is served by this plugin (see fs-tools.js), so the blast radius is
// a read. Turn and call caps bound the token bill, and the caller decides what
// happens to whatever the model names.
import { randomUUID } from 'node:crypto'

const REVIEW_SESSION_ID = randomUUID()

const DEFAULT_MAX_TURNS = 6
const DEFAULT_MAX_CALLS = 18
const MAX_TOKENS = 4000
const TIMEOUT_MS = 240_000

/** One tool declaration in the shape the host llm service expects. */
export function declaration(name, description, parameters) {
  return { name, description, parameters }
}

function textOf(block) {
  return block && block.type === 'text' ? String(block.text || '') : ''
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw
  const text = String(raw || '').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Run one bounded tool loop.
 *
 * @param {object} ctx - host context, used only to reach the llm service.
 * @param {object} opts
 * @param {string} opts.system - system prompt.
 * @param {string} opts.goal - first user message: what to look for.
 * @param {Function} opts.route - () => {provider, model}.
 * @param {Array} opts.tools - [{ name, description, parameters, run(input) }].
 * @param {number} [opts.maxTurns] - model turns, cap DEFAULT_MAX_TURNS.
 * @param {number} [opts.maxCalls] - tool calls across the loop.
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onCall] - (name, input, resultText) => void, for tracing.
 */
export async function runAgentLoop(ctx, opts) {
  const llm = ctx && typeof ctx.get === 'function' ? ctx.get('llm') : null
  if (!llm || typeof llm.prepareCall !== 'function') throw new Error('the host llm service is not available')
  const route = typeof opts.route === 'function' ? opts.route() : opts.route
  if (!route || !route.provider || !route.model) throw new Error('no model route is configured')

  const maxTurns = Number(opts.maxTurns) > 0 ? Math.min(Number(opts.maxTurns), 10) : DEFAULT_MAX_TURNS
  const maxCalls = Number(opts.maxCalls) > 0 ? Math.min(Number(opts.maxCalls), 40) : DEFAULT_MAX_CALLS
  const tools = (opts.tools || []).filter((tool) => tool && tool.name)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const declarations = tools.map((tool) => declaration(tool.name, tool.description, tool.parameters))
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const external = opts.signal
  const onAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }

  const messages = [{
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(opts.goal || '') }],
    source: { kind: 'dsh-sweeper' },
  }]

  const trace = []
  const summary = { turns: 0, calls: 0, text: '', finished: false }
  try {
    for (let turn = 0; turn < maxTurns; turn += 1) {
      // One prepared call per turn: the host marks a prepared call dispatched
      // once, so a loop that reused it would fail on the second model turn.
      const call = await llm.prepareCall({ ...route, maxTokens: MAX_TOKENS }, controller.signal, (controls) => controls)
      summary.turns = turn + 1
      const blocks = new Map()
      let text = ''
      const order = []
      for await (const chunk of call.stream({
        ...call.config,
        messages,
        system: opts.system,
        tools: declarations.length > 0 ? declarations : undefined,
        sessionId: REVIEW_SESSION_ID,
        purpose: 'sweeper-agent',
        signal: controller.signal,
      })) {
        if (chunk && chunk.type === 'block-end' && chunk.block) {
          const block = chunk.block
          order.push(block)
          if (block.type === 'text') text += block.text || ''
        } else if (chunk && chunk.type === 'block-start') {
          blocks.set(chunk.index, { type: chunk.blockType })
        }
      }
      const calls = order.filter((block) => block.type === 'tool-call')
      if (calls.length === 0) {
        summary.text = text
        summary.finished = true
        break
      }
      messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: order.filter((block) => block.type === 'text' || block.type === 'tool-call'),
        source: { kind: 'model', provider: route.provider, model: route.model },
      })
      for (const block of calls) {
        if (summary.calls >= maxCalls) {
          messages.push(toolMessage(block.id, 'tool call budget for this conversation is used up; answer with what you have', true))
          continue
        }
        const tool = byName.get(block.name)
        const input = parseArguments(block.arguments)
        let output = ''
        let failed = false
        if (!tool) {
          output = 'unknown tool: ' + String(block.name)
          failed = true
        } else if (input === null) {
          output = 'arguments were not valid JSON; send an object'
          failed = true
        } else {
          summary.calls += 1
          try {
            output = String(await tool.run(input) || '')
          } catch (err) {
            output = 'tool failed: ' + ((err && err.message) || String(err))
            failed = true
          }
        }
        if (output.length > 6000) output = output.slice(0, 6000) + '\n… (truncated)'
        trace.push({ turn: summary.turns, tool: String(block.name), input: summarizeInput(input), ok: !failed, out: output.slice(0, 400) })
        if (typeof opts.onCall === 'function') {
          try { opts.onCall(block.name, input, output) } catch { /* tracing must never break the loop */ }
        }
        messages.push(toolMessage(block.id, output, failed))
      }
      summary.text = text
    }
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
  return { ...summary, trace }
}

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return null
  const out = {}
  for (const key of ['path', 'dir', 'depth', 'limit', 'minBytes', 'pattern']) {
    if (input[key] !== undefined) out[key] = input[key]
  }
  return out
}

function toolMessage(callId, text, isError) {
  return {
    id: randomUUID(),
    role: 'tool',
    toolCallId: callId,
    content: [{ type: 'text', text }],
    isError: !!isError,
    source: { kind: 'tool', callId },
  }
}
