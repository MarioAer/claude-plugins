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
