/**
 * dsh-sweeper · reversible quarantine.
 *
 * Deleting means "move into the plugin's own trash directory", never unlink.
 * Every batch is a directory with a manifest.json; restoring moves files back
 * to their original absolute path and refuses to overwrite anything that
 * reappeared in the meantime. Permanent removal only happens on an explicit
 * purge of a batch.
 */

import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const MAX_BATCH = 5000

export function dshHome() {
  const env = process.env.DSH_HOME
  if (env && env.trim()) return resolve(env.trim())
  return join(homedir(), '.dsh')
}

export function trashRoot() {
  return join(dshHome(), 'plugin-data', 'dsh-sweeper', 'trash')
}


import { WIN, isAbsPath, normKey, joinPath, isInside } from './paths.js'

/**
 * Everything that must never be quarantined, independent of what the scan says.
 * Returns null when the path is acceptable, otherwise a short reason.
 */
export async function rejectionReason(p) {
  if (typeof p !== 'string' || !p) return 'empty path'
  const raw = p.trim()
  if (!isAbsPath(raw)) return 'not an absolute path'
  if (raw.includes('..')) return 'path contains ..'
  if (raw.replace(/[.\\ ]+$/, '').length !== raw.replace(/[. ]+$/, '').length) return 'path ends with a dot or space'
  const depth = raw.split(WIN ? /[\\/]+/ : /\/+/).filter(Boolean).length
  if (depth < 3) return 'refuses to touch a drive root or top-level directory'

  const n = normKey(raw)
  for (const root of protectedRoots()) {
    if (isInside(n, root)) return 'inside DSH state'
  }

  let real
  try { real = await realpath(raw) } catch { return 'gone' }
  if (normKey(real) !== n) return 'path crosses a link or junction'
  try {
    const st = await stat(real)
    if (!st.isFile()) return 'not a regular file'
  } catch { return 'gone' }
  return null
}

function protectedRoots() {
  return [dshHome(), join(homedir(), '.agents'), trashRoot()].map((x) => normKey(x))
}

/** Path sanity for a restore target coming out of an on-disk manifest. */
export function restoreTargetProblem(p) {
  if (typeof p !== 'string' || !p) return 'empty path'
  const raw = p.trim()
  if (!isAbsPath(raw)) return 'not an absolute path'
  if (raw.includes('..')) return 'path contains ..'
  const n = normKey(raw)
  for (const root of protectedRoots()) {
    if (isInside(n, root)) return 'refuses to restore into DSH state'
  }
  return null
}

/** Move a file across volumes: rename first, fall back to copy+unlink. */
async function moveFile(src, dest) {
  try {
    await rename(src, dest)
    return { mode: 'rename' }
  } catch (err) {
    const code = err && err.code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err
  }
  await copyFile(src, dest)
  try {
    await unlink(src)
  } catch (err) {
    try { await unlink(dest) } catch { /* ignore */ }
    throw err
  }
  return { mode: 'copy' }
}

function batchId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

const safeId = (id) => /^[a-z0-9]+-[a-z0-9]+$/i.test(String(id || ''))

// A bad request must not reach the client as a 500: retrying would never help,
// and the page would say "the service returned 500, try again".
const badRequest = (message) => Object.assign(new Error(message), { status: 400 })

const readManifest = async (dir) => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))

/**
 * A manifest is the only record of where each file came from; a half-written
 * one strands an entire batch. Write beside it and rename over it, so readers
 * see either the previous manifest or the next one, never a torn file.
 */
async function writeManifest(dir, manifest) {
  const final = join(dir, 'manifest.json')
  const tmp = join(dir, 'manifest.json.tmp')
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  await rename(tmp, final)
}

