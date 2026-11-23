// Guards the store listing's discoverability: the plugin must be findable for
// the words people actually type, not just for its package name.
//
// The market matches name, owner, description and category — there is no
// keywords field. So the description carries the search terms, and this test
// fails when a rewrite drops one.
//
//   node test/market-search.mjs            # checks the entry in this repo
//   node test/market-search.mjs --live     # also checks the published listing

import { readFileSync } from 'node:fs'
import { entryMatches } from './market-search.mjs'

const ENTRY = {
  name: 'Dushiqi1987/dsh-sweeper',
  url: 'https://github.com/Dushiqi1987/dsh-sweeper',
  category: 'tools',
  description: {
    en: readEntry('en'),
    zh: readEntry('zh'),
  },
}

// Words a user types when their disk is filling up and they do not know what
// the plugin is called. Every one of these must reach this entry.
const QUERIES = [
  '清理内存',
  '释放内存',
  '清理对话',
  '清理垃圾',
  '清理',
  '垃圾',
  '内存',
  '对话',
  '缓存',
  '临时文件',
  '磁盘空间',
  '空间',
  '回收站',
  'clean up',
  'cleanup',
  'free up space',
  'free up memory',
  'disk space',
  'junk',
  'temporary files',
  'cache',
  'trash',
]

function readEntry(locale) {
  const src = readFileSync(new URL('../data/entry.yml', import.meta.url), 'utf8')
  const m = src.match(new RegExp('^  ' + locale + ": '(.*)'$", 'm'))
  if (!m) throw new Error('description.' + locale + ' not found in data/entry.yml')
  // split/join rather than replaceAll: the CI matrix still runs node 14.
  return m[1].split("''").join("'")
}

const missing = QUERIES.filter((q) => !entryMatches(ENTRY, q, '工具与能力'))
console.log('queries: ' + QUERIES.length + ', reachable: ' + (QUERIES.length - missing.length))
if (missing.length) {
  for (const q of missing) console.log('  ✗ not reachable: ' + q)
  console.log('\nAdd the missing words to the description in data/entry.yml (and the live entry).')
  process.exit(1)
}
console.log('market search pass OK')
