import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { register } from '../../hooks/mod.js'
import { fakeDollar, recorder } from './fake-dollar.mjs'

async function repo(content) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'backlog-ui-')))
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
  if (content !== undefined) { await mkdir(join(dir, '.backlog')); await writeFile(join(dir, '.backlog/backlog.md'), content) }
  return dir
}
const read = (dir) => readFile(join(dir, '.backlog/backlog.md'), 'utf8')
function session(dir, options = {}) {
  const $ = fakeDollar({ cwd: dir, ...options }); const { on, fire } = recorder(); register(on); return { $, fire }
}
const command = (args) => ({ command: 'backlog:backlog', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const band = { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: {} }
// Depth-first search of a rendered tree for the first element matching pred.
export function find(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (pred(node)) return node
  const children = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
  for (const child of children) { const hit = find(child, pred); if (hit) return hit }
  return null
}
const TWO = '# Backlog\n\n- [ ] alpha (2026-01-01)\n- [ ] beta (2026-01-02)\n'

test('band is hidden before any backlog call', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  assert.equal((await fire($, 'ui.render', band)).passed, true)
})

test('band shows the open count after an add, with a 10 s timer', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('gamma'))
  const { passed, out } = await fire($, 'ui.render', band)
  assert.equal(passed, false)
  assert.ok(find(out, (n) => n.type === 'Text' && n.children === 'Backlog: 3 open'))
  assert.ok($.log.timers.some((t) => t.ms > 10000 && t.ms < 11000))
  assert.ok($.log.invalidations >= 1)
})

test('band hides once bandUntil has passed and when there are no items', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('list'))
  const { value, version } = await $.state.get({ plugin: 'backlog', key: 'view' })
  await $.state.set({ plugin: 'backlog', key: 'view' }, { ...value, bandUntil: Date.now() - 1 }, { ifVersion: version })
  assert.equal((await fire($, 'ui.render', band)).passed, true)
  const empty = await repo(); const s2 = session(empty)
  await s2.fire(s2.$, 'command.run', command('list'))
  assert.equal((await s2.fire(s2.$, 'ui.render', band)).passed, true)
})

const paneSite = { component: 'Pane', surface: 'terminal', requestId: 'backlog-review', props: {} }
const press = (tree, key) => find(tree, (n) => n.type === 'Button' && n.key === key).onPress({ surface: 'terminal' })
async function pane($, fire) { return (await fire($, 'ui.render', paneSite)).out }

test('review opens the pane with rows and hotkey buttons; the band gains a review button', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', command('review'))).out.text, 'Backlog review opened.')
  assert.deepEqual($.log.opened.map((p) => p.id), ['backlog-review'])
  assert.equal($.log.opened[0].closeOnEscape, true)
  const tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. alpha (2026-01-01)' && n.bold === true))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. beta (2026-01-02)'))
  for (const [key, hotkey] of [['done', 'd'], ['skip', 's'], ['note', 'n'], ['close', 'q']]) {
    assert.ok(find(tree, (n) => n.type === 'Button' && n.key === key && n.hotkey === hotkey), key)
  }
  const bandTree = (await fire($, 'ui.render', band)).out
  assert.ok(find(bandTree, (n) => n.type === 'Button' && n.key === 'review' && n.hotkey === 'r'))
})

test('review with no items answers the empty line; headless review passes to core', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', command('review'))).out.text, 'Backlog is empty.')
  assert.deepEqual($.log.opened, [])
  const d2 = await repo(TWO); const s2 = session(d2, { surfaces: [] })
  assert.equal((await s2.fire(s2.$, 'command.run', command('review'))).passed, true)
})

test('done writes at once and keeps the cursor on the next item', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'done')
  assert.equal(await read(dir), TWO.replace('- [ ] alpha', '- [x] alpha'))
  assert.deepEqual($.log.toasts, ['Done: alpha'])
  const tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. beta (2026-01-02)' && n.bold === true))
  assert.deepEqual($.log.closed, [])
})

test('skip then done on the last item closes the pane with a summary toast', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'skip')
  await press(await pane($, fire), 'done')
  assert.equal(await read(dir), TWO.replace('- [ ] beta', '- [x] beta'))
  assert.deepEqual($.log.closed, ['backlog-review'])
  assert.equal($.log.toasts.at(-1), 'Review done: 1 done, 1 skipped, 0 notes')
  await fire($, 'ui.close', { id: 'backlog-review', origin: { kind: 'plugin' } })
  assert.equal((await fire($, 'ui.render', paneSite)).passed, true)
})

