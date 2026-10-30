import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { register } from '../../hooks/mod.js'
import { fakeDollar, recorder, find } from './fake-dollar.mjs'

async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'geparkt-')))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}
function session(dir, options = {}) {
  const $ = fakeDollar({ cwd: dir, ...options }); const { on, fire } = recorder(); register(on); return { $, fire }
}
const skill = (args) => ({ tool: 'Skill', skill: 'geparkt:geparkt', args })
const command = (args = '') => ({ command: 'geparkt:geparkt', args, origin: { kind: 'composer' } })
const band = { component: 'AbovePrompt', surface: 'terminal', props: {} }
const paneSite = { component: 'Pane', surface: 'terminal', requestId: 'geparkt-review', props: { isFocused: true } }
const press = (tree, key) => find(tree, (n) => n.type === 'Button' && n.key === key).onPress({ surface: 'terminal' })
const fileOf = async (dir, id = 's1') => JSON.parse(await readFile(join(dir, '.geparkt', `${id}.json`), 'utf8'))

test('Claude\'s Skill call is recorded by the mod, with the open ids in its context', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  const { passed, out } = await fire($, 'tool.call', skill('+q Use Postgres? | +t retry policy'))
  assert.equal(passed, false)
  assert.match(out.context[0], /^GEPARKT_OK: \+1 \+2 \| open: #1 q Use Postgres\?; #2 t retry policy\n/)
  assert.match(out.context[0], /Do not mention it to the user/)
  assert.equal((await fileOf(dir)).threads.length, 2)
  assert.equal(await readFile(join(dir, '.geparkt/.gitignore'), 'utf8'), '*\n')
})

test('a bad batch writes nothing and says why', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A?'))
  const { out } = await fire($, 'tool.call', skill('+q B? | r9'))
  assert.match(out.context[0], /^GEPARKT_FAILED: #9 is not a thread/)
  assert.equal((await fileOf(dir)).threads.length, 1)
})

test('an ask or deny rule goes to the engine, and other skills pass through', async () => {
  const dir = await repo()
  for (const decision of ['deny', 'ask']) {
    const s = session(dir, { toolCheck: { decision } })
    assert.equal((await s.fire(s.$, 'tool.call', skill('+q A?'))).passed, true)
  }
  const { $, fire } = session(dir)
  assert.equal((await fire($, 'tool.call', { tool: 'Skill', skill: 'todo:todo', args: 'x' })).passed, true)
})

test('sessions keep separate files', async () => {
  const dir = await repo()
  const a = session(dir, { sessionId: 'a' }); const b = session(dir, { sessionId: 'b' })
  await a.fire(a.$, 'tool.call', skill('+q A?'))
  const { out } = await b.fire(b.$, 'tool.call', skill('+q B?'))
  assert.match(out.context[0], /open: #1 q B\?\n/)
})

test('a symlinked folder is refused', async () => {
  const dir = await repo(); const elsewhere = await repo()
  await symlink(elsewhere, join(dir, '.geparkt'))
  const { $, fire } = session(dir)
  const { out } = await fire($, 'tool.call', skill('+q A?'))
  assert.match(out.context[0], /^GEPARKT_FAILED: .* is a symlink/)
})

test('a cwd inside .claude resolves to the repository root', async () => {
  const dir = await repo(); await mkdir(join(dir, '.claude'))
  const { $, fire } = session(join(dir, '.claude'))
  // git reports the repository root, so a cwd inside .claude still resolves to the root.
  const { out } = await fire($, 'tool.call', skill('+q A?'))
  assert.match(out.context[0], /^GEPARKT_OK/)
})

test('the band shows the open count and hides at zero', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  assert.equal((await fire($, 'ui.render', band)).passed, true)
  await fire($, 'tool.call', skill('+q A? | +t B'))
  const { out } = await fire($, 'ui.render', band)
  assert.ok(find(out, (n) => n.type === 'Text' && n.children === 'Geparkt: 2 open · 1 questions'))
  await fire($, 'tool.call', skill('r1 | x2'))
  assert.equal((await fire($, 'ui.render', band)).passed, true)
})

test('session start loads the file, so the band survives a resume', async () => {
  const dir = await repo()
  const first = session(dir); await first.fire(first.$, 'tool.call', skill('+q A?'))
  const { $, fire } = session(dir)
  await fire($, 'session.start', { cwd: dir })
  assert.equal((await fire($, 'ui.render', band)).passed, false)
})

