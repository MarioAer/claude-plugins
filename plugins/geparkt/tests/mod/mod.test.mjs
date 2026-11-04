import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, realpath, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { register } from '../../hooks/mod.js'
import * as store from '../../hooks/store.js'
import { fakeDollar, recorder, find } from './fake-dollar.mjs'

async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'geparkt-')))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}
function session(dir, options = {}) {
  const $ = fakeDollar({ cwd: dir, ...options }); const { on, fire } = recorder(); register(on); return { $, fire }
}
const skill = (args) => ({ tool: 'Skill', skill: 'geparkt:track', args })
const command = (args = '') => ({ command: 'geparkt:track', args, origin: { kind: 'composer' } })
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

test('pane: resolve, reply, back and close', async () => {
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
  assert.equal(find(tree, (n) => n.type === 'Button' && n.key === 'note'), null)
  await press(tree, 'reply')
  tree = (await fire($, 'ui.render', paneSite)).out
  await find(tree, (n) => n.type === 'Input').onSubmit('ask the DBA')
  assert.equal((await fileOf(dir)).threads[2].reply.text, 'ask the DBA')
  tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'back')
  assert.deepEqual($.log.fills[0], { text: 'Back to #3: C? ', mode: 'replace' })
  assert.deepEqual($.log.closed, ['geparkt-review'])
})

async function paneOn(skillArgs, options) {
  const dir = await repo(); const { $, fire } = session(dir, options)
  await fire($, 'tool.call', skill(skillArgs))
  await fire($, 'command.run', command())
  const render = async () => (await fire($, 'ui.render', paneSite)).out
  const view = async () => (await $.state.get({ plugin: 'geparkt', key: 'view' })).value
  const input = async () => find(await render(), (n) => n.type === 'Input')
  return { dir, $, fire, render, view, input }
}

test('pane: reply saves on the selected thread and moves it to waiting', async () => {
  const { dir, $, render, input } = await paneOn('+q A? | +q B?')
  await press(await render(), 'reply')
  await (await input()).onSubmit('yes')
  const reply = (await fileOf(dir)).threads[0].reply
  assert.equal(reply.text, 'yes')
  assert.equal(reply.sentAt, null)
  assert.ok($.log.toasts.includes('Reply saved: yes'))
  assert.equal(await input(), null)
})

test('pane: the save button saves the draft of the selected thread', async () => {
  const { dir, render, input } = await paneOn('+q A?')
  await press(await render(), 'reply')
  await (await input()).onInput('draft text')
  await press(await render(), 'save')
  assert.equal((await fileOf(dir)).threads[0].reply.text, 'draft text')
})

test('pane: empty reply cancels', async () => {
  const { dir, render, view, input } = await paneOn('+q A?')
  await press(await render(), 'reply')
  assert.notEqual((await view()).pane.replyFor, null)
  await (await input()).onSubmit('  ')
  assert.equal((await fileOf(dir)).threads[0].reply, undefined)
  const { pane } = await view()
  assert.equal(pane.replyFor, null)
  assert.deepEqual(pane.drafts, {})
})

test('pane: a reply on a sent thread starts a follow-up', async () => {
  const { dir, $, fire, render, input } = await paneOn('+q A?')
  const data = await fileOf(dir)
  data.threads[0].reply = { text: 'first', at: 5, sentAt: 6 }
  await writeFile(join(dir, '.geparkt/s1.json'), JSON.stringify(data))
  await fire($, 'tool.call', skill('+t B'))
  await press(await render(), 'reply')
  await (await input()).onSubmit('follow-up')
  const reply = (await fileOf(dir)).threads[0].reply
  assert.equal(reply.text, 'follow-up')
  assert.equal(reply.sentAt, null)
})

test('pane: resolving discards an unsent reply with a toast', async () => {
  const { dir, $, render, input } = await paneOn('+q A? | +q B?')
  await press(await render(), 'reply')
  await (await input()).onSubmit('yes')
  await press(await render(), 'resolve')
  assert.match($.log.toasts.at(-1), /unsent reply discarded: yes$/)
  const data = await fileOf(dir)
  assert.equal(data.threads[0].status, 'resolved')
  assert.equal(data.threads[0].reply, null)
})

test('pane: resolving keeps a sent reply and adds no discard note', async () => {
  const { dir, $, fire, render } = await paneOn('+q A? | +q B?')
  const data = await fileOf(dir)
  data.threads[0].reply = { text: 'first', at: 5, sentAt: 6 }
  await writeFile(join(dir, '.geparkt/s1.json'), JSON.stringify(data))
  await fire($, 'tool.call', skill('+t C'))
  await press(await render(), 'resolve')
  assert.equal($.log.toasts.at(-1), 'Resolved: A?')
  assert.equal((await fileOf(dir)).threads[0].reply.text, 'first')
})

