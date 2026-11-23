/**
 * The replay server serves hand-written fixtures. If a fixture lacks a field
 * the real host sends, the browser check still passes and proves nothing —
 * the page was never asked to render that field. This test compares the
 * fixtures with a real capture (`test/browser/sample.json`, produced by the
 * in-host self-test with `captureReport`).
 *
 *   node test/contract.mjs
 */
import { readFile } from 'node:fs/promises'
import { REPORT } from './browser/fixtures.mjs'

const sample = JSON.parse(await readFile(new URL('./browser/sample.json', import.meta.url), 'utf8'))
const real = sample.report || {}

const fails = []
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name)
  else { console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); fails.push(name) }
}

// Fields the published view adds on top of the raw report object.
const PUBLISHED = ['token', 'ageMs', 'trashRoot', 'lastError']
const missing = (want, have) => want.filter((k) => !have.includes(k))

// The real response carries fields the page never reads (item.lastUseAt,
// report.home, stats.liveSessions...). Only the fields the client actually
// touches have to exist in the fixture — otherwise this test would ask for a
// copy of the whole response and stop being read.
//
// Names that also occur at another nesting level make a plain ".name" search
// ambiguous: `hints` is read on the review payload and `candidates` on a
// deep-plan session row, not on the report itself.
const AMBIGUOUS = { report: ['hints', 'home'], stats: ['candidates'] }
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const usedByClient = (key) => new RegExp('\\.' + key + '\\b').test(client)
const onlyUsed = (keys, level) =>
  keys.filter((k) => usedByClient(k) && !(AMBIGUOUS[level] || []).includes(k))

const realTop = onlyUsed(Object.keys(real), 'report')
const fixtureTop = Object.keys(REPORT).concat(PUBLISHED)
check('every report field the page reads exists in the fixture',
  missing(realTop, fixtureTop).length === 0, missing(realTop, fixtureTop).join(','))

const realItem = (real.items && real.items[0]) || {}
const fixtureItem = (REPORT.items && REPORT.items[0]) || {}
const missingItem = missing(onlyUsed(Object.keys(realItem), 'item'), Object.keys(fixtureItem))
check('every item field the page reads exists in the fixture', missingItem.length === 0, missingItem.join(','))

// Nested objects the page reads directly.
for (const key of ['stats', 'protected']) {
  const want = onlyUsed(Object.keys(real[key] || {}), key)
  const have = Object.keys(REPORT[key] || {})
  const gap = missing(want, have)
  check('report.' + key + ' covers the real fields', gap.length === 0, gap.join(','))
}
for (const key of ['safe', 'unsure']) {
  const want = Object.keys((real.tiers || {})[key] || {})
  const have = Object.keys((REPORT.tiers || {})[key] || {})
  const gap = missing(want, have)
  check('report.tiers.' + key + ' covers the real fields', gap.length === 0, gap.join(','))
}

// A fixture path with a doubled separator renders as "C:\\Users" on screen and
// nobody notices, because both slashes come from the same fake string.
const paths = [REPORT.trashRoot].concat(REPORT.items.map((i) => i.path))
const doubled = paths.filter((p) => typeof p === 'string' && p.includes('\\\\'))
check('fixture paths are not double-escaped', doubled.length === 0, doubled.join(' | '))

// Every quarantine note the server can write must have a Chinese label, or the
// bin shows an English chip for that batch (which is how "model proposal" and
// "manual selection" slipped through).
const server = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const notes = new Set()
for (const m of server.matchAll(/note:\s*'([^']+)'/g)) notes.add(m[1])
for (const m of server.matchAll(/\?\s*'(deep review|model proposal|manual selection)'/g)) notes.add(m[1])
const labelBlock = (client.match(/const NOTE_LABELS = \{([\s\S]*?)\}/) || [])[1] || ''
const labelled = new Set([...labelBlock.matchAll(/(?:^|[\s,{])(?:'([^']+)'|([a-z]+))\s*:/g)]
  .map((m) => m[1] || m[2]))
const unlabelled = [...notes].filter((n) => !labelled.has(n))
check('every quarantine note has a Chinese label', unlabelled.length === 0,
  unlabelled.join(',') + (notes.size ? '' : ' (no notes found)'))

console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\ncontract OK')
process.exitCode = fails.length ? 1 : 0
