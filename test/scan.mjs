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
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(fails.length ? '\nFAIL\n- ' + fails.join('\n- ') : '\nscan pass OK')
process.exitCode = fails.length ? 1 : 0