test('selection follows the next thread when the selected one closes', async () => {
  const { $, fire, render, view, input } = await paneOn('+q A? | +q B? | +q C?')
  await press(await render(), 'down')
  await press(await render(), 'reply')
  await (await input()).onInput('half typed')
  await fire($, 'tool.call', skill('r2'))
  const { pane } = await view()
  assert.equal(pane.selected, 3)
  assert.equal(pane.drafts['2'], 'half typed')
})

test('selection falls back to the last thread when none follows', async () => {
  const { $, fire, render, view } = await paneOn('+q A? | +q B? | +q C?')
  await press(await render(), 'down')
  await press(await render(), 'down')
  await fire($, 'tool.call', skill('r3'))
  assert.equal((await view()).pane.selected, 2)
})

test('a reply moves its thread to waiting and keeps the selection on it', async () => {
  const { render, view, input } = await paneOn('+q A? | +q B?')
  await press(await render(), 'reply')
  await (await input()).onSubmit('yes')
  assert.equal((await view()).pane.selected, 1)
  // #1 now waits, so it follows #2 in the navigation order.
  await press(await render(), 'down')
  assert.equal((await view()).pane.selected, 1)
  await press(await render(), 'up')
  assert.equal((await view()).pane.selected, 2)
})

test('drafts survive moving the selection', async () => {
  const { render, input } = await paneOn('+q A? | +q B?')
  await press(await render(), 'reply')
  await (await input()).onInput('keep me')
  await press(await render(), 'down')
  await press(await render(), 'up')
  assert.equal((await input()).value, 'keep me')
})

test('pane: defer asks once, then hands the thread to todo', async () => {
  const dir = await repo(); const { $, fire } = session(dir, { commands: ['todo', 'todo:capture'], todoReply: 'TODO_ADDED: A?' })
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  let tree = (await fire($, 'ui.render', paneSite)).out
  await press(tree, 'defer')
  assert.equal($.log.commands.length, 0)
  tree = (await fire($, 'ui.render', paneSite)).out
  assert.ok(find(tree, (n) => n.type === 'Button' && n.label === 'defer: press f again'))
  await press(tree, 'defer')
  assert.deepEqual($.log.commands[0], { command: 'todo', args: 'A? #question' })
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

test('a reply goes to the thread reply was pressed on, even after the list moved', async () => {
  const { dir, $, fire, render, input } = await paneOn('+q A? | +q B? | +q C?')
  await press(await render(), 'down')
  await press(await render(), 'reply')
  // Claude resolves #1 meanwhile: the list shifts, the selection stays on #2.
  await fire($, 'tool.call', skill('r1'))
  await (await input()).onSubmit('only for B')
  const threads = (await fileOf(dir)).threads
  assert.deepEqual(threads.map((t) => t.reply?.text ?? null), [null, 'only for B', null])
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

test('an approved ask call redraws the band from the file the fallback hook wrote', async () => {
  const dir = await repo(); const { $, fire } = session(dir, { toolCheck: { decision: 'ask' } })
  // Stands for geparkt_hook.py, which records the call once the person approves it.
  await mkdir(join(dir, '.geparkt'))
  await writeFile(join(dir, '.geparkt/s1.json'), JSON.stringify({ version: 1, next: 2, threads: [{ id: 1, kind: 'q', text: 'A?', status: 'open', notes: [], at: 0, touched: 0 }] }))
  assert.equal((await fire($, 'tool.call', skill('+q A?'))).passed, true)
  assert.equal((await fire($, 'ui.render', band)).passed, false)
})

test('a reply started while Claude\'s call redraws the view is kept', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  const tree = (await fire($, 'ui.render', paneSite)).out
  // The reply key lands between the redraw's read of the view and its write.
  const get = $.state.get
  let armed = false
  $.state.get = async (ref) => {
    const value = await get(ref)
    if (armed) { armed = false; await press(tree, 'reply') }
    return value
  }
  const read = $.fs.read
  $.fs.read = async (path) => { const text = await read(path); if (path.endsWith('s1.json')) armed = true; return text }
  await fire($, 'tool.call', skill('+t B'))
  $.fs.read = read
  assert.ok(find((await fire($, 'ui.render', paneSite)).out, (n) => n.type === 'Input'))
})

test('resolving the last thread still shows the summary when the pane closes', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  await press((await fire($, 'ui.render', paneSite)).out, 'resolve')
  assert.deepEqual($.log.closed, ['geparkt-review'])
  await fire($, 'ui.close', { id: 'geparkt-review' })
  assert.ok($.log.toasts.includes('Geparkt: 1 resolved'))
})

test('two quick resolves both count', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A? | +q B?'))
  await fire($, 'command.run', command())
  const tree = (await fire($, 'ui.render', paneSite)).out
  const read = $.fs.read
  let slow = true
  $.fs.read = async (path) => {
    const text = await read(path)
    if (slow && path.endsWith('s1.json')) { slow = false; await new Promise((r) => setTimeout(r, 50)) }
    return text
  }
  const first = press(tree, 'resolve')
  await press(tree, 'down')
  await Promise.all([first, press(tree, 'resolve')])
  await fire($, 'tool.call', skill('+q C?'))
  const header = find((await fire($, 'ui.render', paneSite)).out, (n) => n.type === 'Text' && /resolved$/.test(n.children))
  assert.equal(header.children, 'Geparkt · 1 open · 2 resolved')
})

test('git is asked for the root once per working directory', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  const run = $.process.run
  let calls = 0
  $.process.run = (argv, init) => { calls++; return run(argv, init) }
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'tool.call', skill('r1'))
  assert.equal(calls, 1)
})

