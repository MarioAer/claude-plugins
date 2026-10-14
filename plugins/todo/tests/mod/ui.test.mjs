import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { register } from '../../hooks/mod.js'
import { fakeDollar, recorder } from './fake-dollar.mjs'

async function repo(content) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'todo-ui-')))
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
  if (content !== undefined) { await mkdir(join(dir, '.todo')); await writeFile(join(dir, '.todo/todo.md'), content) }
  return dir
}
const read = (dir) => readFile(join(dir, '.todo/todo.md'), 'utf8')
function session(dir, options = {}) {
  const $ = fakeDollar({ cwd: dir, ...options }); const { on, fire } = recorder(); register(on); return { $, fire }
}
const command = (args) => ({ command: 'todo:todo', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const band = { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: {} }
// Depth-first search of a rendered tree for the first element matching pred.
export function find(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (pred(node)) return node
  const children = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
  for (const child of children) { const hit = find(child, pred); if (hit) return hit }
  return null
}
const TWO = '# Todo\n\n- [ ] alpha (2026-01-01)\n- [ ] beta (2026-01-02)\n'

test('band is hidden before any todo call', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  assert.equal((await fire($, 'ui.render', band)).passed, true)
})

test('band shows the open count after an add, with a 10 s timer', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('gamma'))
  const { passed, out } = await fire($, 'ui.render', band)
  assert.equal(passed, false)
  assert.ok(find(out, (n) => n.type === 'Text' && n.children === 'Todo: 3 open'))
  assert.ok($.log.timers.some((t) => t.ms > 10000 && t.ms < 11000))
  assert.ok($.log.invalidations >= 1)
})

test('band hides once bandUntil has passed and when there are no items', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('list'))
  const { value, version } = await $.state.get({ plugin: 'todo', key: 'view' })
  await $.state.set({ plugin: 'todo', key: 'view' }, { ...value, bandUntil: Date.now() - 1 }, { ifVersion: version })
  assert.equal((await fire($, 'ui.render', band)).passed, true)
  const empty = await repo(); const s2 = session(empty)
  await s2.fire(s2.$, 'command.run', command('list'))
  assert.equal((await s2.fire(s2.$, 'ui.render', band)).passed, true)
})

const paneSite = { component: 'Pane', surface: 'terminal', requestId: 'todo-review', props: { isFocused: true, bodyColumns: 80 } }
const press = (tree, key) => find(tree, (n) => n.type === 'Button' && n.key === key).onPress({ surface: 'terminal' })
async function pane($, fire, props = {}) { return (await fire($, 'ui.render', { ...paneSite, props: { ...paneSite.props, ...props } })).out }
// The list row drawn for the cursor, as "<n>. <text>" without its marker.
function cursor(tree) {
  const row = find(tree, (n) => n.type === 'Text' && n.bold === true && /^[▶▷] /.test(String(n.children)))
  return row && row.children.slice(2)
}
const texts = (tree) => { const all = []; find(tree, (n) => { if (n.type === 'Text') all.push(String(n.children)); return false }); return all }

test('review opens the pane with a cursor row, a detail card and hotkey buttons; the band gains a review button', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', command('review'))).out.text, 'Todo review opened.')
  assert.deepEqual($.log.opened.map((p) => p.id), ['todo-review'])
  assert.equal($.log.opened[0].closeOnEscape, true)
  const tree = await pane($, fire)
  assert.equal(cursor(tree), '1. alpha')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '  2. beta'))
  assert.ok(texts(tree).includes('added 2026-01-01'), 'the card shows the date')
  assert.ok(texts(tree).includes('No notes yet. n adds one.'))
  for (const [key, hotkey] of [['down', 'j'], ['up', 'k'], ['top', 'g'], ['end', 'e'], ['done', 'd'], ['undo', 'u'], ['note', 'n'], ['tags', 't'], ['close', 'q']]) {
    const button = find(tree, (n) => n.type === 'Button' && n.key === key)
    assert.ok(button && button.hotkey === hotkey && button.plain === true, key)
  }
  const bandTree = (await fire($, 'ui.render', band)).out
  assert.ok(find(bandTree, (n) => n.type === 'Button' && n.key === 'review' && n.hotkey === 'r'))
})

