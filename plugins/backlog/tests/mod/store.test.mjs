import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, modeOf, openItems, stripMeta, numbered, HEADER, META } from '../../hooks/store.js'

test('normalize replaces CR and LF with spaces and trims', () => {
  assert.equal(normalize('  a\r\nb\nc  '), 'a  b c')
  assert.equal(normalize(''), '')
})

test('modeOf selects list, review, empty and add; prefixes are add', () => {
  assert.equal(modeOf('list'), 'list')
  assert.equal(modeOf('LIST'), 'list')
  assert.equal(modeOf('Review'), 'review')
  assert.equal(modeOf(''), 'empty')
  assert.equal(modeOf('review the auth retry logic'), 'add')
  assert.equal(modeOf('x'), 'add')
})

test('openItems returns open lines without the prefix', () => {
  const content = `${HEADER}- [ ] alpha (2026-01-01, branch: main)\n- [x] gone (2026-01-01)\n- [ ] beta (2026-01-02)\n`
  assert.deepEqual(openItems(content), ['alpha (2026-01-01, branch: main)', 'beta (2026-01-02)'])
  assert.deepEqual(openItems(''), [])
})

test('stripMeta removes the trailing metadata only', () => {
  assert.equal(stripMeta('fix login (2026-10-01, branch: main, by: claude)'), 'fix login')
  assert.equal(stripMeta('ends with (parens) (2026-10-01)'), 'ends with (parens)')
  assert.equal(stripMeta('no meta'), 'no meta')
  assert.ok(META.test(' (2026-10-01, branch: feat/x)'))
})

test('numbered formats from 1', () => {
  assert.equal(numbered(['a', 'b']), '1. a\n2. b')
})

import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { locate, rootRefused, checkLinks, list, Refused } from '../../hooks/store.js'
import { nodeIo } from './node-io.mjs'

async function scratch() { return realpath(await mkdtemp(join(tmpdir(), 'backlog-mod-'))) }
function gitInit(dir) { execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']) }

test('locate: git root and unborn branch from a subdirectory', async () => {
  const dir = await scratch(); gitInit(dir); await mkdir(join(dir, 'src/sub'), { recursive: true })
  assert.deepEqual(await locate(nodeIo(), join(dir, 'src/sub')), { root: dir, branch: 'main' })
})

test('locate: non-git directory is its own root without a branch', async () => {
  const dir = await scratch()
  assert.deepEqual(await locate(nodeIo(), dir), { root: dir, branch: null })
})

test('locate: detached HEAD has no branch', async () => {
  const dir = await scratch(); gitInit(dir)
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init'])
  execFileSync('git', ['-C', dir, 'checkout', '-q', '--detach'])
  assert.equal((await locate(nodeIo(), dir)).branch, null)
})

test('rootRefused for .git and .claude components only', () => {
  assert.equal(rootRefused('/a/.git/hooks'), true)
  assert.equal(rootRefused('/a/.claude'), true)
  assert.equal(rootRefused('/a/my.claude.repo'), false)
})

test('checkLinks refuses a symlinked folder or file with the Python wording', async () => {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, 'outside.md'), 'x')
  await symlink(join(dir, 'outside.md'), join(dir, '.backlog/backlog.md'))
  await assert.rejects(checkLinks(nodeIo(), join(dir, '.backlog')), (e) => e instanceof Refused && e.message === `${dir}/.backlog/backlog.md is a symlink`)
})

test('list: items, empty file, missing file', async () => {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, '.backlog/backlog.md'), '# Backlog\n\n- [ ] alpha (2026-01-01)\n- [x] gone (2026-01-01)\n')
  assert.deepEqual(await list(nodeIo(), dir), ['alpha (2026-01-01)'])
  const empty = await scratch()
  assert.deepEqual(await list(nodeIo(), empty), [])
})
