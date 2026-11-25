import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../../hooks/mod.js'

// The engine kit refuses to mount on a surface it does not know, so the mod's own ui.render handler for
// the review pane is called directly (as close.test.mjs does for ui.close) with the few $ calls
// renderPane makes: state.get and ui.resolve. Elements are plain { type, ...props } objects.
const handlers = []
register((event, matcher, handler) => { handlers.push({ event, matcher, handler }); return { catch() {} } })
const renderPane = handlers.find((h) => h.event === 'ui.render' && h.matcher?.component === 'Pane' && h.matcher?.requestId === 'todo-review').handler

const pane = { index: 0, noteFor: null, tagsFor: null, draft: null, lastDone: null, done: 0, notes: 0, retagged: 0 }
const view = { root: '/repo', here: null, items: ['alpha (2026-01-01)', 'beta (2026-01-02)'], order: [], notes: {}, bandUntil: 0, pane, capture: null }
const $ = {
  state: { get: async () => ({ value: view, version: 1 }) },
  ui: { resolve: () => (['Box', 'Text', 'Button', 'Input'].reduce((all, type) => ({ ...all, [type]: (props) => ({ type, ...props }) }), {})) },
}
const render = async (surface) => renderPane($, { component: 'Pane', surface, requestId: 'todo-review', props: { isFocused: true, bodyColumns: 80 } }, async () => ({}))

// Depth-first search of a rendered tree for the first element matching pred.
function find(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (pred(node)) return node
  const children = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
  for (const child of children) { const hit = find(child, pred); if (hit) return hit }
  return null
}
// The Box that directly holds an element matching pred.
const parentOf = (tree, pred) => find(tree, (n) => n.type === 'Box' && (Array.isArray(n.children) ? n.children : [n.children]).some((c) => c && typeof c === 'object' && pred(c)))

test('a surface the pane does not know keeps the compact layout and the inverse cursor', async () => {
  for (const surface of [undefined, 'watch']) {
    const tree = await render(surface)
    assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '▶ 1. alpha' && n.inverse === true), String(surface))
    assert.equal(parentOf(tree, (n) => n.type === 'Text' && n.children === 'Todo · 2 open · 0 done').marginBottom, 0)
    assert.equal(parentOf(tree, (n) => n.type === 'Button' && n.key === 'done').width, undefined)
  }
})