test('review with no items answers the empty line; headless review passes to core', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', command('review'))).out.text, 'Todo list is empty.')
  assert.deepEqual($.log.opened, [])
  const d2 = await repo(TWO); const s2 = session(d2, { surfaces: [] })
  assert.equal((await s2.fire(s2.$, 'command.run', command('review'))).passed, true)
})

test('focus is visible: accent border, inverse cursor and a badge; unfocused dims and says how to focus', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire, { isFocused: true })
  assert.ok(find(tree, (n) => n.type === 'Box' && n.borderStyle === 'single' && n.borderColor === 'cyan'))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '▶ 1. alpha' && n.inverse === true))
  assert.ok(texts(tree).includes('● keys active'))
  assert.equal(find(tree, (n) => n.type === 'Button' && n.key === 'done').dimColor, undefined)
  tree = await pane($, fire, { isFocused: false })
  assert.ok(find(tree, (n) => n.type === 'Box' && n.borderStyle === 'single' && n.borderDimColor === true && n.borderColor === undefined))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '▷ 1. alpha' && n.inverse === false))
  assert.ok(texts(tree).includes('○ not focused'))
  assert.ok(texts(tree).includes('ctrl+x tab to focus · keys go to the prompt'))
  assert.equal(find(tree, (n) => n.type === 'Button' && n.key === 'done').dimColor, true)
})

const FIVE = '# Todo\n\n' + ['a', 'b', 'c', 'd', 'e'].map((x, i) => `- [ ] ${x} (2026-01-0${i + 1})\n`).join('')

test('j and k move one row and stop at the ends; g and e jump to the first and last', async () => {
  const dir = await repo(FIVE); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'up')
  assert.equal(cursor(await pane($, fire)), '1. a', 'k on the first row stays')
  await press(await pane($, fire), 'down')
  await press(await pane($, fire), 'down')
  assert.equal(cursor(await pane($, fire)), '3. c')
  await press(await pane($, fire), 'end')
  assert.equal(cursor(await pane($, fire)), '5. e')
  await press(await pane($, fire), 'down')
  assert.equal(cursor(await pane($, fire)), '5. e', 'j on the last row stays')
  assert.deepEqual($.log.closed, [], 'reaching the end never closes the pane')
  await press(await pane($, fire), 'top')
  assert.equal(cursor(await pane($, fire)), '1. a')
  assert.ok(texts(await pane($, fire)).some((t) => t.startsWith('Todo · 5 open · 0 done · 1/5')))
})

test('a long list draws a window around the cursor with counts above and below', async () => {
  const many = '# Todo\n\n' + Array.from({ length: 20 }, (_, i) => `- [ ] item${i + 1} (2026-01-01)\n`).join('')
  const dir = await repo(many); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire)
  assert.ok(texts(tree).includes('▼ 11 more'))
  assert.ok(!texts(tree).some((t) => t.startsWith('▲')))
  for (let i = 0; i < 10; i++) await press(await pane($, fire), 'down')
  tree = await pane($, fire)
  assert.equal(cursor(tree), '11. item11')
  assert.ok(texts(tree).includes('▲ 5 more'))
  assert.ok(texts(tree).includes('▼ 5 more'))
})

