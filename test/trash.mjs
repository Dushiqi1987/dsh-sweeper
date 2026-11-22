/**
 * Offline test for the quarantine: it must move rather than delete, restore the
 * exact bytes, and refuse two operations on one batch at the same time.
 *
 *   node test/trash.mjs
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keyOf } from './helpers.mjs'

const root = await mkdtemp(join(tmpdir(), 'dsh-sweeper-trash-'))
process.env.DSH_HOME = join(root, 'home')

const { quarantine, restore, purge, listBatches, trashRoot } = await import('../lib/trash.js')
const { normKey } = await import('../lib/paths.js')

const fails = []
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name)
  else { console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); fails.push(name) }
}

const work = join(root, 'work')
await mkdir(join(work, 'nested'), { recursive: true })
const fileA = join(work, 'a.txt')
const fileB = join(work, 'nested', 'b.txt')
const payload = 'hello world\n'
await writeFile(fileA, payload)
await writeFile(fileB, payload)

const item = (p, size) => ({ key: keyOf(p), path: p, size, tier: 'safe', kind: 'scratch', mtime: Date.now() })
const batch = await quarantine([item(fileA, payload.length), item(fileB, payload.length)], { note: 'test' })

check('quarantine returns a batch', !!(batch && batch.batch && batch.batch.count === 2), JSON.stringify(batch && batch.batch))
check('the files really left their old place', await readFile(fileA, 'utf8').then(() => false).catch(() => true))
check('the batch shows up in the list', (await listBatches()).length === 1)
check('trash lives under DSH_HOME', normKey(trashRoot()).startsWith(normKey(process.env.DSH_HOME)))

const restored = await restore(batch.batch.id)
check('restore puts both back', restored.restored === 2, 'restored=' + restored.restored)
check('restore names the files it put back', Array.isArray(restored.restoredPaths) && restored.restoredPaths.length === 2,
  JSON.stringify(restored.restoredPaths))
check('the bytes survive the round trip', (await readFile(fileA, 'utf8')) === payload)
check('a fully restored batch disappears from the list', (await listBatches()).length === 0)

// restore vs purge on the same batch: exactly one may win.
const again = await quarantine([item(fileA, payload.length)], { note: 'race' })
const id = again.batch.id
const results = await Promise.allSettled([restore(id), purge(id)])
const okCount = results.filter((r) => r.status === 'fulfilled').length
const rejected = results.find((r) => r.status === 'rejected')
check('one of restore/purge wins, the other is refused', okCount === 1, 'fulfilled=' + okCount)
check('the loser gets a 409, not a stack trace', !!(rejected && rejected.reason && rejected.reason.status === 409),
  rejected && rejected.reason && String(rejected.reason.message))

// A torn manifest must not hide the files: the page has to show the batch so
// the disk can still be reclaimed, and must refuse to promise a restore.
const damaged = await quarantine([item(fileA, payload.length)], { note: 'damaged' })
await writeFile(join(trashRoot(), damaged.batch.id, 'manifest.json'), '{"entries": [', 'utf8')
const listed = (await listBatches()).find((b) => b.id === damaged.batch.id)
check('a corrupt manifest is reported, not skipped', !!listed && listed.damaged === true, JSON.stringify(listed))
check('the damaged batch still counts its files', !!listed && listed.count === 1, listed && String(listed.count))
const noTmp = await readFile(join(trashRoot(), damaged.batch.id, 'manifest.json.tmp')).then(() => 'left behind').catch(() => '')
check('the atomic writer leaves no temporary file', noTmp === '', noTmp)

// Purging something that is already gone says so instead of claiming success.
const missing = await purge('mnever0-xxxxxx')
check('purging a vanished batch reports missing', missing.purged === false && missing.missing === true, JSON.stringify(missing))

await rm(root, { recursive: true, force: true })
console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\ntrash OK')
process.exitCode = fails.length ? 1 : 0
