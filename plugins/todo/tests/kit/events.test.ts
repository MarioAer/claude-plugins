import { expect, test } from 'claude-code/testing'
import { host, typed, todoFile, TODAY } from './host'

const prompt = (text: string, kind = 'composer') => ({ text, wait: false, origin: { kind } })

test('typed add writes the line, toasts and answers without reaching core', async ($, on) => {
  const h = host(on)
  const out = await $.command.run(typed('  add tests\nfor parser  '))
  expect(out.text).toBe('Added to todo list: add tests for parser')
  expect(h.reachedCore).toEqual([])
  expect(h.toasts).toEqual(['Added to todo list: add tests for parser'])
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[ \\] add tests for parser \\(${TODAY}, branch: main\\)\\n$`))
})

test('typed list answers the numbered items or the empty line', async ($, on) => {
  host(on)                                    // holds no todo file: fs.read must reject
  expect((await $.command.run(typed('list'))).text).toBe('Todo list is empty.')
  await $.command.run(typed('one')); await $.command.run(typed('two'))
  expect((await $.command.run(typed('LIST'))).text).toBe(`1. one (${TODAY}, branch: main)\n2. two (${TODAY}, branch: main)`)
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

test('without a pending capture prompts pass through', async ($, on) => {
  const h = host(on)
  await $.prompt.submit(prompt('hello'))
  expect(h.reachedCore).toEqual(['prompt.submit'])
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