test('done writes at once, moves the cursor to the next item, and u reopens it', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  assert.equal(find(await pane($, fire), (n) => n.type === 'Button' && n.key === 'undo').dimColor, true, 'undo is dim with nothing to undo')
  await press(await pane($, fire), 'done')
  assert.equal(await read(dir), TWO.replace('- [ ] alpha', '- [x] alpha'))
  let tree = await pane($, fire)
  assert.equal(cursor(tree), '1. beta')
  assert.ok(texts(tree).some((t) => t.startsWith('Todo · 1 open · 1 done')))
  assert.equal(find(tree, (n) => n.type === 'Button' && n.key === 'undo').dimColor, undefined)
  await press(tree, 'undo')
  assert.equal(await read(dir), TWO)
  tree = await pane($, fire)
  assert.equal(cursor(tree), '1. alpha', 'the cursor returns to the reopened item')
  assert.ok(texts(tree).some((t) => t.startsWith('Todo · 2 open · 0 done')))
  await press(tree, 'undo')
  assert.deepEqual($.log.toasts, ['Done: alpha', 'Reopened: alpha', 'Nothing to undo'])
})

test('done on the last open item ends the review with a summary toast', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'done')
  await press(await pane($, fire), 'done')
  assert.deepEqual($.log.closed, ['todo-review'])
  assert.equal($.log.toasts.at(-1), 'Review: 2 done, 0 notes, 0 retagged')
  await fire($, 'ui.close', { id: 'todo-review', origin: { kind: 'plugin' } })
  assert.equal($.log.toasts.length, 3, 'no second summary once the pane is gone')
  assert.equal((await fire($, 'ui.render', paneSite)).passed, true)
})

test('closing the pane shows the summary', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'done')
  await fire($, 'ui.close', { id: 'todo-review', origin: { kind: 'person' } })
  assert.equal($.log.toasts.at(-1), 'Review: 1 done, 0 notes, 0 retagged')
})

test('notes show in the card; a new note stays on its item and appears at once; empty cancels', async () => {
  const withNotes = '# Todo\n\n- [ ] alpha (2026-01-01, branch: main)\n  - 2026-01-03: first\n  - 2026-01-05: second\n- [ ] beta (2026-01-02)\n'
  const dir = await repo(withNotes); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire)
  assert.ok(texts(tree).includes('added 2026-01-01 · branch main'))
  assert.ok(texts(tree).includes('Notes (2)'))
  assert.ok(texts(tree).includes('· 01-03  first'))
  assert.ok(texts(tree).includes('· 01-05  second'))
  await press(tree, 'note')
  const input = find(await pane($, fire), (n) => n.type === 'Input' && n.key === 'note')
  await input.onSubmit('   ')
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Button' && n.key === 'done'), 'empty note cancels back to the buttons')
  await press(tree, 'note')
  await find(await pane($, fire), (n) => n.type === 'Input').onSubmit('third\nline')
  assert.match(await read(dir), /  - 2026-01-05: second\n  - \d{4}-\d{2}-\d{2}: third line\n- \[ \] beta/)
  tree = await pane($, fire)
  assert.equal(cursor(tree), '1. alpha', 'the cursor stays on the noted item')
  assert.ok(texts(tree).includes('Notes (3)'))
  assert.ok(texts(tree).some((t) => /^· \d{2}-\d{2}  third line$/.test(t)))
  assert.deepEqual($.log.toasts, ['Noted: alpha'])
})

test('a narrow pane puts the card first and shows only the latest note', async () => {
  const withNotes = '# Todo\n\n- [ ] alpha (2026-01-01)\n  - 2026-01-03: first\n  - 2026-01-05: second\n'
  const dir = await repo(withNotes); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  const tree = await pane($, fire, { bodyColumns: 40 })
  assert.equal(tree.children[0].borderStyle, 'round', 'card first')
  assert.ok(texts(tree).includes('· 01-05  second'))
  assert.ok(!texts(tree).includes('· 01-03  first'))
  assert.ok(texts(tree).includes('+1 earlier'))
  assert.equal((await pane($, fire)).children[0].borderStyle, 'single', 'list first when wide')
})

test('done on a line that vanished reports it, writes nothing, keeps the pane open', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await writeFile(join(dir, '.todo/todo.md'), '# Todo\n\n- [ ] beta (2026-01-02)\n')
  await press(await pane($, fire), 'done')
  assert.equal(await read(dir), '# Todo\n\n- [ ] beta (2026-01-02)\n')
  assert.deepEqual($.log.toasts, ['Todo item changed on disk: alpha'])
  assert.deepEqual($.log.closed, [])
  assert.equal(cursor(await pane($, fire)), '1. beta')
})

