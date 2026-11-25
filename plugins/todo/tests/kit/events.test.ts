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
