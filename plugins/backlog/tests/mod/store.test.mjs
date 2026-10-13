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

import { readFile, utimes, rmdir, access } from 'node:fs/promises'
import { add, HEADER as H, DATA_NOTE, MAX_LEN } from '../../hooks/store.js'

const io = () => nodeIo({ today: '2026-01-01' })
const read = (dir) => readFile(join(dir, '.backlog/backlog.md'), 'utf8')

test('add: first add creates folder, .gitignore, header and the line', async () => {
  const dir = await scratch()
  const marker = await add(io(), { root: dir, branch: 'main', text: 'add tests', byClaude: false })
  assert.equal(marker, `BACKLOG_ADDED: add tests\n${DATA_NOTE}`)
  assert.equal(await readFile(join(dir, '.backlog/.gitignore'), 'utf8'), '*\n')
  assert.equal(await read(dir), `${H}- [ ] add tests (2026-01-01, branch: main)\n`)
  await assert.rejects(access(join(dir, '.backlog/.lock')))
})

test('add: by claude, no branch, appends after a missing trailing newline', async () => {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, '.backlog/backlog.md'), '# Backlog\n\n- [ ] old (2026-01-01)')
  await add(io(), { root: dir, branch: null, text: 'new', byClaude: true })
  assert.equal(await read(dir), '# Backlog\n\n- [ ] old (2026-01-01)\n- [ ] new (2026-01-01, by: claude)\n')
})

test('add: duplicate ignoring case and metadata writes nothing', async () => {
  const dir = await scratch()
  await add(io(), { root: dir, branch: 'main', text: 'Dedupe Me', byClaude: false })
  const before = await read(dir)
  assert.equal(await add(io(), { root: dir, branch: 'main', text: 'dedupe me', byClaude: true }), `BACKLOG_DUPLICATE: dedupe me\n${DATA_NOTE}`)
  assert.equal(await read(dir), before)
})

test('add: text over 2000 characters is refused', async () => {
  const dir = await scratch()
  await assert.rejects(add(io(), { root: dir, branch: null, text: 'x'.repeat(MAX_LEN + 1), byClaude: false }),
    (e) => e instanceof Refused && e.message === `the item is longer than ${MAX_LEN} characters`)
})

test('add: shell characters are stored literally', async () => {
  const dir = await scratch()
  await add(io(), { root: dir, branch: null, text: '$(rm -rf /) `x` "q" \'s\' Ünïcode', byClaude: false })
  assert.match(await read(dir), /- \[ \] \$\(rm -rf \/\) `x` "q" 's' Ünïcode \(2026-01-01\)\n$/)
})

test('add: a held lock makes it wait, then refuse with the Python wording', async () => {
  const dir = await scratch(); await mkdir(join(dir, '.backlog/.lock'), { recursive: true })
  const started = Date.now()
  await assert.rejects(add(io(), { root: dir, branch: null, text: 'x', byClaude: false }),
    (e) => e instanceof Refused && e.message === 'the backlog is locked by another session')
  assert.ok(Date.now() - started >= 900, 'waited about 20 x 50 ms')
  await rmdir(join(dir, '.backlog/.lock'))
})

test('add: a stale lock older than 10 s is removed', async () => {
  const dir = await scratch(); await mkdir(join(dir, '.backlog/.lock'), { recursive: true })
  const old = (Date.now() - 60000) / 1000
  await utimes(join(dir, '.backlog/.lock'), old, old)
  await add(io(), { root: dir, branch: null, text: 'x', byClaude: false })
  assert.match(await read(dir), /- \[ \] x \(2026-01-01\)\n$/)
})

test('add: two parallel adds produce two intact lines', async () => {
  const dir = await scratch()
  await Promise.all([
    add(io(), { root: dir, branch: null, text: 'one', byClaude: false }),
    add(io(), { root: dir, branch: null, text: 'two', byClaude: false }),
  ])
  const lines = (await read(dir)).split('\n').filter((l) => l.startsWith('- [ ] ')).sort()
  assert.deepEqual(lines, ['- [ ] one (2026-01-01)', '- [ ] two (2026-01-01)'])
})

import { markDone, addNote } from '../../hooks/store.js'

const SAMPLE = '# Backlog\n\n- [ ] alpha (2026-01-01, branch: main)\n  - 2026-01-02: earlier note\n- [ ] beta (2026-01-02)\n'

async function sampleDir() {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, '.backlog/backlog.md'), SAMPLE)
  return dir
}

test('markDone flips the box of that line only', async () => {
  const dir = await sampleDir()
  assert.equal(await markDone(io(), dir, 'beta (2026-01-02)'), true)
  assert.equal(await read(dir), SAMPLE.replace('- [ ] beta', '- [x] beta'))
})

test('addNote inserts after existing sub-bullets with today\'s date', async () => {
  const dir = await sampleDir()
  assert.equal(await addNote(io(), dir, 'alpha (2026-01-01, branch: main)', 'blocked by\nAPI change'), true)
  assert.equal(await read(dir), SAMPLE.replace('earlier note\n', 'earlier note\n  - 2026-01-01: blocked by API change\n'))
})

test('markDone on a vanished line writes nothing and returns false', async () => {
  const dir = await sampleDir()
  assert.equal(await markDone(io(), dir, 'gamma (2026-01-03)'), false)
  assert.equal(await read(dir), SAMPLE)
})

test('edits refuse a symlinked file', async () => {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, 'outside.md'), SAMPLE)
  await symlink(join(dir, 'outside.md'), join(dir, '.backlog/backlog.md'))
  await assert.rejects(markDone(io(), dir, 'beta (2026-01-02)'), Refused)
})

import { splitTags, itemTags, listFilter, tagOrder, parseTagInput, PALETTE, MAX_TAGS } from '../../hooks/store.js'

