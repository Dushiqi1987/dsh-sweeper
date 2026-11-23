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

const { quarantine, restore, purge, listBatches, trashRoot, rejectionReason } = await import('../lib/trash.js')
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

// A damaged batch still has to be deletable: an unreadable manifest used to be
// read as "the batch is gone", so the one path a user has to reclaim that space
// answered 404 after the files were already deleted.
const gone = await purge(damaged.batch.id)
check('a damaged batch can still be purged', gone.purged === true && gone.missing === false, JSON.stringify(gone))
check('and the purge counts the files it removed', gone.count === 1, String(gone.count))
check('the damaged batch is off the list afterwards', (await listBatches()).length === 0)

// Clicking delete twice (two tabs, or an impatient double click) must not look
// like a crash the second time.
await writeFile(fileA, payload)
const twice = await quarantine([item(fileA, payload.length)], { note: 'twice' })
await purge(twice.batch.id)
const second = await purge(twice.batch.id)
check('purging the same batch twice answers missing the second time',
  second.purged === false && second.missing === true, JSON.stringify(second))

// The protected-root check compared with a Windows-shaped normaliser, so on a
// POSIX host `DSH_HOME` never matched and its files were not refused at all.
{
  const inside = join(process.env.DSH_HOME, 'session-state.json')
  await writeFile(inside, 'state')
  const reason = await rejectionReason(inside)
  check('a file inside DSH_HOME is refused', reason === 'inside DSH state', 'reason=' + reason)
  const agents = join(process.env.HOME || process.env.USERPROFILE || tmpdir(), '.agents', 'note.md')
  const reason2 = await rejectionReason(agents)
  check('a path in ~/.agents is refused too', /inside DSH state|gone/.test(String(reason2)), 'reason=' + reason2)
}

// A malformed batch id used to surface as a 500, which reads like a server
// fault and invites a retry that can never work.
{
  const statusOf = async (fn) => { try { await fn(); return 0 } catch (e) { return (e && e.status) || 0 } }
  check('restoring a malformed batch id is a client error',
    (await statusOf(() => restore('nope'))) === 400)
  check('purging a malformed batch id is a client error',
    (await statusOf(() => purge('nope'))) === 400)
  check('quarantining nothing is a client error',
    (await statusOf(() => quarantine([]))) === 400)
}

await rm(root, { recursive: true, force: true })
console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\ntrash OK')
process.exitCode = fails.length ? 1 : 0
