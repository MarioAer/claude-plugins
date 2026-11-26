import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register, summary } from '../../hooks/mod.js'

// The engine kit cannot raise a person's ui.close, so the mod's own handler is called directly with the
// three $ calls closePane makes: state get, state set and ui.toast.
const pane = { index: 0, noteFor: null, tagsFor: null, draft: null, lastDone: null, done: 1, notes: 0, retagged: 0 }
const handlers = []
// on() answers a registration the mod may chain .catch on, as the engine's does.
register((event, matcher, handler) => { handlers.push({ event, matcher, handler }); return { catch() {} } })
const closeHandler = handlers.find((h) => h.event === 'ui.close' && h.matcher?.id === 'todo-review').handler

async function close(view) {
  let stored = { value: view, version: 1 }
  const toasts = []
  const $ = {
    state: { get: async () => stored, set: async (_key, value) => { stored = { value, version: stored.version + 1 } } },
    ui: { toast: (text) => toasts.push(text) },
  }
  const result = await closeHandler($, { id: 'todo-review' }, async () => ({}))
  return { toasts, view: stored.value, result }
}

test('summary formats the review counts', () => {
  assert.equal(summary({ ...pane, done: 1 }), 'Review: 1 done, 0 notes, 0 retagged')
})

test('a person closing the review pane toasts the summary and clears the pane', async () => {
  const { toasts, view, result } = await close({ items: [], pane })
  assert.deepEqual(toasts, ['Review: 1 done, 0 notes, 0 retagged'])
  assert.equal(view.pane, null)
  assert.deepEqual(result, {})
})

test('closing when the pane is already gone toasts nothing', async () => {
  const { toasts, view } = await close({ items: [], pane: null })
  assert.deepEqual(toasts, [])
  assert.equal(view.pane, null)
})