export async function listBatches() {
  const root = trashRoot()
  let names = []
  try { names = await readdir(root) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!safeId(name)) continue
    let manifest
    try { manifest = await readManifest(join(root, name)) } catch {
      // The files are still on disk and still recoverable by hand; hiding the
      // batch would make the quarantine look empty. Report what is there.
      let files = []
      try { files = await readdir(join(root, name), { withFileTypes: true }) } catch { files = [] }
      const kept = files.filter((f) => f.isFile() && f.name !== 'manifest.json' && !f.name.endsWith('.tmp'))
      let bytes = 0
      for (const f of kept) { try { bytes += (await stat(join(root, name, f.name))).size } catch { /* ignore */ } }
      out.push({ id: name, createdAt: 0, kind: 'quarantine', note: '', count: kept.length, bytes, damaged: true })
      continue
    }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : []
    out.push({
      id: name,
      createdAt: manifest.createdAt || 0,
      kind: manifest.kind || 'quarantine',
      note: manifest.note || '',
      count: entries.length,
      bytes: entries.reduce((s, e) => s + (e.size || 0), 0),
    })
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

/**
 * Move `paths` into a new trash batch.
 * @param {{path:string,key:string,size:number,mtime:number,tier?:string,reasons?:string[]}[]} items
 */
export async function quarantine(items, meta = {}) {
  if (!Array.isArray(items) || !items.length) throw badRequest('nothing selected')
  if (items.length > MAX_BATCH) throw badRequest('too many items in one batch (max ' + MAX_BATCH + ')')

  const id = batchId()
  const dir = join(trashRoot(), id)
  await mkdir(dir, { recursive: true })

  const manifest = {
    id,
    createdAt: Date.now(),
    kind: 'quarantine',
    note: String(meta.note || '').slice(0, 200),
    plugin: 'dsh-sweeper',
    entries: [],
  }
  const failed = []
  let index = 0

  for (const item of items) {
    const reason = await rejectionReason(item.path)
    if (reason) { failed.push({ path: item.path, reason }); continue }
    let st
    try { st = await stat(item.path) } catch { failed.push({ path: item.path, reason: 'gone' }); continue }
    if (item.size != null && st.size !== item.size) { failed.push({ path: item.path, reason: 'changed size since the scan' }); continue }
    if (item.mtime != null && Math.abs(st.mtimeMs - item.mtime) > 1000) { failed.push({ path: item.path, reason: 'modified since the scan' }); continue }

    index += 1
    const rel = String(index).padStart(4, '0') + '-' + basename(item.path).replace(/[^\w.@-]+/g, '_').slice(0, 80)
    const dest = join(dir, rel)
    try {
      await moveFile(item.path, dest)
    } catch (err) {
      failed.push({ path: item.path, reason: (err && err.code) || String(err) })
      continue
    }

    // The copy path can truncate silently on a full disk: trust but verify.
    let moved = 0
    try { moved = (await stat(dest)).size } catch { moved = -1 }
    if (moved !== st.size) {
      try { await moveFile(dest, item.path) } catch { /* ignore */ }
      failed.push({ path: item.path, reason: 'copy was incomplete; put back' })
      continue
    }

    manifest.entries.push({
      key: item.key || null,
      orig: item.path,
      rel,
      size: st.size,
      mtime: st.mtimeMs,
      tier: item.tier || null,
      reasons: item.reasons || [],
      at: Date.now(),
    })
    // Write after every move so a crash never loses the mapping.
    try { await writeManifest(dir, manifest) } catch { /* best effort */ }
  }

  if (!manifest.entries.length) {
    try { await rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    throw new Error('nothing could be moved: ' + (failed[0] ? failed[0].reason : 'unknown'))
  }
  return {
    batch: {
      id,
      createdAt: manifest.createdAt,
      count: manifest.entries.length,
      bytes: manifest.entries.reduce((s, e) => s + (e.size || 0), 0),
    },
    moved: manifest.entries.map((e) => e.key).filter(Boolean),
    movedPaths: manifest.entries.map((e) => e.orig),
    failed,
  }
}

/**
 * Two operations on the same batch (restore vs purge) would race: purge removes
 * the directory while restore is still moving files out of it, or restore writes
 * the manifest after purge deleted it. One lock per batch id, in process.
 */
const busy = new Set()
function lockBatch(id) {
  if (busy.has(id)) {
    const err = new Error('batch is busy: ' + id + ' is being restored or purged right now')
    err.status = 409
    throw err
  }
  busy.add(id)
  return () => busy.delete(id)
}

export async function restore(id) {
  if (!safeId(id)) throw badRequest('bad batch id')
  const unlock = lockBatch(id)
  const dir = join(trashRoot(), id)
  const restored = []
  const failed = []
  const keep = []
  try {
    const manifest = await readManifest(dir)
    for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
      const src = join(dir, String(entry.rel || ''))
      if (!entry.rel || entry.rel.includes('..') || entry.rel.includes('/') || entry.rel.includes('\\')) {
        failed.push({ path: entry.orig, reason: 'bad manifest entry' })
        keep.push(entry)
        continue
      }
      try { await stat(src) } catch {
        failed.push({ path: entry.orig, reason: 'missing from trash' })
        continue
      }
      const problem = restoreTargetProblem(entry.orig)
      if (problem) {
        failed.push({ path: entry.orig, reason: problem })
        keep.push(entry)
        continue
      }
      try {
        const st = await stat(entry.orig).catch(() => null)
        if (st) { failed.push({ path: entry.orig, reason: 'a file already exists there' }); keep.push(entry); continue }
        await mkdir(dirname(entry.orig), { recursive: true })
        await moveFile(src, entry.orig)
        restored.push(entry.orig)
      } catch (err) {
        failed.push({ path: entry.orig, reason: (err && err.code) || String(err) })
        keep.push(entry)
      }
    }
    if (!keep.length) {
      try { await rm(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    } else {
      manifest.entries = keep
      try { await writeManifest(dir, manifest) } catch { /* ignore */ }
    }
    return { id, restored: restored.length, restoredPaths: restored, failed, remaining: keep.length }
  } finally {
    unlock()
  }
}

/** Count the files a damaged batch still holds, so the page can state a number. */
async function countFiles(dir) {
  let n = 0
  let names = []
  try { names = await readdir(dir) } catch { return 0 }
  for (const name of names) {
    if (name === 'manifest.json' || name === 'manifest.json.tmp') continue
    const full = join(dir, name)
    // lstat, not stat: a symlink inside a batch must not be followed and must
    // not be counted as if it were one of the quarantined files.
    const st = await lstat(full).catch(() => null)
    if (!st) continue
    if (st.isSymbolicLink()) continue
    n += st.isDirectory() ? await countFiles(full) : st.isFile() ? 1 : 0
  }
  return n
}

export async function purge(id) {
  if (!safeId(id)) throw badRequest('bad batch id')
  const unlock = lockBatch(id)
  try {
    const dir = join(trashRoot(), id)
    let count = 0
    let manifest = null
    try { manifest = await readManifest(dir) } catch { manifest = null }
    let existed = true
    try { await stat(dir) } catch { existed = false }
    // An unreadable manifest used to mark the batch as gone, so purging a
    // damaged batch answered 404 "already gone" right after deleting its files.
    if (manifest && Array.isArray(manifest.entries)) count = manifest.entries.length
    else if (existed) count = await countFiles(dir)
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      const err = new Error('a file in that batch is still open by another program')
      err.status = 409
      err.code = 'BATCH_IN_USE'
      throw err
    }
    return { id, purged: existed, missing: !existed, count }
  } finally {
    unlock()
  }
}

export function describeBatch(id) {
  return join(trashRoot(), String(id))
}
