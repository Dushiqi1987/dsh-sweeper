// Path rules are the quiet load-bearing part of "never delete the wrong thing":
// a boundary check that misses by one character turns a scratch file into a
// workspace wipe. These assertions cover the shapes that actually show up in
// session logs (mixed separators, trailing slashes, dot/space suffixes, UNC).

import { WIN, isAbsPath, normKey, tidyPath, dirOf, baseOf, joinPath, depthOf, isInside } from '../lib/paths.js'

const fails = []
const check = (name, ok, detail) => {
  if (ok) console.log('  ✓ ' + name)
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

if (WIN) {
  check('drive path is absolute', isAbsPath('C:\\a'))
  check('forward slashes are absolute too', isAbsPath('C:/a'))
  check('UNC is absolute', isAbsPath('\\\\server\\share\\x'))
  check('relative path is not absolute', !isAbsPath('a\\b'))
  check('POSIX-only path is not absolute on Windows', !isAbsPath('/home/u'))

  check('normKey unifies separators and case', normKey('C:/A/b') === 'c:\\a\\b', normKey('C:/A/b'))
  check('normKey drops a trailing separator', normKey('D:\\a\\b\\') === normKey('D:\\a\\b'), normKey('D:\\a\\b\\'))
  check('normKey keeps the drive root', normKey('D:\\') === 'd:\\', normKey('D:\\'))
  check('normKey strips trailing dots and spaces', normKey('D:\\a\\b. ') === 'd:\\a\\b', normKey('D:\\a\\b. '))
  check('normKey rejects relative paths', normKey('a\\b') === null)

  check('isInside is true for a child', isInside('D:\\a\\b\\c', 'D:\\a\\b'))
  check('isInside is true with a trailing separator on either side', isInside('D:\\a\\b\\', 'D:\\a\\b') && isInside('D:\\a\\b', 'D:\\a\\b\\'))
  check('isInside is true for the same path', isInside('D:\\a\\b', 'd:/a/b'))
  check('isInside is false for a sibling with a shared prefix', !isInside('D:\\a\\bc', 'D:\\a\\b'), 'prefix trap')
  check('isInside is false across drives', !isInside('E:\\a', 'D:\\a'))
  check('isInside tolerates mixed separators', isInside('D:/a/b/c', 'D:\\a\\b'))

  check('tidyPath prefers backslashes but keeps case', tidyPath('D:/A/b') === 'D:\\A\\b', tidyPath('D:/A/b'))
  check('dirOf and baseOf split the last segment', dirOf('D:\\a\\b.txt') === 'D:\\a' && baseOf('D:\\a\\b.txt') === 'b.txt')
  check('joinPath does not double the separator', joinPath('D:\\a\\', 'b') === 'D:\\a\\b', joinPath('D:\\a\\', 'b'))
  check('depthOf counts segments below the root', depthOf('D:\\a\\b') === 2 && depthOf('D:\\') === 0)
} else {
  check('POSIX path is absolute', isAbsPath('/home/u/x') && !isAbsPath('home/u/x'))
  check('normKey keeps case on POSIX', normKey('/A/b') === '/A/b')
  check('normKey drops a trailing separator', normKey('/home/u/') === '/home/u')
  check('isInside is true for a child', isInside('/home/u/x', '/home/u'))
  check('isInside is false for a sibling with a shared prefix', !isInside('/home/ux', '/home/u'))
  check('isInside is false for a relative path', !isInside('home/u/x', '/home/u'))
  check('dirOf and baseOf split the last segment', dirOf('/a/b.txt') === '/a' && baseOf('/a/b.txt') === 'b.txt')
  check('joinPath does not double the separator', joinPath('/a/', 'b') === '/a/b')
}

console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\npaths pass OK')
process.exitCode = fails.length ? 1 : 0
