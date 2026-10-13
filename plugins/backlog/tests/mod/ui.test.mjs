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