test('note shows an input; submitting writes the note and advances; empty cancels', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'note')
  let tree = await pane($, fire)
  const input = find(tree, (n) => n.type === 'Input' && n.key === 'note')
  assert.ok(input)
  await input.onSubmit('   ')
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Button' && n.key === 'done'), 'empty note cancels back to the buttons')
  await press(tree, 'note')
  await find(await pane($, fire), (n) => n.type === 'Input').onSubmit('blocked by\nAPI change')
  assert.match(await read(dir), /- \[ \] alpha \(2026-01-01\)\n  - \d{4}-\d{2}-\d{2}: blocked by API change\n- \[ \] beta/)
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. beta (2026-01-02)' && n.bold === true))
})

test('done on a line that vanished reports it, writes nothing, keeps the pane open', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await writeFile(join(dir, '.backlog/backlog.md'), '# Backlog\n\n- [ ] beta (2026-01-02)\n')
  await press(await pane($, fire), 'done')
  assert.equal(await read(dir), '# Backlog\n\n- [ ] beta (2026-01-02)\n')
  assert.deepEqual($.log.toasts, ['Backlog item changed on disk: alpha'])
  assert.deepEqual($.log.closed, [])
  assert.ok(find(await pane($, fire), (n) => n.type === 'Text' && n.children === '1. beta (2026-01-02)' && n.bold === true))
})

test('an add while the pane is open refreshes its rows and keeps the cursor', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'skip')
  await fire($, 'command.run', command('gamma'))
  const tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && /^3\. gamma/.test(n.children)))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. beta (2026-01-02)' && n.bold === true))
})

test('a list while the pane is open clamps the cursor when the file shrank, and closes it when empty', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'skip')
  await writeFile(join(dir, '.backlog/backlog.md'), '# Backlog\n\n- [ ] alpha (2026-01-01)\n')
  await fire($, 'command.run', command('list'))
  const tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. alpha (2026-01-01)' && n.bold === true))
  await press(tree, 'done')
  assert.deepEqual($.log.toasts, ['Done: alpha', 'Review done: 1 done, 1 skipped, 0 notes'], 'the clamped item was the last one')
  const d2 = await repo(TWO); const s2 = session(d2)
  await s2.fire(s2.$, 'command.run', command('review'))
  await writeFile(join(d2, '.backlog/backlog.md'), '# Backlog\n')
  await s2.fire(s2.$, 'command.run', command('list'))
  assert.deepEqual(s2.$.log.closed, ['backlog-review'])
  assert.equal((await s2.fire(s2.$, 'ui.render', paneSite)).passed, true)
})

test('the pane names its keys: plain buttons and a help line in both states', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire)
  for (const key of ['done', 'skip', 'note', 'close']) {
    assert.equal(find(tree, (n) => n.type === 'Button' && n.key === key).plain, true, key)
  }
  assert.ok(find(tree, (n) => n.type === 'Text' && n.dimColor === true && /d done, s skip, n note, q close\. Tab moves, Enter presses, Esc returns to the prompt\./.test(n.children)))
  await press(tree, 'note')
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.dimColor === true && /Enter saves the note, empty Enter cancels, Esc returns to the prompt\./.test(n.children)))
})

import { arrange, colorOf } from '../../hooks/mod.js'
import { PALETTE } from '../../hooks/store.js'

const TAGGED3 = '# Backlog\n\n- [x] old (2026-01-01, tags: build)\n- [ ] a (2026-01-02, tags: auth, build)\n- [ ] b (2026-01-03)\n- [ ] c (2026-01-04, tags: build)\n'

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

test('the pane draws coloured group headings, rows in display order and tag chips', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  const tree = await pane($, fire)
  const headings = []
  find(tree, (n) => { if (n.type === 'Text' && n.bold === true && /^(#|untagged)/.test(String(n.children))) headings.push([n.children, n.color]); return false })
  assert.deepEqual(headings, [['#build', PALETTE[0]], ['#auth', PALETTE[1]], ['untagged', undefined]])
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. c (2026-01-04)' && n.bold === true), 'first row is the build item, tags field stripped')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.color === PALETTE[0] && n.bold !== true), 'tag chip beside the row')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. a (2026-01-02)'))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '3. b (2026-01-03)'))
})

test('the cursor walks rows in display order and colours stay stable after done', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'skip')
  let tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. a (2026-01-02)' && n.bold === true))
  await press(tree, 'done')
  assert.match(await read(dir), /- \[x\] a \(2026-01-02, tags: auth, build\)/)
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#auth' && n.bold !== true) === null, 'no auth chip left among open rows')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. c (2026-01-04)'))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.color === PALETTE[0]), 'build keeps its colour')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. b (2026-01-03)' && n.bold === true), 'cursor on the next row')
})
