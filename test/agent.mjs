// Tests for the tool loop's two riskiest halves: what it may look at, and what
// it is allowed to propose. Everything here is offline — no model, no host.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeFsTools, rootsFor } from '../lib/fs-tools.js'
import { parseVerdict, insideWorkspace, looksLikePath } from '../lib/deep-agent.js'
import { vetDeepResult } from '../lib/deep.js'

let failures = 0
function check(name, ok, detail) {
  if (ok) { console.log('  ✓ ' + name); return }
  failures += 1
  console.log('  ✗ ' + name + (detail === undefined ? '' : ' [' + JSON.stringify(detail) + ']'))
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-agent-test-'))
const nested = path.join(tmp, 'nested')
fs.mkdirSync(nested, { recursive: true })
fs.writeFileSync(path.join(tmp, 'small.md'), 'hello\n')
fs.writeFileSync(path.join(tmp, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 1))
fs.writeFileSync(path.join(nested, 'deep.txt'), 'x\n')
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-agent-outside-'))
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-agent-elsewhere-'))
fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope\n')

// --- what the model may read ------------------------------------------------
const tools = makeFsTools({ roots: rootsFor(tmp), deny: [outside] })
const byName = new Map(tools.map((t) => [t.name, t]))

{
  const out = await byName.get('list_dir').run({ path: tmp })
  check('list_dir shows sizes largest first', out.indexOf('big.bin') > 0 && out.indexOf('2.0 MB') > 0, out.split('\n').slice(0, 3))
  check('list_dir skips the nested directory contents', !out.includes('deep.txt'))
}
{
  const out = await byName.get('find_files').run({ path: tmp, minBytes: 1024 * 1024, depth: 3 })
  check('find_files honours minBytes', out.includes('big.bin') && !out.includes('small.md'), out)
}
{
  const out = await byName.get('find_files').run({ path: tmp, pattern: '*.txt', depth: 3 })
  check('find_files honours a wildcard', out.includes('deep.txt') && !out.includes('small.md'), out)
}
{
  let refused = false
  try { await byName.get('list_dir').run({ path: elsewhere }) } catch (err) { refused = /outside the directories/i.test(err.message) }
  check('a path outside the roots is refused', refused)
}
{
  let refused = false
  try { await byName.get('list_dir').run({ path: path.join(tmp, 'nope') }) } catch (err) { refused = /no such file/i.test(err.message) }
  check('a missing path is reported, not invented', refused)
}
{
  const denied = makeFsTools({ roots: [tmp], deny: [tmp] })
  let refused = false
  try { await denied[0].run({ path: tmp }) } catch (err) { refused = /belongs to DSH itself/i.test(err.message) }
  check('a denied root is refused even when it is also an allowed one', refused)
}

// --- what the answer may contain -------------------------------------------
{
  const verdict = parseVerdict([
    'S D:\\work\\.scratch\\a.mjs | one-off script',
    '- O i3 | probably dead',
    '**K** C:\\work\\keep.md | needed',
  ].join('\n'))
  check('S lines with a path are parsed', verdict.sweep.length === 1 && verdict.sweep[0].id.startsWith('D:\\'), verdict.sweep)
  check('an id is kept as an id', verdict.optional[0] && verdict.optional[0].id === 'i3', verdict.optional)
  check('the reason is separated from the target', verdict.sweep[0].reason === 'one-off script', verdict.sweep[0])
}
{
  const verdict = parseVerdict('I think the big file is dead.\nSome prose.')
  check('prose without a verdict line is not turned into a verdict', verdict.sweep.length === 0 && verdict.garbage.length === 2, verdict.garbage)
}
{
  check('a Windows path is recognised as a path', looksLikePath('D:\\x\\y.txt') && !looksLikePath('i7'))
  check('a path inside the workspace is accepted', insideWorkspace(path.join(tmp, 'small.md'), tmp))
  check('a path outside the workspace is refused', !insideWorkspace(path.join(outside, 'secret.txt'), tmp))
  check('an id is not mistaken for a path', !insideWorkspace('i2', tmp))
}

// --- what the server will accept -------------------------------------------
{
  const target = path.join(tmp, 'small.md')
  const session = { id: 's1', title: 't', cwd: tmp, ageDays: 9, _candidates: [] }
  const veto = await vetDeepResult(session, { sweep: [{ id: target, reason: 'leftover' }], optional: [] })
  check('a discovered path inside the workspace becomes a candidate', veto.sweep.length === 1, veto)
  check('a discovered file is never in the one-click tier', veto.sweep[0] && veto.sweep[0].tier === 'unsure', veto.sweep[0])
  check('the model reason survives vetting', veto.sweep[0] && veto.sweep[0].reasons[0] === 'leftover', veto.sweep[0])
}
{
  const session = { id: 's1', title: 't', cwd: tmp, ageDays: 9, _candidates: [] }
  const veto = await vetDeepResult(session, { sweep: [{ id: path.join(outside, 'secret.txt'), reason: 'x' }], optional: [] })
  check('a path outside the workspace is rejected', veto.rejected.length === 1 && veto.sweep.length === 0, veto)
}
{
  const session = { id: 's1', title: 't', cwd: tmp, ageDays: 9, _candidates: [] }
  const veto = await vetDeepResult(session, { sweep: [{ id: 'i9', reason: 'x' }], optional: [] })
  check('an id nobody sent is rejected', veto.rejected.length === 1 && /not one of the files/i.test(veto.rejected[0].reason), veto.rejected)
}
{
  const session = { id: 's1', title: 't', cwd: tmp, ageDays: 9, _candidates: [] }
  const veto = await vetDeepResult(session, { sweep: [{ id: path.join(tmp, 'missing.txt'), reason: 'x' }], optional: [] })
  check('a path that no longer exists is rejected', veto.rejected.length === 1, veto.rejected)
}

try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* temp only */ }
try { fs.rmSync(outside, { recursive: true, force: true }) } catch { /* temp only */ }
try { fs.rmSync(elsewhere, { recursive: true, force: true }) } catch { /* temp only */ }

console.log(failures === 0 ? 'agent pass OK' : 'FAIL')
process.exit(failures === 0 ? 0 : 1)
