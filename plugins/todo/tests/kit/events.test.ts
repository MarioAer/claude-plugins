import { expect, test } from 'claude-code/testing'
import { host, typed, todoFile, TODAY, ROOT } from './host'

const prompt = (text: string, kind = 'composer') => ({ text, wait: false, origin: { kind } })
const skillCall = (skill: string, args: string) => ({ tool: 'Skill', tool_use_id: 'toolu_1', skill, args })
// A typed /todo, the registered command: typed()'s input under the name `todo`, from any origin.
const slash = (args: string, origin = 'composer') => ({ ...typed(args, 'todo'), origin: { kind: origin } })
const turn = { text: 'go', turnId: 't1' }
// The declaration requires answer, durationMs and isAborted on turn.complete; the old fake took a bare { reason, turnId }.
const done = { reason: 'answer', turnId: 't1', answer: '', durationMs: 0, isAborted: false }
const worktree = '/repo/.claude/worktrees/wt'

test('typed add writes the line, toasts and answers without reaching core', async ($, on) => {
  const h = host(on)
  const out = await $.command.run(typed('  add tests\nfor parser  '))
  expect(out.text).toBe('Added to todo list: add tests for parser')
  expect(h.reachedCore).toEqual([])
  expect(h.toasts).toEqual(['Added to todo list: add tests for parser'])
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[ \\] add tests for parser \\(${TODAY}, branch: main\\)\\n$`))
})

test('typed duplicate and refusal answer with their lines', async ($, on) => {
  const h = host(on)
  await $.command.run(typed('Same'))
  expect((await $.command.run(typed('same'))).text).toBe('Already on todo list: same')
  h.links.add(todoFile())                     // the list becomes a symlink: the old test used a second repo
  expect((await $.command.run(typed('x'))).text).toBe(`Todo failed: ${ROOT}/.todo/todo.md is a symlink`)
})

test('typed list answers the numbered items or the empty line', async ($, on) => {
  host(on)                                    // holds no todo file: fs.read must reject
  expect((await $.command.run(typed('list'))).text).toBe('Todo list is empty.')
  await $.command.run(typed('one')); await $.command.run(typed('two'))
  expect((await $.command.run(typed('LIST'))).text).toBe(`1. one (${TODAY}, branch: main)\n2. two (${TODAY}, branch: main)`)
})

test('a session directory inside .git is refused in every mode', async ($, on) => {
  host(on, { cwd: '/repo/.git', git: null })
  expect((await $.command.run(typed('x'))).text).toBe('Todo failed: the session directory is inside .git or .claude')
  expect((await $.command.run(typed('list'))).text).toBe('Todo failed: the session directory is inside .git or .claude')
})

test('a worktree under .claude adds and lists', async ($, on) => {
  const h = host(on, { cwd: worktree, git: { top: worktree, main: ROOT, branch: 'wt', worktrees: [worktree] } })
  await $.command.run(typed('x'))
  expect((await $.command.run(typed('list'))).text).toBe(`1. x (${TODAY}, branch: wt, worktree: wt)`)
  expect(h.files.get(todoFile())).toMatch(/- \[ \] x \(.*, worktree: wt\)\n$/)   // the list lives in the main checkout
})

test('other commands pass through untouched', async ($, on) => {
  const h = host(on)
  await $.command.run({ ...typed('x'), command: 'other:cmd' })
  expect(h.reachedCore).toEqual(['command.run'])
})

test("Claude's add is answered with the Skill result shape, context and by: claude", async ($, on) => {
  const h = host(on)
  const out = await $.tool.call(skillCall('todo:capture', 'check\r\nflaky retry'))
  expect(h.reachedCore).toEqual([])
  expect(out.result).toEqual({ success: true, commandName: 'todo:capture', status: 'inline' })
  expect(out.context).toHaveLength(1)
  expect(out.context![0].startsWith('TODO_ADDED: check  flaky retry\n')).toBe(true)
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[ \\] check  flaky retry \\(${TODAY}, branch: main, by: claude\\)\\n$`))
  expect(h.toasts).toEqual(['Added to todo list: check  flaky retry'])
})

test("Claude's refused add carries TODO_FAILED and writes nothing", async ($, on) => {
  const h = host(on, { cwd: '/repo/.git', git: null })
  const out = await $.tool.call(skillCall('todo:capture', 'x'))
  expect(out.context![0].startsWith('TODO_FAILED: the session directory is inside .git or .claude\n')).toBe(true)
  expect(h.files.get(todoFile('/repo/.git'))).toBeUndefined()
})

