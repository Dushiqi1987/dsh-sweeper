// Cross-platform guards for the test suite.
//
// Twice now a test passed on this Windows box and turned the first push red on
// every Linux runner. Both times the shape was the same: a path that was only
// special on Windows (a normalised key, a drive letter) used as if it meant the
// same thing everywhere. Each red costs a full CI cycle and a re-push, so the
// shapes get a cheap static check before they reach CI.
//
// Scope note: only the files that touch the real filesystem are checked. The
// SSR harness renders Windows-looking strings on purpose — it never stats them
// — and flagging those would train everyone to ignore the guard.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

// Files that call into fs / compare keys. Add a file here when it starts doing so.
const FILES = ['test/deep.mjs', 'test/trash.mjs', 'test/paths.mjs', 'test/scan.mjs']

const FS_CALL = /\b(?:writeFile|readFile|appendFile|mkdir|mkdtemp|rm|rmSync|unlink|symlink|statSync|lstatSync|existsSync|quarantine|restore|purge|scan|planDeep|vetDeepResult|candidatesOf)\b/

const RULES = [
  {
    id: 'no-lowercase',
    re: /\.toLowerCase\(\)/,
    why: 'keys are normalised by normKey(); toLowerCase() only matches on a case-insensitive filesystem',
    applies: () => true,
  },
  {
    id: 'no-raw-key',
    re: /\bkey:\s*(?:p|path|raw)\b\s*[,}]/,
    why: 'a candidate key must be normKey(p) / keyOf(p), not the raw path',
    applies: (line) => !/keyOf\(|normKey\(/.test(line),
  },
  {
    id: 'no-drive-literal-into-fs',
    re: /['"`][A-Za-z]:\\\\/,
    why: 'a drive-letter literal is only absolute on Windows; derive fixtures from tmpdir() and joinPath()',
    applies: (line) => FS_CALL.test(line) && !/process\.platform/.test(line),
  },
  {
    id: 'no-assumed-separator',
    re: /\.split\(['"`]\\\\['"`]\)|['"`]\\\\['"`]\.join\(/,
    why: 'split/join on a hard-coded backslash assumes Windows; use dirOf/baseOf/joinPath',
    applies: () => true,
  },
]

// Library files worth checking too, but only for the separator rule: their
// .toLowerCase() calls are about extensions, hostnames and uuids, not keys.
const LIB_FILES = ['lib/scan.js', 'lib/deep.js', 'lib/trash.js', 'lib/index.js', 'lib/review.js']
const SEPARATOR = RULES.filter((r) => r.id === 'no-assumed-separator')

const problems = []
for (const rel of FILES) {
  const file = join(root, rel)
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { continue }
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue
      if (!rule.applies(line)) continue
      if (rule.id === 'no-drive-literal-into-fs' && rel === 'test/paths.mjs' && /\bif \(WIN\)/.test(text)) continue
      problems.push(`${rel}:${i + 1} [${rule.id}] ${line.trim()}\n    ${rule.why}`)
    }
  })
}

for (const rel of LIB_FILES) {
  const file = join(root, rel)
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { continue }
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    for (const rule of SEPARATOR) {
      if (!rule.re.test(line)) continue
      problems.push(`${rel}:${i + 1} [${rule.id}] ${line.trim()}\n    ${rule.why}`)
    }
  })
}

if (problems.length) {
  console.error('cross-platform guards failed:\n')
  for (const p of problems) console.error('  ' + p + '\n')
  console.error(`${problems.length} problem(s). A red first push costs a whole CI cycle — fix these before pushing.`)
  process.exit(1)
}

console.log(`cross-platform guards OK (${FILES.length} test files + ${LIB_FILES.length} lib files)`)