test('splitTags takes trailing #tags only, lowercased, deduplicated, at most eight', () => {
  assert.deepEqual(splitTags('fix login #Auth #urgent #auth'), { text: 'fix login', tags: ['auth', 'urgent'] })
  assert.deepEqual(splitTags('issue #12 in parser'), { text: 'issue #12 in parser', tags: [] })
  assert.deepEqual(splitTags('fix #auth! #x'), { text: 'fix #auth!', tags: ['x'] })
  assert.deepEqual(splitTags('fix #'), { text: 'fix #', tags: [] })
  assert.deepEqual(splitTags('#only #tags'), { text: '', tags: ['only', 'tags'] })
  const nine = splitTags('x ' + Array.from({ length: 9 }, (_, i) => `#t${i}`).join(' '))
  assert.equal(nine.tags.length, MAX_TAGS)
  assert.equal(nine.tags[0], 't0')
  assert.deepEqual(splitTags(`x #${'a'.repeat(24)} #${'b'.repeat(25)}`), { text: `x #${'a'.repeat(24)} #${'b'.repeat(25)}`, tags: [] })
})

test('itemTags reads the tags field of a stored item', () => {
  assert.deepEqual(itemTags('fix login (2026-10-01, branch: main, tags: auth, urgent)'), ['auth', 'urgent'])
  assert.deepEqual(itemTags('fix login (2026-10-01, by: claude, tags: auth)'), ['auth'])
  assert.deepEqual(itemTags('fix login (2026-10-01, branch: main)'), [])
  assert.deepEqual(itemTags('no meta'), [])
})

test('META still strips a parenthesis with tags; stripMeta and the duplicate rule ignore tags', () => {
  assert.equal(stripMeta('fix login (2026-10-01, branch: main, tags: auth, urgent)'), 'fix login')
  assert.equal(stripMeta('fix login (2026-10-01, tags: auth)'), 'fix login')
})

test('listFilter and modeOf: one tag after list, any case; anything else is an add', () => {
  assert.equal(listFilter('list #Auth'), 'auth')
  assert.equal(listFilter('LIST #auth'), 'auth')
  assert.equal(listFilter('list #a b'), null)
  assert.equal(listFilter('list #'), null)
  assert.equal(listFilter('list'), null)
  assert.equal(modeOf('list #auth'), 'list-tag')
  assert.equal(modeOf('list #a b'), 'add')
  assert.equal(modeOf('list'), 'list')
})

test('tagOrder follows first appearance over open and closed lines', () => {
  const content = '# Backlog\n\n- [x] old (2026-01-01, tags: build)\n- [ ] a (2026-01-02, tags: auth, build)\n- [ ] b (2026-01-03)\n- [ ] c (2026-01-04, tags: docs)\n'
  assert.deepEqual(tagOrder(content), ['build', 'auth', 'docs'])
  assert.deepEqual(tagOrder(''), [])
})

test('parseTagInput splits on spaces and commas, drops # and invalid tokens, keeps eight', () => {
  assert.deepEqual(parseTagInput('#Auth, urgent  build'), { tags: ['auth', 'urgent', 'build'], ignored: [] })
  assert.deepEqual(parseTagInput('auth bad! auth'), { tags: ['auth'], ignored: ['bad!'] })
  assert.deepEqual(parseTagInput('   '), { tags: [], ignored: [] })
  assert.equal(parseTagInput(Array.from({ length: 9 }, (_, i) => `t${i}`).join(' ')).tags.length, MAX_TAGS)
})

test('PALETTE has eight distinct colour names', () => {
  assert.equal(new Set(PALETTE).size, 8)
})

import { setTags } from '../../hooks/store.js'

const TAGGED = '# Backlog\n\n- [ ] alpha (2026-01-01, branch: main, by: claude, tags: auth)\n  - 2026-01-02: note\n- [ ] beta (2026-01-02)\n- [ ] odd (2026-01-03, tags: )\n'

async function taggedDir() {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, '.backlog/backlog.md'), TAGGED)
  return dir
}

test('setTags replaces the field and keeps date, branch and by: claude; sub-bullets stay', async () => {
  const dir = await taggedDir()
  const updated = await setTags(io(), dir, 'alpha (2026-01-01, branch: main, by: claude, tags: auth)', ['build', 'urgent'])
  assert.equal(updated, 'alpha (2026-01-01, branch: main, by: claude, tags: build, urgent)')
  assert.equal(await read(dir), TAGGED.replace('tags: auth)', 'tags: build, urgent)'))
})

test('setTags adds a field to an untagged item and clears it with an empty list', async () => {
  const dir = await taggedDir()
  assert.equal(await setTags(io(), dir, 'beta (2026-01-02)', ['docs']), 'beta (2026-01-02, tags: docs)')
  assert.equal(await setTags(io(), dir, 'beta (2026-01-02, tags: docs)', []), 'beta (2026-01-02)')
  assert.equal(await read(dir), TAGGED)
})

test('setTags returns null and writes nothing for a vanished line or a line without metadata', async () => {
  const dir = await taggedDir()
  assert.equal(await setTags(io(), dir, 'gamma (2026-01-09)', ['x']), null)
  assert.equal(await setTags(io(), dir, 'no metadata here', ['x']), null)
  assert.equal(await read(dir), TAGGED)
})

test('a malformed empty tags field still lists and is rewritten cleanly', async () => {
  const dir = await taggedDir()
  assert.ok((await list(io(), dir)).includes('odd (2026-01-03, tags: )'))
  assert.deepEqual(itemTags('odd (2026-01-03, tags: )'), [])
  assert.equal(await setTags(io(), dir, 'odd (2026-01-03, tags: )', ['fixed']), 'odd (2026-01-03, tags: fixed)')
})
