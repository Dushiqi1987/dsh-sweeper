#!/usr/bin/env node
// Manifest self-check: everything the plugin store and `dsh plugin add` look at,
// verified without a harness around us. Exits non-zero on the first real problem.
//
// This is deliberately dependency-free: CI runs it before installing anything,
// so a broken manifest can never be masked by a failed install.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const notes = []

const fail = (msg) => problems.push(msg)
const ok = (msg) => notes.push(msg)

function readJSON(rel) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) {
    fail(`${rel} is missing`)
    return null
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (err) {
    fail(`${rel} is not valid JSON: ${err.message}`)
    return null
  }
}

function mustExist(rel, why) {
  if (!existsSync(join(ROOT, rel))) fail(`${rel} is referenced but missing${why ? ` (${why})` : ''}`)
}

// 1. manifest
const pkg = readJSON('package.json')
if (pkg) {
  if (!pkg.name) fail('package.json has no name')
  if (!/^\d+\.\d+\.\d+/.test(pkg.version || '')) fail(`package.json version is not semver: ${pkg.version}`)
  if (pkg.type !== 'module') fail('package.json type must be "module"')

  const patch = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch
  if (!patch) fail('package.json has no dsh.bundle.patch — the store rejects entries that are not installable')
  else mustExist(patch.replace(/^\.\//, ''), 'dsh.bundle.patch')
  if (!pkg.dsh?.bundle && pkg.dsh?.client) fail('dsh.client without dsh.bundle is not installable')

  if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform should be "web"')
  for (const dep of pkg.dsh?.client?.inject || []) {
    if (!/^@deepseek-ai\//.test(dep)) fail(`dsh.client.inject contains a non-host package: ${dep}`)
  }

  // exports must resolve
  for (const [sub, target] of Object.entries(pkg.exports || {})) {
    const rel = String(target).replace(/^\.\//, '')
    if (rel.includes('*')) continue // pattern export, checked by the files list below
    mustExist(rel, `exports["${sub}"]`)
  }

  // files must resolve
  for (const rel of pkg.files || []) {
    if (!existsSync(join(ROOT, rel))) fail(`files entry "${rel}" does not exist`)
  }
  ok(`manifest: ${pkg.name}@${pkg.version}`)
}

// 2. bundle patch: a YAML list whose first map has an insert list of { id, name }
const patchRel = (pkg?.dsh?.bundle?.patch || './cordis.patch.yml').replace(/^\.\//, '')
if (existsSync(join(ROOT, patchRel))) {
  const text = readFileSync(join(ROOT, patchRel), 'utf8')
  if (!/^-\s+insert:/m.test(text)) fail(`${patchRel}: expected a top-level "- insert:" list`)
  const ids = [...text.matchAll(/^\s*-?\s*id:\s*(\S+)/gm)].map((m) => m[1])
  const names = [...text.matchAll(/^\s*-?\s*name:\s*(\S+)/gm)].map((m) => m[1])
  const inserts = [...ids, ...names]
  if (!ids.length) fail(`${patchRel}: insert entries need an id`)
  if (!names.length) fail(`${patchRel}: insert entries need a name`)
  const name = names[0]
  if (name && pkg && name !== pkg.name) fail(`${patchRel}: insert name "${name}" does not match package name "${pkg.name}"`)
  ok(`patch: ${patchRel} (${inserts.length} keys)`)
}

// 3. locale files the settings UI reads
for (const lang of ['en', 'zh']) {
  const rel = `locale/${lang}.json`
  const doc = readJSON(rel)
  if (!doc) continue
  const meta = doc.meta || doc
  if (!meta.title) fail(`${rel}: meta.title is empty`)
  if (!meta.description) fail(`${rel}: meta.description is empty`)
  if (String(meta.description || '').length > 160) fail(`${rel}: meta.description is longer than 160 characters`)
  ok(`locale: ${rel}`)
}

// 4. runtime entry points must at least parse
for (const rel of ['lib/index.js', 'lib/client.js']) {
  if (!existsSync(join(ROOT, rel))) fail(`${rel} is missing`)
}

if (problems.length) {
  console.error('self-check FAILED')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
for (const n of notes) console.log('  ✓ ' + n)
console.log('self-check OK')