test('other skills, list and review from the Skill tool pass through', async ($, on) => {
  const h = host(on)
  const calls = [skillCall('other:skill', 'x'), skillCall('todo:capture', 'list'), skillCall('todo:capture', 'review'), { tool: 'Read', tool_use_id: 't', file_path: 'a' }]
  for (const [i, call] of calls.entries()) {
    await $.tool.call(call)
    expect(h.reachedCore).toEqual(Array(i + 1).fill('tool.call'))   // each one reached core
  }
})

test('the old skill id is not answered', async ($, on) => {
  const h = host(on)
  await $.tool.call(skillCall('todo:todo', 'x'))
  expect(h.reachedCore).toEqual(['tool.call'])
})

test('headless bare /todo asks, then the next prompt is captured and dropped', async ($, on) => {
  const h = host(on, { surfaces: [] })
  expect((await $.command.run(typed(''))).text).toBe('What should go on the todo list?')
  const out = await $.prompt.submit(prompt('captured item'))
  expect(out.drop).toBe('Added to todo list: captured item')
  expect(h.reachedCore).toEqual([])
  expect(h.files.get(todoFile())).toMatch(/- \[ \] captured item \(/)
  await $.prompt.submit(prompt('a normal prompt'))
  expect(h.reachedCore).toEqual(['prompt.submit'])  // capture is one-shot
})

test('a slash command or a blank prompt from the user cancels the capture', async ($, on) => {
  const h = host(on, { surfaces: [] })        // one host for both texts: each cancel leaves no capture behind
  for (const text of ['/help', '   ']) {
    const seen = h.reachedCore.length
    await $.command.run(typed('   '))
    await $.prompt.submit(prompt(text))
    expect(h.reachedCore.slice(seen)).toEqual(['prompt.submit'])   // the cancelling prompt passes
    await $.prompt.submit(prompt('later text'))
    expect(h.reachedCore.slice(seen)).toEqual(['prompt.submit', 'prompt.submit'])   // capture cleared
    expect(h.files.get(todoFile())).toBeUndefined()
  }
})

test('a prompt from a non-user origin passes by and leaves the capture pending', async ($, on) => {
  const h = host(on, { surfaces: [] })
  await $.command.run(typed(''))
  await $.prompt.submit(prompt('from a task', 'task-notification'))
  expect(h.reachedCore).toEqual(['prompt.submit'])
  expect(h.files.get(todoFile())).toBeUndefined()   // the notification is not an item
  const out = await $.prompt.submit(prompt('fix the flaky test', 'bridge'))
  expect(h.reachedCore).toEqual(['prompt.submit'])  // the user's next prompt, from the bridge, is still captured
  expect(out.drop).toBe('Added to todo list: fix the flaky test')
})

test('without a pending capture prompts pass through', async ($, on) => {
  const h = host(on)
  await $.prompt.submit(prompt('hello'))
  expect(h.reachedCore).toEqual(['prompt.submit'])
})

test("a deny rule still blocks Claude's add: the mod passes a denied call through and writes nothing", async ($, on) => {
  const h = host(on, { toolCheck: 'deny' })
  const out = await $.tool.call(skillCall('todo:capture', 'blocked item'))
  // The mod's next(e) reaches the engine's own permission gate, which denies, so the call never reaches the core stand-in.
  expect(out.isError).toBe(true)
  expect(out.text).toBe('Permission to use Skill has been denied.')
  expect(h.reachedCore).toEqual([])
  expect(h.files.get(todoFile())).toBeUndefined()
  expect(h.toasts).toEqual([])
})

test('typed tagged add stores the tags and confirms the text without them', async ($, on) => {
  const h = host(on)
  const out = await $.command.run(typed('fix login #Auth #urgent'))
  expect(out.text).toBe('Added to todo list: fix login')
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[ \\] fix login \\(${TODAY}, branch: main, tags: auth, urgent\\)\\n$`))
  expect((await $.command.run(typed('#only'))).text).toBe('Todo failed: the item has no text')
})

test('typed list #tag filters; an unknown tag is empty; list #a b is an add', async ($, on) => {
  const h = host(on)
  await $.command.run(typed('one #auth')); await $.command.run(typed('two #build'))
  expect((await $.command.run(typed('list #AUTH'))).text).toBe(`1. one (${TODAY}, branch: main, tags: auth)`)
  expect((await $.command.run(typed('list #docs'))).text).toBe('Todo list is empty.')
  await $.command.run(typed('list #a b'))
  expect(h.files.get(todoFile())).toMatch(/- \[ \] list #a b \(/)
})

test("Claude's tagged add puts tags after by: claude; list #tag from the Skill tool passes through", async ($, on) => {
  const h = host(on)
  const out = await $.tool.call(skillCall('todo:capture', 'check retry #flaky'))
  expect(out.context![0].startsWith('TODO_ADDED: check retry\n')).toBe(true)
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[ \\] check retry \\(${TODAY}, branch: main, by: claude, tags: flaky\\)\\n$`))
  expect(h.reachedCore).toEqual([])
  await $.tool.call(skillCall('todo:capture', 'list #flaky'))
  expect(h.reachedCore).toEqual(['tool.call'])
})

