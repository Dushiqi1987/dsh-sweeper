// Fixtures shared by the test files.
//
// The recurring CI failure in this repo has one shape: a test that builds a
// path, compares it to a raw path string, and passes on Windows while failing
// on a case-sensitive filesystem. Keys are always normalised through
// `normKey()` so a test means the same thing on both.

import { normKey } from '../lib/paths.js'

/** The key a candidate gets after the normalisation the plugin applies. */
export const keyOf = (p) => normKey(String(p))

/** A candidate fixture whose key is normalised the same way scan.js does it. */
export const cand = (p, size, extra = {}) => ({
  key: normKey(String(p)),
  path: String(p),
  size,
  kind: 'scratch',
  tool: 'write',
  ...extra,
})

/** Compare a list of produced keys against paths, without caring about case. */
export const sameKeys = (produced, paths) => {
  const want = new Set(paths.map(keyOf))
  const got = produced.map((k) => (typeof k === 'string' ? k : k && k.key))
  return got.length === want.size && got.every((k) => want.has(k))
}