test('/geparkt lists without a surface and opens the pane with one', async () => {
  const dir = await repo()
  const headless = session(dir, { surfaces: [] })
  await headless.fire(headless.$, 'tool.call', skill('+q A?'))
  const listed = await headless.fire(headless.$, 'command.run', command())
  assert.match(listed.out.text, /^#1 question · 0m · A\?$/)
  const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', command())).out.text, 'Geparkt review opened.')
  assert.equal($.log.opened[0].id, 'geparkt-review')
  assert.match((await fire($, 'command.run', command('list'))).out.text, /^#1 question/)
})

test('pane: resolve, note, back and close', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A? | +t B | +q C?'))
  await fire($, 'command.run', command())
  let tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'down')
  tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'resolve')
  const data = await fileOf(dir)
  assert.deepEqual(data.threads.map((t) => [t.id, t.status, t.by]), [[1, 'open', null], [2, 'resolved', 'user'], [3, 'open', null]])
  tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'note')
  tree = (await fire($, 'ui.render', paneSite)).out
  await find(tree, (n) => n.type === 'Input').onSubmit('ask the DBA')
  assert.deepEqual((await fileOf(dir)).threads[2].notes.map((n) => n.text), ['ask the DBA'])
  tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'back')
  assert.deepEqual($.log.fills[0], { text: 'Back to #3: C? ', mode: 'replace' })
  assert.deepEqual($.log.closed, ['geparkt-review'])
})

test('pane: defer asks once, then hands the thread to todo', async () => {
  const dir = await repo(); const { $, fire } = session(dir, { commands: ['todo:todo'] })
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  let tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'defer')
  assert.equal($.log.commands.length, 0)
  tree = (await fire($, 'ui.render', paneSite)).out
  assert.ok(find(tree, (n) => n.type === 'Button' && n.label === 'defer: press f again'))
  await press(tree, 'defer')
  assert.deepEqual($.log.commands[0], { command: 'todo:todo', args: 'A? #question' })
  assert.equal((await fileOf(dir)).threads[0].status, 'deferred')
})

test('pane: defer without the todo plugin changes nothing', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  await press((await fire($, 'ui.render', paneSite)).out, 'defer')
  assert.deepEqual($.log.toasts, ['Defer needs the todo plugin'])
  assert.equal((await fileOf(dir)).threads[0].status, 'open')
})

test('a note goes to the thread n was pressed on, even after the list moved', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A? | +q B? | +q C?'))
  await fire($, 'command.run', command())
  let tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'down')
  tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'note')
  // Claude resolves #1 meanwhile: the list shifts and the cursor's index now names #3.
  await fire($, 'tool.call', skill('r1'))
  tree = (await fire($, 'ui.render', paneSite)).out
  await find(tree, (n) => n.type === 'Input').onSubmit('only for B')
  const threads = (await fileOf(dir)).threads
  assert.deepEqual(threads.map((t) => t.notes.length), [0, 1, 0])
})

test('a pane key during Claude\'s call does not overwrite either change', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A? | +q B?'))
  await fire($, 'command.run', command())
  const tree = (await fire($, 'ui.render', paneSite)).out
  // The first read is slow, so without serialising both writers load the same version.
  const read = $.fs.read
  let slow = true
  $.fs.read = async (path) => {
    const text = await read(path)
    if (slow && path.endsWith('s1.json')) { slow = false; await new Promise((r) => setTimeout(r, 50)) }
    return text
  }
  await Promise.all([fire($, 'tool.call', skill('+t C')), press(tree, 'resolve')])
  const threads = (await fileOf(dir)).threads
  assert.deepEqual(threads.map((t) => [t.id, t.status]), [[1, 'resolved'], [2, 'open'], [3, 'open']])
})

test('a band that fails to redraw still reports the saved batch', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  $.ui.close = async () => { throw new Error('gone') }
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  const { out } = await fire($, 'tool.call', skill('r1'))
  assert.match(out.context[0], /^GEPARKT_OK: r1/)
})

test('the view write is retried when another write got in first', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  const set = $.state.set
  let missed = false
  $.state.set = async (ref, value, options) => {
    if (!missed) { missed = true; await set(ref, { ...value, threads: [] }) }
    return set(ref, value, options)
  }
  await fire($, 'tool.call', skill('+q A?'))
  assert.equal((await fire($, 'ui.render', band)).passed, false)
})