test('an add while the pane is open refreshes its rows and keeps the cursor', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'down')
  await fire($, 'command.run', command('gamma'))
  const tree = await pane($, fire)
  assert.ok(texts(tree).includes('  3. gamma'))
  assert.equal(cursor(tree), '2. beta')
})

test('a list while the pane is open clamps the cursor when the file shrank, and closes it when empty', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'down')
  await writeFile(join(dir, '.todo/todo.md'), '# Todo\n\n- [ ] alpha (2026-01-01)\n')
  await fire($, 'command.run', command('list'))
  const tree = await pane($, fire)
  assert.equal(cursor(tree), '1. alpha')
  await press(tree, 'done')
  assert.deepEqual($.log.toasts, ['Done: alpha', 'Review: 1 done, 0 notes, 0 retagged'], 'the clamped item was the last one')
  const d2 = await repo(TWO); const s2 = session(d2)
  await s2.fire(s2.$, 'command.run', command('review'))
  await writeFile(join(d2, '.todo/todo.md'), '# Todo\n')
  await s2.fire(s2.$, 'command.run', command('list'))
  assert.deepEqual(s2.$.log.closed, ['todo-review'])
  assert.equal((await s2.fire(s2.$, 'ui.render', paneSite)).passed, true)
})

test('the pane names its keys: a help line in each state', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.dimColor === true && n.children === 'Tab moves between keys, Enter presses, Esc returns to the prompt.'))
  await press(tree, 'note')
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.dimColor === true && /Enter saves the note, empty Enter cancels, Esc returns to the prompt\./.test(n.children)))
})

import { arrange, colorOf, itemMeta, listEntries, windowOf } from '../../hooks/mod.js'
import { PALETTE } from '../../hooks/store.js'

const TAGGED3 = '# Todo\n\n- [x] old (2026-01-01, tags: build)\n- [ ] a (2026-01-02, tags: auth, build)\n- [ ] b (2026-01-03)\n- [ ] c (2026-01-04, tags: build)\n'

test('arrange groups by first tag in tag order, untagged last, empty groups dropped', () => {
  const items = ['a (2026-01-02, tags: auth, build)', 'b (2026-01-03)', 'c (2026-01-04, tags: build)']
  assert.deepEqual(arrange(items, ['build', 'auth']), [
    { tag: 'build', items: ['c (2026-01-04, tags: build)'] },
    { tag: 'auth', items: ['a (2026-01-02, tags: auth, build)'] },
    { tag: null, items: ['b (2026-01-03)'] },
  ])
  assert.deepEqual(arrange([], ['build']), [])
  assert.equal(colorOf('auth', ['build', 'auth']), PALETTE[1])
  assert.equal(colorOf('ninth', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'ninth']), PALETTE[0])
})

test('itemMeta, listEntries and windowOf', () => {
  assert.deepEqual(itemMeta('x (2026-01-02, branch: feat/a, by: claude, tags: t)'), { date: '2026-01-02', branch: 'feat/a' })
  assert.deepEqual(itemMeta('no meta'), { date: null, branch: null })
  const entries = listEntries(['a (2026-01-02, tags: t)', 'b (2026-01-03)'], ['t'])
  assert.deepEqual(entries.map((e) => e.heading === undefined ? e.index : `#${e.heading}`), ['#t', 0, '#null', 1])
  assert.deepEqual(windowOf(entries, 1, 2), { shown: entries.slice(2), above: 1, below: 0 })
})

