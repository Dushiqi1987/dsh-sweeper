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

function dumpDom(url) {
  return new Promise((resolve, reject) => {
    const p = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      `--user-data-dir=${path.join(here, '.chrome-' + process.pid + '-' + Math.random().toString(36).slice(2, 7))}`,
      `--virtual-time-budget=${BUDGET}`,
      '--dump-dom',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => (out += b))
    p.stderr.on('data', (b) => (err += b))
    p.on('error', reject)
    p.on('close', () => (out ? resolve(out) : reject(new Error('chrome gave no DOM: ' + err.slice(0, 300)))))
  })
}

try {
  for (let i = 0; i < 50 && !ready; i++) await wait(100)
  if (!ready) throw new Error('replay server did not start')

  const dom = await dumpDom(URL)

  ok(/已移入回收站/.test(dom), 'the verdict cards survive the refresh that follows a review')
  ok(/待你决定|待你确认/.test(dom), 'the asking card is still there after the refresh')
  const text = dom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  ok(!/undefined|NaN|\(\s*\)/.test(text), 'no blank, undefined or NaN cells')

  // Empty walkthrough: with nothing to clean the page must say one thing, not
  // two empty sections sitting under a "it is clean" card.
  const emptyServer = spawn(process.execPath, [path.join(here, 'server.mjs')], {
    env: { ...process.env, PORT: String(PORT + 1), EMPTY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let emptyReady = false
  emptyServer.stdout.on('data', (b) => { if (String(b).includes('ready http')) emptyReady = true })
  try {
    for (let i = 0; i < 50 && !emptyReady; i++) await wait(100)
    if (!emptyReady) throw new Error('empty replay server did not start')
    const emptyDom = await dumpDom(`http://127.0.0.1:${PORT + 1}/?mode=tab&tab=report`)
    const emptyText = emptyDom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    ok(/很干净，没有发现对话垃圾/.test(emptyText), 'the empty report says it is clean')
    ok(!/没有可以无脑删的东西/.test(emptyText), 'no empty tier sections contradict the clean message')
    ok(!/没有需要你判断的条目/.test(emptyText), 'the second tier section is hidden too')
  } finally {
    emptyServer.kill()
  }

  // Trash tab: every batch kind must render a Chinese label. "model proposal"
  // used to fall through to the raw English string.
  const trashDom = await dumpDom(`http://127.0.0.1:${PORT}/?mode=trash&stop=2500`)
  const trashText = trashDom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  ok(/模型建议/.test(trashText), 'a model-proposal batch is labelled in Chinese')
  ok(!/model proposal/.test(trashText), 'no raw English note leaks into the bin')

  // The permanent-delete dialog used to ship literal markdown (**无法恢复**),
  // which renders as two asterisks around the most important word on screen.
  const purgeDom = await dumpDom(`http://127.0.0.1:${PORT}/?mode=purge&stop=3000`)
  const purgeText = purgeDom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  ok(/无法恢复/.test(purgeText), 'the purge dialog warns that it cannot be undone')
  ok(!/\*\*/.test(purgeText), 'the purge dialog shows no raw markdown')

  // A restarted host forgets the job. The panel must say so instead of sitting
  // on "分析中…" with a frozen bar forever.
  const lostServer = spawn(process.execPath, [path.join(here, 'server.mjs')], {
    env: { ...process.env, PORT: String(PORT + 2), LOST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let lostReady = false
  lostServer.stdout.on('data', (b) => { if (String(b).includes('ready http')) lostReady = true })
  try {
    for (let i = 0; i < 50 && !lostReady; i++) await wait(100)
    if (!lostReady) throw new Error('lost replay server did not start')
    const lostDom = await dumpDom(`http://127.0.0.1:${PORT + 2}/?mode=deep&stop=5000`)
    const lostText = lostDom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    ok(/后台已经没有这次分析的记录/.test(lostText), 'a vanished job is reported, not spun forever')
    ok(!/分析中…/.test(lostText), 'the lost job is no longer shown as running')
  } finally {
    lostServer.kill()
  }
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
