// Read-only filesystem tools for the model loop.
//
// Everything here is a read: directory listing, one stat, and a bounded walk.
// No writes, no rename, no deletes, no shell. Paths are clamped to the roots a
// single conversation owns, and DSH's own state is refused even inside those
// roots, so a model cannot be talked into listing ~/.dsh by a session log that
// happens to contain that path.
import fs from 'node:fs'
import path from 'node:path'
import { WIN, normKey, isInside, baseOf } from './paths.js'

const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', 'target'])
const MAX_ENTRIES = 60
const MAX_WALK = 400

function human(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

function day(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return 'unknown'
  return new Date(n).toISOString().slice(0, 10)
}

/**
 * Build the tool set for one conversation.
 *
 * @param {object} opts
 * @param {string[]} opts.roots - absolute directories this conversation may look at.
 * @param {string[]} opts.deny - absolute directories that are never listed (DSH state).
 */
export function makeFsTools(opts) {
  const roots = (opts.roots || []).filter((root) => typeof root === 'string' && root.length > 0).map((root) => normKey(root))
  const deny = (opts.deny || []).filter((root) => typeof root === 'string' && root.length > 0).map((root) => normKey(root))

  /** Resolve and authorise one path, or explain why not. */
  function allow(raw) {
    const text = String(raw || '').trim()
    if (text === '') return { error: 'path is required' }
    if (/[\n\r\u0000]/.test(text)) return { error: 'path contains control characters' }
    let real
    try {
      real = fs.realpathSync.native ? fs.realpathSync.native(text) : fs.realpathSync(text)
    } catch {
      return { error: 'no such file or directory: ' + text }
    }
    const key = normKey(real)
    if (!key) return { error: 'not an absolute path: ' + text }
    for (const bad of deny) if (isInside(key, bad)) return { error: 'refused: that path belongs to DSH itself' }
    if (roots.length > 0 && !roots.some((root) => isInside(key, root) || key === root)) {
      return { error: 'refused: that path is outside the directories this conversation wrote to' }
    }
    return { key, real }
  }

  const listDir = {
    name: 'list_dir',
    description: 'List one directory: names, sizes, and last-modified dates, largest first. Use this to see what a run left behind before deciding what is dead.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute directory path.' },
        limit: { type: 'integer', description: 'How many entries to show, 1-60.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run(input) {
      const ok = allow(input && input.path)
      if (ok.error) throw new Error(ok.error)
      const st = fs.lstatSync(ok.real)
      if (!st.isDirectory()) throw new Error('not a directory: ' + input.path)
      const limit = Math.max(1, Math.min(MAX_ENTRIES, Number(input.limit) || MAX_ENTRIES))
      const rows = []
      for (const name of fs.readdirSync(ok.real)) {
        let item
        try { item = fs.lstatSync(path.join(ok.real, name)) } catch { continue }
        if (item.isSymbolicLink()) continue
        rows.push({ name, size: item.isDirectory() ? -1 : item.size, dir: item.isDirectory(), mtime: item.mtimeMs })
      }
      rows.sort((a, b) => (b.size - a.size) || a.name.localeCompare(b.name))
      const total = rows.length
      const shown = rows.slice(0, limit)
      const lines = shown.map((row) => (row.dir ? '      dir  ' : human(row.size).padStart(9)) + '  ' + day(row.mtime) + '  ' + row.name)
      return ok.real + '\n' + lines.join('\n') + (total > shown.length ? '\n… ' + (total - shown.length) + ' more entries not shown' : '')
    },
  }

  const statPath = {
    name: 'stat_path',
    description: 'Report one path: whether it is a file or directory, its size, and when it was last modified.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path.' } },
      required: ['path'],
      additionalProperties: false,
    },
    run(input) {
      const ok = allow(input && input.path)
      if (ok.error) throw new Error(ok.error)
      const st = fs.lstatSync(ok.real)
      return [
        'path: ' + ok.real,
        'kind: ' + (st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other'),
        'size: ' + (st.isDirectory() ? '(directory)' : human(st.size)),
        'modified: ' + day(st.mtimeMs),
      ].join('\n')
    },
  }

  const findFiles = {
    name: 'find_files',
    description: 'Walk a directory tree and list files matching a name pattern and/or a minimum size. Use minBytes to hunt large leftovers (e.g. 52428800 for 50 MB).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute directory to start from.' },
        pattern: { type: 'string', description: 'Case-insensitive substring of the file name, or a wildcard like *.bin.' },
        minBytes: { type: 'integer', description: 'Only report files at least this large.' },
        depth: { type: 'integer', description: 'How deep to walk, 1-6. Default 3.' },
        limit: { type: 'integer', description: 'How many files to show, 1-60.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run(input) {
      const ok = allow(input && input.path)
      if (ok.error) throw new Error(ok.error)
      if (!fs.lstatSync(ok.real).isDirectory()) throw new Error('not a directory: ' + input.path)
      const depth = Math.max(1, Math.min(6, Number(input.depth) || 3))
      const limit = Math.max(1, Math.min(MAX_ENTRIES, Number(input.limit) || MAX_ENTRIES))
      const minBytes = Math.max(0, Number(input.minBytes) || 0)
      const pattern = String((input && input.pattern) || '').trim()
      const wildcard = pattern.includes('*') ? new RegExp('^' + pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i') : null
      const hit = (name) => {
        if (!pattern) return true
        return wildcard ? wildcard.test(name) : name.toLowerCase().includes(pattern.toLowerCase())
      }
      const found = []
      let walked = 0
      const walk = (dir, level) => {
        if (level > depth || walked > MAX_WALK) return
        let names
        try { names = fs.readdirSync(dir) } catch { return }
        for (const name of names) {
          walked += 1
          if (walked > MAX_WALK) return
          const full = path.join(dir, name)
          let st
          try { st = fs.lstatSync(full) } catch { continue }
          if (st.isSymbolicLink()) continue
          if (st.isDirectory()) {
            if (SKIP.has(name.toLowerCase())) continue
            walk(full, level + 1)
            continue
          }
          if (!st.isFile()) continue
          if (st.size < minBytes) continue
          if (!hit(name)) continue
          found.push({ full, size: st.size, mtime: st.mtimeMs })
        }
      }
      walk(ok.real, 1)
      found.sort((a, b) => b.size - a.size)
      const shown = found.slice(0, limit)
      if (shown.length === 0) return ok.real + '\nno file matched'
      return ok.real + '\n' + shown.map((row) => human(row.size).padStart(9) + '  ' + day(row.mtime) + '  ' + row.full).join('\n')
        + (found.length > shown.length ? '\n… ' + (found.length - shown.length) + ' more matches not shown' : '')
    },
  }

  return [listDir, statPath, findFiles]
}

/** The directories a conversation may look at: its workspace plus scratch subtrees. */
export function rootsFor(cwd, extra) {
  const out = []
  const add = (value) => {
    const text = String(value || '').trim()
    if (text === '') return
    if (!out.some((seen) => normKey(seen) === normKey(text))) out.push(text)
  }
  add(cwd)
  for (const value of extra || []) add(value)
  return out
}

/** Short label for a path, used in traces so a log line stays one line. */
export function labelOf(target) {
  return baseOf(String(target || ''))
}

export const _internal = { human, day, WIN }