test('session.start registers /geparkt as immediate', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  assert.equal((await fire($, 'session.start', {})).passed, true)
  assert.equal($.log.registered.length, 1)
  assert.deepEqual({ ...$.log.registered[0], description: 'x' }, { name: 'geparkt', description: 'x', argumentHint: '[list]', immediate: true })
})

test('a refused /geparkt registration toasts once and session.start still passes on', async () => {
  const dir = await repo(); const { $, fire } = session(dir, { registerThrows: true })
  assert.equal((await fire($, 'session.start', {})).passed, true)
  assert.equal((await fire($, 'session.start', {})).passed, true)
  assert.equal($.log.toasts.filter((t) => /use \/geparkt:track/.test(t)).length, 1)
})

test('typed /geparkt and /geparkt:track both answer', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  for (const name of ['geparkt', 'geparkt:track']) {
    const { passed, out } = await fire($, 'command.run', { command: name, args: 'list', origin: { kind: 'composer' } })
    assert.equal(passed, false, name)
    assert.equal(out.text, 'No open threads.')
  }
})

import { deferOutcome } from '../../hooks/mod.js'

test('deferOutcome reads todo\'s marker', () => {
  assert.equal(deferOutcome('TODO_ADDED: q #question'), 'ok')
  assert.equal(deferOutcome('TODO_DUPLICATE: q'), 'ok')
  assert.deepEqual(deferOutcome('TODO_FAILED: the reason'), { failed: 'the reason' })
  assert.deepEqual(deferOutcome('Added to todo list: q'), { failed: 'no answer from the todo plugin' })
  assert.deepEqual(deferOutcome(''), { failed: 'no answer from the todo plugin' })
})

async function deferTwice(options) {
  const dir = await repo(); const { $, fire } = session(dir, options)
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'command.run', command())
  await press((await fire($, 'ui.render', paneSite)).out, 'defer')
  await press((await fire($, 'ui.render', paneSite)).out, 'defer')
  return { $, dir }
}

test('pane: defer uses /todo:capture when /todo is not registered', async () => {
  const { $, dir } = await deferTwice({ commands: ['todo:capture'], todoReply: 'TODO_DUPLICATE: A?' })
  assert.equal($.log.commands[0].command, 'todo:capture')
  assert.equal((await fileOf(dir)).threads[0].status, 'deferred')
})

test('pane: an English reply instead of the marker leaves the thread open', async () => {
  const { $, dir } = await deferTwice({ commands: ['todo'], todoReply: 'Added to todo list: A?' })
  assert.equal((await fileOf(dir)).threads[0].status, 'open')
  assert.ok($.log.toasts.some((t) => /no answer from the todo plugin/.test(t)))
})

test('pane: a todo failure is named in a toast and leaves the thread open', async () => {
  const { $, dir } = await deferTwice({ commands: ['todo'], todoReply: 'TODO_FAILED: x is a symlink' })
  assert.equal((await fileOf(dir)).threads[0].status, 'open')
  assert.ok($.log.toasts.some((t) => /x is a symlink/.test(t)))
})

const turn = { text: 'go', turnId: 't1' }
const done = { reason: 'answer', turnId: 't1' }

test('turn.complete shows the open count when the turn added a thread', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'turn.start', turn)
  await fire($, 'tool.call', skill('+q A?'))
  assert.equal((await fire($, 'turn.complete', done)).out.text, 'Geparkt: 1 open (+1)')
})

test('turn.complete shows a negative change when a thread was resolved', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A? | +q B?'))
  await fire($, 'turn.start', turn)
  await fire($, 'tool.call', skill('r1 yes'))
  assert.equal((await fire($, 'turn.complete', done)).out.text, 'Geparkt: 1 open (-1)')
})

