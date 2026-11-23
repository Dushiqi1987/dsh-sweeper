/**
 * Offline test for the git guard: a file git tracks must never become a delete
 * candidate. A worktree (or a submodule) keeps a `.git` *file* at the root
 * instead of a directory, so a check that only accepted directories reported
 * "not a repository" and let every tracked file through.
 *
 *   node test/scan.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { _internal } = await import('../lib/scan.js')

const fails = []
const check = (name, ok, detail) => {
  if (ok) { console.log('  ✓ ' + name); return }
  fails.push(name + (detail ? ' [' + detail + ']' : ''))
  console.log('  ✗ ' + name + (detail ? ' [' + detail + ']' : ''))
}

const root = await mkdtemp(join(tmpdir(), 'dsh-sweeper-scan-'))
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, windowsHide: true, stdio: 'ignore' })

try {
  const repo = join(root, 'repo')
  await mkdir(repo)
  await writeFile(join(repo, 'app.js'), 'x')
  git(repo, 'init', '-q')
  git(repo, 'add', 'app.js')
  git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'one')

  check('a tracked file reports tracked',
    (await _internal.gitTracked(join(repo, 'app.js'), new Map())) === true)

  await writeFile(join(repo, 'loose.tmp'), 'x')
  check('an untracked file reports untracked',
    (await _internal.gitTracked(join(repo, 'loose.tmp'), new Map())) === false)

  const loose = join(root, 'loose')
  await mkdir(loose)
  await writeFile(join(loose, 'x.tmp'), 'x')
  check('a folder with no repository reports norepo',
    (await _internal.gitTracked(join(loose, 'x.tmp'), new Map())) === 'norepo')

  const tree = join(root, 'tree')
  git(repo, 'worktree', 'add', '-q', tree)
  const inWorktree = await _internal.gitTracked(join(tree, 'app.js'), new Map())
  check('a git worktree keeps the tracked file tracked', inWorktree === true, 'result=' + inWorktree)
  // A relative mention in a log must map to the same suffix key the artefact
  // keys use. The old code folded separators to backslashes and lowercased
  // unconditionally, so on POSIX it never matched and a file used through a
  // relative path was never counted as used.
  const probe = join(repo, 'src', 'deep', 'probe.mjs')
  const want = _internal.last2(_internal.normKey(probe))
  check('a relative mention maps to the artefact suffix key',
    _internal.relKey('src/deep/probe.mjs') === want,
    _internal.relKey('src/deep/probe.mjs') + ' vs ' + want)
  check('mixed separators map to the same key',
    _internal.relKey('src\\deep\\probe.mjs') === want)
  check('a bare file name is not a relative reference',
    _internal.relKey('probe.mjs') === '')
  if (process.platform === 'win32') {
    check('windows folds case so a differently-cased mention still matches',
      _internal.relKey('SRC/Deep/Probe.MJS') === want)
  } else {
    check('posix keeps case so a different path stays a different file',
      _internal.relKey('SRC/Deep/Probe.MJS') !== want)
  }

} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\nscan pass OK')
process.exitCode = fails.length ? 1 : 0
