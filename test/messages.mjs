// Contract: every message the server can show a user has a Chinese mapping in
// the client's REASONS table.
//
// This started as a real bug report: a failed move came back as
// "changed size since the scan" and the toast read 清理失败：changed size since
// the scan — half English, on the one screen where the user is deciding whether
// their file is safe. The table drifted because nothing connected the two files.

import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

// Pull the array literal out of client.js by bracket matching rather than by
// line numbers, so edits above or below it cannot silently skip the check.
function reasonsTable(src) {
  const at = src.indexOf('const REASONS = [')
  if (at < 0) throw new Error('REASONS table not found in lib/client.js')
  let depth = 0
  let i = src.indexOf('[', at)
  const start = i
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) break }
    else if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ } }
  }
  const literal = src.slice(start, i + 1)
  return new Function('return ' + literal)()
}

const reasons = reasonsTable(read('../lib/client.js'))

const messages = new Set()
for (const f of ['index', 'trash', 'scan', 'deep', 'review']) {
  const src = read('../lib/' + f + '.js')
  for (const m of src.matchAll(/fail\(\s*\d+\s*,\s*'([^']+)'/g)) messages.add(m[1])
  for (const m of src.matchAll(/throw new Error\('([^']+)'/g)) messages.add(m[1])
  for (const m of src.matchAll(/badRequest\('([^']+)'/g)) messages.add(m[1])
  for (const m of src.matchAll(/reason:\s*'([^']+)'/g)) messages.add(m[1])
}

const unmapped = [...messages].filter((m) => !reasons.some(([re]) => re.test(m))).sort()

console.log('server messages: ' + messages.size + ', mapped: ' + (messages.size - unmapped.length))
if (unmapped.length) {
  for (const m of unmapped) console.log('  ✗ unmapped: ' + m)
  console.log('\nAdd a Chinese entry to REASONS in lib/client.js for each line above.')
  process.exit(1)
}
console.log('messages pass OK')