test('turn.complete passes through when the open count did not change', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q A?'))
  await fire($, 'turn.start', turn)
  assert.equal((await fire($, 'turn.complete', done)).passed, true)
})

test('a subagent turn.complete passes through for geparkt', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'turn.start', turn)
  await fire($, 'tool.call', skill('+q A?'))
  assert.equal((await fire($, 'turn.complete', { ...done, agentId: 'a1' })).passed, true)
  assert.equal((await fire($, 'turn.complete', { ...done, answer: 'A' })).out.text, 'Geparkt: 1 open (+1)')
})

test('the geparkt turn line keeps a line another hook set', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'turn.start', turn)
  await fire($, 'tool.call', skill('+q A?'))
  assert.equal((await fire($, 'turn.complete', { ...done, answer: 'A' }, { text: 'Todo: +1 this turn' })).out.text, 'Todo: +1 this turn\nGeparkt: 1 open (+1)')
})

// prompt.submit: replies ride on the next typed prompt.
const typed = (extra = {}) => ({ text: 'go on', wait: false, origin: { kind: 'composer' }, ...extra })
async function withReply(dir, patch = {}) {
  const { $, fire } = session(dir)
  await fire($, 'tool.call', skill('+q Use Postgres? | +t retry policy'))
  const data = await fileOf(dir)
  data.threads[0].reply = { text: 'yes, Postgres', at: 100, sentAt: null, ...patch }
  await writeFile(join(dir, '.geparkt/s1.json'), JSON.stringify(data))
  return { $, fire }
}

test('a typed prompt carries unsent replies once', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  const expected = store.replyBlock(store.unsentReplies(await fileOf(dir)))
  const { out } = await fire($, 'prompt.submit', typed())
  assert.deepEqual(out.context, [expected])
  assert.equal(typeof (await fileOf(dir)).threads[0].reply.sentAt, 'number')
  const again = await fire($, 'prompt.submit', typed())
  assert.equal(again.out.context, undefined)
})

test('only typed prompts carry replies', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  const cases = [
    typed({ origin: { kind: 'plugin' } }), typed({ origin: { kind: 'auto-continuation' } }), typed({ origin: { kind: 'unclassified' } }),
    typed({ command: 'todo' }), typed({ isMeta: true }),
  ]
  for (const input of cases) {
    const { out } = await fire($, 'prompt.submit', input)
    assert.equal(out.context, undefined)
  }
  assert.equal((await fileOf(dir)).threads[0].reply.sentAt, null)
  const { out } = await fire($, 'prompt.submit', typed({ origin: { kind: 'bridge' } }))
  assert.equal(out.context.length, 1)
})

test('a dropped prompt marks nothing', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  const { out } = await fire($, 'prompt.submit', typed(), async () => ({ drop: 'no' }))
  assert.equal(out.drop, 'no')
  assert.equal((await fileOf(dir)).threads[0].reply.sentAt, null)
})

test('submit fails open on a bad file', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await mkdir(join(dir, '.geparkt'), { recursive: true })
  await writeFile(join(dir, '.geparkt/s1.json'), '[]')
  const { passed, out } = await fire($, 'prompt.submit', typed())
  assert.equal(passed, true)
  assert.equal(out.context, undefined)
  assert.equal(out.text, 'go on')
})

test('a reply edited during submit stays waiting', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  await fire($, 'prompt.submit', typed(), async () => {
    const data = await fileOf(dir)
    data.threads[0].reply = { text: 'no, MySQL', at: 200, sentAt: null }
    await writeFile(join(dir, '.geparkt/s1.json'), JSON.stringify(data))
    return {}
  })
  assert.equal((await fileOf(dir)).threads[0].reply.sentAt, null)
})

test('a track call during submit is not lost', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  await fire($, 'prompt.submit', typed(), async () => { await fire($, 'tool.call', skill('+q new?')); return {} })
  const data = await fileOf(dir)
  assert.ok(data.threads.some((t) => t.text === 'new?'))
  assert.equal(typeof data.threads[0].reply.sentAt, 'number')
})

test('a reply on a thread Claude closed is sent marked after close', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  await fire($, 'tool.call', skill('r1 postgres'))
  const { out } = await fire($, 'prompt.submit', typed())
  assert.match(out.context[0], /\(closed before this reply\)/)
})

test('the view counts unsent replies', async () => {
  const dir = await repo(); const { $, fire } = await withReply(dir)
  await fire($, 'tool.call', skill('+q another?'))
  assert.equal((await $.state.get({ plugin: 'geparkt', key: 'view' })).value.unsent, 1)
  await fire($, 'prompt.submit', typed())
  assert.equal((await $.state.get({ plugin: 'geparkt', key: 'view' })).value.unsent, 0)
})