test('the pane draws coloured group headings, rows in display order and tag chips', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  const tree = await pane($, fire)
  const headings = []
  find(tree, (n) => { if (n.type === 'Text' && n.bold === true && /^(#|untagged)/.test(String(n.children))) headings.push([n.children, n.color]); return false })
  assert.deepEqual(headings, [['#build', PALETTE[0]], ['#auth', PALETTE[1]], ['untagged', undefined]])
  assert.equal(cursor(tree), '1. c', 'first row is the build item')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.color === PALETTE[0] && n.bold !== true), 'tag chip beside the row')
  assert.ok(texts(tree).includes('  2. a'))
  assert.ok(texts(tree).includes('  3. b'))
})

test('the cursor walks rows in display order and colours stay stable after done', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'down')
  let tree = await pane($, fire)
  assert.equal(cursor(tree), '2. a')
  await press(tree, 'done')
  assert.match(await read(dir), /- \[x\] a \(2026-01-02, tags: auth, build\)/)
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#auth' && n.bold === true) === null, 'no auth group left')
  assert.ok(texts(tree).includes('  1. c'))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.color === PALETTE[0]), 'build keeps its colour')
  assert.equal(cursor(tree), '2. b', 'cursor on the next row')
})

test('t shows an input with the current tags and the known tags; submitting moves the item and keeps the cursor on it', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire)
  await press(tree, 'tags')
  tree = await pane($, fire)
  const input = find(tree, (n) => n.type === 'Input' && n.key === 'tags')
  assert.equal(input.value, 'build')
  assert.ok(texts(tree).includes('known: #build #auth'))
  assert.ok(find(tree, (n) => n.type === 'Text' && /Enter replaces the tags, empty Enter clears them, Esc returns to the prompt\./.test(String(n.children))))
  await input.onSubmit('auth bad! #Auth')
  assert.deepEqual($.log.toasts, ['Ignored tag: bad!', 'Tagged: c'])
  assert.match(await read(dir), /- \[ \] c \(2026-01-04, tags: auth\)\n/)
  tree = await pane($, fire)
  assert.equal(cursor(tree), '2. c', 'cursor follows the item into the auth group')
  assert.equal(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.bold === true), null, 'build group is gone')
  assert.ok(find(tree, (n) => n.type === 'Button' && n.key === 'done'), 'buttons are back')
  await fire($, 'ui.close', { id: 'todo-review', origin: { kind: 'person' } })
  assert.equal($.log.toasts.at(-1), 'Review: 0 done, 0 notes, 1 retagged')
})

test('an empty tag submission clears the tags and moves the item to untagged', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'tags')
  await find(await pane($, fire), (n) => n.type === 'Input').onSubmit('')
  assert.match(await read(dir), /- \[ \] c \(2026-01-04\)\n/)
  assert.equal(cursor(await pane($, fire)), '3. c')
})

test('t on a line that vanished reports it and keeps the pane open', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'tags')
  await writeFile(join(dir, '.todo/todo.md'), '# Todo\n\n- [ ] b (2026-01-03)\n')
  await find(await pane($, fire), (n) => n.type === 'Input').onSubmit('x')
  assert.deepEqual($.log.toasts, ['Todo item changed on disk: c'])
  assert.deepEqual($.log.closed, [])
  assert.equal(cursor(await pane($, fire)), '1. b')
})

test('the tags and note inputs keep what was typed across a redraw', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'tags')
  let input = find(await pane($, fire), (n) => n.type === 'Input' && n.key === 'tags')
  assert.equal(input.value, 'build')
  await input.onInput('build au', { surface: 'terminal' })
  input = find(await pane($, fire), (n) => n.type === 'Input' && n.key === 'tags')
  assert.equal(input.value, 'build au', 'a redraw re-applies the draft, not the stored tags')
  await input.onSubmit('build au')
  assert.deepEqual($.log.toasts.at(-1), 'Tagged: c')
  assert.match(await read(dir), /- \[ \] c \(2026-01-04, tags: build, au\)\n/)
  await press(await pane($, fire), 'note')
  let note = find(await pane($, fire), (n) => n.type === 'Input' && n.key === 'note')
  assert.equal(note.value, '')
  await note.onInput('half a', { surface: 'terminal' })
  note = find(await pane($, fire), (n) => n.type === 'Input' && n.key === 'note')
  assert.equal(note.value, 'half a', 'the note draft survives a redraw too')
})
