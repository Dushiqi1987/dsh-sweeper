/**
 * dsh-sweeper · reversible quarantine.
 *
 * Deleting means "move into the plugin's own trash directory", never unlink.
 * Every batch is a directory with a manifest.json; restoring moves files back
 * to their original absolute path and refuses to overwrite anything that
 * reappeared in the meantime. Permanent removal only happens on an explicit
 * purge of a batch.
 */

import { copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
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

const norm = (p) => String(p || '').replace(/\//g, '\\').toLowerCase()

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

  const n = norm(raw)
  for (const root of protectedRoots()) {
    if (isInside(n, root)) return 'inside DSH state'
  }

  let real
  try { real = await realpath(raw) } catch { return 'gone' }
  if (norm(real) !== n) return 'path crosses a link or junction'
  try {
    const st = await stat(real)
    if (!st.isFile()) return 'not a regular file'
  } catch { return 'gone' }
  return null
}

function protectedRoots() {
  return [dshHome(), join(homedir(), '.agents'), trashRoot()].map(norm)
}

/** Path sanity for a restore target coming out of an on-disk manifest. */
export function restoreTargetProblem(p) {
  if (typeof p !== 'string' || !p) return 'empty path'
  const raw = p.trim()
  if (!isAbsPath(raw)) return 'not an absolute path'
  if (raw.includes('..')) return 'path contains ..'
  const n = norm(raw)
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

const readManifest = async (dir) => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))

export async function listBatches() {
  const root = trashRoot()
  let names = []
  try { names = await readdir(root) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!safeId(name)) continue
    let manifest
    try { manifest = await readManifest(join(root, name)) } catch { continue }
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
  if (!Array.isArray(items) || !items.length) throw new Error('nothing selected')
  if (items.length > MAX_BATCH) throw new Error('too many items in one batch (max ' + MAX_BATCH + ')')

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
    try { await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8') } catch { /* best effort */ }
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

export async function restore(id) {
  if (!safeId(id)) throw new Error('bad batch id')
  const dir = join(trashRoot(), id)
  const manifest = await readManifest(dir)
  const restored = []
  const failed = []
  const keep = []

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
    try { await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8') } catch { /* ignore */ }
  }
  return { id, restored: restored.length, restoredPaths: restored, failed, remaining: keep.length }
}

export async function purge(id) {
  if (!safeId(id)) throw new Error('bad batch id')
  const dir = join(trashRoot(), id)
  let count = 0
  try { count = (await readManifest(dir)).entries.length } catch { count = 0 }
  await rm(dir, { recursive: true, force: true })
  return { id, purged: true, count }
}

export function describeBatch(id) {
  return join(trashRoot(), String(id))
}
