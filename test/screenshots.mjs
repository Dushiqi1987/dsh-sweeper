// Guards the store screenshot strip.
//
// The market does not read images from the catalog entry any more: it probes
// `screenshots.json` at the root of the plugin's own repository, resolves each
// relative path against `raw.githubusercontent.com/<owner>/<repo>/HEAD/`, and
// checks the object is alive. A typo, a renamed file or an SVG therefore ends up
// as a missing tile with nothing failing in our own CI.
//
// Everything here is offline: paths must be relative and must exist in this
// checkout, and PNG dimensions are read from the IHDR chunk so a portrait
// fragment or a stray badge cannot sneak in.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'screenshots.json')
const MAX = 8
const MIN_WIDTH = 1200
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

let failures = 0
function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures += 1; console.log(`  ✗ ${label}`) }
}

/** Width/height from a PNG's IHDR chunk, or null for anything else. */
function pngSize(file) {
  const buf = fs.readFileSync(file)
  const signature = '89504e470d0a1a0a'
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== signature) return null
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

if (!fs.existsSync(MANIFEST)) {
  console.log('screenshots.json is missing; the store will fall back to README images')
  process.exit(0)
}

let doc
try {
  doc = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
} catch (err) {
  console.log(`✗ screenshots.json is not valid JSON: ${err.message}`)
  process.exit(1)
}

const list = Array.isArray(doc) ? doc : Array.isArray(doc?.screenshots) ? doc.screenshots : null
ok(list !== null, 'screenshots.json is an array, or {"screenshots": [...]}')
ok(Array.isArray(list) && list.length > 0 && list.length <= MAX, `it declares 1..${MAX} images`)
ok(Array.isArray(list) && list.every((s) => typeof s === 'string' && s.trim() !== ''), 'every entry is a non-empty string')

for (const raw of Array.isArray(list) ? list : []) {
  const rel = String(raw).trim()
  const label = rel || String(raw)
  if (/^https?:\/\//i.test(rel)) {
    ok(/^https:\/\/(raw\.githubusercontent\.com|user-images\.githubusercontent\.com|camo\.githubusercontent\.com|github\.com)\//i.test(rel), `${label} uses an allowlisted GitHub host`)
    continue
  }
  ok(!rel.startsWith('/') && !rel.split('/').includes('..'), `${label} stays inside the repository`)
  ok(RASTER.has(path.extname(rel).toLowerCase()), `${label} is a raster image the market will render`)
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) { ok(false, `${label} exists in this checkout`); continue }
  ok(true, `${label} exists in this checkout`)
  const size = path.extname(abs).toLowerCase() === '.png' ? pngSize(abs) : null
  if (size !== null) {
    ok(size.width >= MIN_WIDTH, `${label} is at least ${MIN_WIDTH}px wide (${size.width}px)`)
    ok(size.width > size.height, `${label} is landscape (${size.width}×${size.height})`)
  }
}

console.log(failures === 0 ? 'screenshots OK' : `${failures} screenshot problem(s)`)
process.exit(failures === 0 ? 0 : 1)
