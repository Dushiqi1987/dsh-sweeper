// Regression check for the review tab: after a review finishes, the verdicts
// must STILL be on screen once the report refresh that follows has landed.
// v1.2.5 shipped because that refresh used to wipe them (load() called
// setReview(null) unconditionally), leaving the user with a flash.
//
// It boots the replay server, drives the page in headless Chrome and inspects
// the DOM after the virtual clock has run past the refresh.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8799)
const URL = `http://127.0.0.1:${PORT}/?mode=review&stop=2500`
const BUDGET = 20000

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Users/杜世旗/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const chrome = CHROMES.find((p) => existsSync(p))
if (!chrome) {
  console.log('SKIP: no Chrome/Edge found; set CHROME=<path> to run this check')
  process.exit(0)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const server = spawn(process.execPath, [path.join(here, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let ready = false
server.stdout.on('data', (b) => {
  if (String(b).includes('ready http')) ready = true
})
server.stderr.on('data', (b) => process.stderr.write(b))

const fails = []
const ok = (cond, msg) => (cond ? console.log('PASS ' + msg) : (fails.push(msg), console.log('FAIL ' + msg)))

try {
  for (let i = 0; i < 50 && !ready; i++) await wait(100)
  if (!ready) throw new Error('replay server did not start')

  const dom = await new Promise((resolve, reject) => {
    const p = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      `--user-data-dir=${path.join(here, '.chrome-' + process.pid)}`,
      `--virtual-time-budget=${BUDGET}`,
      '--dump-dom',
      URL,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => (out += b))
    p.stderr.on('data', (b) => (err += b))
    p.on('error', reject)
    p.on('close', () => (out ? resolve(out) : reject(new Error('chrome gave no DOM: ' + err.slice(0, 300)))))
  })

  ok(/已移入回收站/.test(dom), 'the verdict cards survive the refresh that follows a review')
  ok(/待你决定|待你确认/.test(dom), 'the asking card is still there after the refresh')
  const text = dom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  ok(!/undefined|NaN|\(\s*\)/.test(text), 'no blank, undefined or NaN cells')
} catch (e) {
  fails.push(String(e && e.message ? e.message : e))
  console.log('FAIL ' + e.message)
} finally {
  server.kill()
}

if (fails.length) {
  console.log('\n' + fails.length + ' check(s) failed')
  process.exit(1)
}
console.log('\nreview-tab regression check OK')
