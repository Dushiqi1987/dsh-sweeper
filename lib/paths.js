/**
 * Path rules that work on every OS the desktop app runs on.
 *
 * Nothing here is machine specific: roots always come from the environment
 * (DSH_HOME / home directory / temp dir) or from paths found in session logs,
 * so the same bundle behaves the same on a fresh computer.
 */

export const WIN = process.platform === 'win32'

const WIN_DRIVE = /^[A-Za-z]:[\\/]/
const WIN_UNC = /^\\\\[^\\/]+[\\/][^\\/]+/
const POSIX_ABS = /^\//

/** Absolute path on the current platform, plus Windows shapes when running on Windows. */
export function isAbsPath(p) {
  if (typeof p !== 'string' || !p) return false
  if (WIN) return WIN_DRIVE.test(p) || WIN_UNC.test(p)
  return POSIX_ABS.test(p)
}

/**
 * Comparison key for a path: one separator, no trailing dots/spaces, and
 * lower case only where the filesystem is case insensitive.
 */
export function normKey(p) {
  if (typeof p !== 'string' || !p) return null
  let s = p.trim()
  if (WIN) s = s.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
  else s = s.replace(/\/{2,}/g, '/')
  if (!isAbsPath(s)) return null
  s = s.replace(WIN ? /[. ]+$/ : /[. ]+$/, '')
  return WIN ? s.toLowerCase() : s
}

/** Same separators as normKey but preserves case (for showing paths to people). */
export function tidyPath(p) {
  const s = String(p || '').trim()
  if (!s) return s
  return WIN ? s.replace(/\//g, '\\') : s.replace(/\/{2,}/g, '/')
}

/** Everything before the last separator. */
export function dirOf(p) {
  const s = tidyPath(p)
  const i = WIN ? s.lastIndexOf('\\') : s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : s
}

/** File name without its directory. */
export function baseOf(p) {
  const s = tidyPath(p)
  const i = WIN ? s.lastIndexOf('\\') : s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

/** Join with the platform separator without doubling it. */
export function joinPath(dir, name) {
  const d = tidyPath(dir).replace(WIN ? /\\+$/ : /\/+$/, '')
  return d + (WIN ? '\\' : '/') + name
}

/** Number of segments below the filesystem root (C:\a\b -> 2, /a/b -> 2). */
export function depthOf(p) {
  const s = tidyPath(p)
  const root = WIN ? (WIN_DRIVE.test(s) ? s.slice(0, 3) : '') : '/'
  const rest = s.slice(root.length)
  return rest.split(/[\\/]+/).filter(Boolean).length
}

/** True when `child` sits inside `parent` (or is the same path). */
export function isInside(child, parent) {
  const a = normKey(child)
  const b = normKey(parent)
  if (!a || !b) return false
  if (a === b) return true
  return a.startsWith(b.endsWith(WIN ? '\\' : '/') ? b : b + (WIN ? '\\' : '/'))
}