test('session.start registers /todo as immediate', async ($, on) => {
  const h = host(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(h.reachedCore).toEqual(['session.start'])
  expect(h.registered).toHaveLength(1)
  const [spec] = h.registered
  expect(spec.description.length).toBeGreaterThan(0)
  expect({ ...spec, description: 'x' }).toEqual({ name: 'todo', description: 'x', argumentHint: '[<task text> | list | review | done <text>]', immediate: true })
})

test('a refused registration toasts once and session.start still passes on', async ($, on) => {
  const h = host(on, { refuseRegister: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(h.reachedCore).toEqual(['session.start'])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(h.reachedCore).toEqual(['session.start', 'session.start'])
  expect(h.toasts).toHaveLength(1)
  expect(h.toasts[0]).toMatch(/use \/todo:capture/)
})

test('typed /todo add with a surface answers {} and toasts', async ($, on) => {
  const h = host(on)
  const out = await $.command.run(slash('fix it'))
  expect(h.reachedCore).toEqual([])
  expect(out).toEqual({})
  expect(h.toasts).toEqual(['Added to todo list: fix it'])
  expect(h.files.get(todoFile())).toMatch(/- \[ \] fix it \(/)
})

test('headless add answers the reply line', async ($, on) => {
  host(on, { surfaces: [] })
  expect((await $.command.run(slash('x'))).text).toBe('Added to todo list: x')
})

test('plugin-origin add answers the marker and does not toast', async ($, on) => {
  const h = host(on)
  const out = await $.command.run(slash('x', 'plugin'))
  expect(out.text).toMatch(/^TODO_ADDED: x$/)
  expect(h.toasts).toEqual([])
})

test('/todo list keeps its text answer', async ($, on) => {
  host(on)
  expect((await $.command.run(slash('list'))).text).toBe('Todo list is empty.')
})

test('prompt.autocomplete suggests known tags and passes other input through', async ($, on) => {
  const h = host(on)
  await $.command.run(typed('tagged #auth'))
  const out = await $.prompt.autocomplete({ text: '/todo y #a', cursor: 10, token: '#a', start: 8 })
  expect(h.reachedCore).toEqual([])
  expect(out).toEqual({ suggestions: [{ text: '#auth', label: '#auth' }] })
  await $.prompt.autocomplete({ text: 'hello #a', cursor: 8, token: '#a', start: 6 })
  expect(h.reachedCore).toEqual(['prompt.autocomplete'])
})

test('prompt.autocomplete passes through inside .git', async ($, on) => {
  const h = host(on, { cwd: '/repo/.git', git: null })
  await $.prompt.autocomplete({ text: '/todo #', cursor: 7, token: '#', start: 6 })
  expect(h.reachedCore).toEqual(['prompt.autocomplete'])
})

test('turn.complete shows one line after a turn that added items', async ($, on) => {
  const h = host(on)
  await $.turn.start(turn)
  await $.command.run(slash('one'))
  await $.tool.call(skillCall('todo:capture', 'two'))
  const out = await $.turn.complete(done)
  expect(h.reachedCore).toContain('turn.complete')   // the hooks behind it and core still run
  expect(out.text).toBe('Todo: +2 this turn · 2 open')
})

test('turn.complete passes through when nothing was added', async ($, on) => {
  const h = host(on)
  await $.command.run(slash('before the turn'))
  await $.turn.start(turn)
  await $.turn.complete(done)
  expect(h.reachedCore).toContain('turn.complete')
})

test('a duplicate add does not count for the turn line', async ($, on) => {
  const h = host(on)
  await $.command.run(slash('same'))
  await $.turn.start(turn)
  await $.command.run(slash('same'))
  await $.turn.complete(done)
  expect(h.reachedCore).toContain('turn.complete')
})

test('a plugin-origin /todo:capture add answers the marker', async ($, on) => {
  host(on)
  const out = await $.command.run({ ...typed('x'), origin: { kind: 'plugin' } })
  expect(out.text).toMatch(/^TODO_ADDED: x$/)
})

test('a subagent turn.complete passes through and keeps the count for the main turn', async ($, on) => {
  const h = host(on)
  await $.turn.start(turn)
  await $.command.run(slash('one'))
  await $.turn.complete({ ...done, agentId: 'a1' })
  expect(h.reachedCore).toContain('turn.complete')
  expect((await $.turn.complete({ ...done, answer: 'A' })).text).toBe('Todo: +1 this turn · 1 open')
})

test('the turn line calls next and keeps a line another hook set', async ($, on) => {
  host(on, { core: { 'turn.complete': () => ({ text: 'Other: line' }) } })
  await $.turn.start(turn)
  await $.command.run(slash('one'))
  const out = await $.turn.complete({ ...done, answer: 'A' })
  expect(out.text).toBe('Other: line\nTodo: +1 this turn · 1 open')
})

test('typed /todo done closes the item and toasts Done', async ($, on) => {
  const h = host(on)
  await $.command.run(typed('fix login'))
  const out = await $.command.run(typed('done Fix Login'))
  expect(out.text).toBe('Done: fix login')
  expect(h.toasts.at(-1)).toBe('Done: fix login')
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[x\\] fix login \\(${TODAY}, branch: main\\)\\n$`))
})

test("Claude's done is answered with TODO_DONE context and a done by claude note", async ($, on) => {
  const h = host(on)
  await $.command.run(typed('pagination? #question'))
  const out = await $.tool.call(skillCall('todo:capture', 'done pagination?'))
  expect(h.reachedCore).toEqual([])
  expect(out.context![0].startsWith('TODO_DONE: pagination?\n')).toBe(true)
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[x\\] pagination\\? .*\\n  - ${TODAY}: done by claude\\n$`))
})

test("a deny rule still blocks Claude's done", async ($, on) => {
  const h = host(on, { toolCheck: 'deny' })   // a typed add never asks tool.check, so one host seeds and denies
  await $.command.run(typed('keep open'))
  const out = await $.tool.call(skillCall('todo:capture', 'done keep open'))
  expect(out.isError).toBe(true)              // the engine's permission gate denied the call the mod passed on
  expect(out.text).toBe('Permission to use Skill has been denied.')
  expect(h.reachedCore).toEqual([])
  expect(h.files.get(todoFile())).toMatch(/- \[ \] keep open/)
})

test('typed done with no match fails and adds nothing', async ($, on) => {
  const h = host(on)
  expect((await $.command.run(typed('done nothing here'))).text).toBe('Todo failed: no open item matches: nothing here')
  expect(h.files.get(todoFile())).toBeUndefined()
})

// Review Focus 2. The old tests called resetCapture(); kit tests cannot. Keep these two adjacent and in this order.
test('module state: a bare /todo leaves a capture pending', async ($, on) => {
  host(on, { surfaces: [] })
  expect((await $.command.run(typed(''))).text).toBe('What should go on the todo list?')
})

test('module state: the next test sees no pending capture', async ($, on) => {
  const h = host(on, { surfaces: [] })
  await $.prompt.submit(prompt('hello'))
  expect(h.reachedCore).toEqual(['prompt.submit'])
})

// A second add that meets the first one's lock waits for it on the clock; it does not take the lock for stale.
test('host: a lock taken a moment ago is not stale', async ($, on) => {
  const h = host(on)
  const items = () => (h.files.get(todoFile()) ?? '').split('\n').filter((line) => line.startsWith('- [ ] ')).map((line) => line.slice(6, line.indexOf(' (')))
  const adds = Promise.all([$.command.run(typed('one')), $.command.run(typed('two'))])
  await h.clock.settle()
  expect(items()).toEqual(['one'])            // the second add is asleep on the lock, not past it
  await h.clock.advance(50)
  await adds
  expect(items()).toEqual(['one', 'two'])
})
