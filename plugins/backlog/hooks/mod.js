// Backlog mod: answers typed /backlog commands and Claude's own Skill call inside Claude Code, and
// draws a toast, a transient band and a review pane. Loads on Claude Code 2.1.287 or later; where it
// does not load, hooks/backlog_hook.py and the skill behave as in 0.2.1. Item text never reaches a
// shell: subprocesses take argument vectors and the text is never one of them.
import * as store from './store.js'
import { localDate } from './io.js'

const SKILL = 'backlog:backlog'
const INSIDE = 'BACKLOG_FAILED: the session directory is inside .git or .claude'

// A bare /backlog remembers the session's cwd; the next prompt typed by the person is the item.
const CAPTURE_MS = 10 * 60 * 1000
const CAPTURE_ORIGINS = new Set(['composer', 'sdk', 'bridge'])
let capture = null

export function resetCapture() { capture = null }

// What the band and the pane draw from. Written only from events, never while drawing.
const BAND_MS = 10000
const EMPTY_VIEW = { root: null, items: [], order: [], bandUntil: 0, pane: null }

async function getView($) {
  const { value } = await $.state.get({ plugin: 'backlog', key: 'view' })
  return value ?? EMPTY_VIEW
}

async function setView($, change) {
  const { value, version } = await $.state.get({ plugin: 'backlog', key: 'view' })
  const next = change(value ?? EMPTY_VIEW)
  await $.state.set({ plugin: 'backlog', key: 'view' }, next, { ifVersion: version })
  return next
}

// Open items in display order: one group per tag in `order`, each item under its first tag,
// untagged items last; empty groups are dropped. Exported for tests.
export function arrange(items, order) {
  const groups = order.map((tag) => ({ tag, items: [] }))
  const untagged = { tag: null, items: [] }
  for (const item of items) {
    const first = store.itemTags(item)[0]
    const group = first === undefined ? undefined : groups.find((g) => g.tag === first)
    ;(group ?? untagged).items.push(item)
  }
  return [...groups, untagged].filter((g) => g.items.length > 0)
}

export function colorOf(tag, order) {
  const index = Math.max(order.indexOf(tag), 0)
  return store.PALETTE[index % store.PALETTE.length]
}

// The view's items (display order) and tag order from a fresh read.
async function loadView(io, root) {
  const { items, order } = await store.listWithOrder(io, root)
  return { items: arrange(items, order).flatMap((g) => g.items), order }
}

// Refreshes the open items and shows the band for BAND_MS; a timer redraws once it lapses.
async function showBand($, root) {
  let loaded = { items: [], order: [] }
  try { loaded = await loadView(modsIo($), root) } catch { /* the refusal was already reported */ }
  // An open pane keeps its cursor, clamped to the fresh list; an emptied list ends the review.
  const before = await getView($)
  const pane = before.pane && loaded.items.length > 0 ? { ...before.pane, index: Math.min(before.pane.index, loaded.items.length - 1) } : null
  await setView($, (current) => ({ ...current, root, ...loaded, bandUntil: Date.now() + BAND_MS, pane }))
  if (before.pane !== null && pane === null) {
    await $.ui.close({ id: PANE })
    $.ui.toast(`Review done: ${before.pane.done} done, ${before.pane.skipped} skipped, ${before.pane.notes} notes`)
  }
  $.ui.invalidate('ui.render')
  $.clock.after(BAND_MS + 100, () => $.ui.invalidate('ui.render'))
}

async function renderBand($, e, next) {
  const view = await getView($)
  const shown = view.pane !== null || view.bandUntil > Date.now()
  if (!shown || view.items.length === 0) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  return Box({ gap: 1, children: [
    Text({ dimColor: true, children: `Backlog: ${view.items.length} open` }),
    Button({ key: 'review', label: 'review', hotkey: 'r', plain: true, onPress: () => openPane($, view.root) }),
  ] })
}

const PANE = 'backlog-review'

async function openPane($, root) {
  const loaded = await loadView(modsIo($), root)
  await setView($, (view) => ({ ...view, root, ...loaded, pane: { index: 0, noteFor: null, tagsFor: null, draft: null, done: 0, skipped: 0, notes: 0 } }))
  await $.ui.open({ id: PANE, title: 'Backlog review', focus: true, closeOnEscape: true })
}

// After an action: re-read the items, count it, move on. removed means the current line left the
// open list (done, or vanished), so the cursor stays; otherwise it steps forward.
async function advance($, counter, removed) {
  const view = await getView($)
  if (view.pane === null) return
  let loaded = { items: view.items, order: view.order }
  try { loaded = await loadView(modsIo($), view.root) } catch { /* keep what was shown */ }
  const items = loaded.items
  const pane = { ...view.pane, noteFor: null, tagsFor: null, draft: null, [counter]: view.pane[counter] + 1, index: view.pane.index + (removed ? 0 : 1) }
  if (pane.index >= items.length) {
    await setView($, (v) => ({ ...v, ...loaded, pane: null }))
    await $.ui.close({ id: PANE })
    $.ui.toast(`Review done: ${pane.done} done, ${pane.skipped} skipped, ${pane.notes} notes`)
    return
  }
  await setView($, (v) => ({ ...v, ...loaded, pane }))
}

async function doneAction($) {
  const view = await getView($)
  if (view.pane === null) return
  const item = view.items[view.pane.index]
  try {
    const ok = await store.markDone(modsIo($), view.root, item)
    $.ui.toast(ok ? `Done: ${store.stripMeta(item)}` : `Backlog item changed on disk: ${store.stripMeta(item)}`)
    await advance($, ok ? 'done' : 'skipped', true)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Backlog failed: ${error.message}`)
    await advance($, 'skipped', false)
  }
}

async function noteAction($, value) {
  const view = await getView($)
  if (view.pane === null || view.pane.noteFor === null) return
  const item = view.pane.noteFor
  const note = store.normalize(value)
  if (note === '') {
    await setView($, (v) => ({ ...v, pane: { ...v.pane, noteFor: null, draft: null } }))
    return
  }
  try {
    const ok = await store.addNote(modsIo($), view.root, item, note)
    $.ui.toast(ok ? `Noted: ${store.stripMeta(item)}` : `Backlog item changed on disk: ${store.stripMeta(item)}`)
    await advance($, ok ? 'notes' : 'skipped', !ok)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Backlog failed: ${error.message}`)
    await advance($, 'skipped', false)
  }
}

// Re-reads the list and keeps the cursor on `keep` at its new position, else clamps the old index.
async function refreshPane($, keep) {
  const view = await getView($)
  if (view.pane === null) return
  let loaded = { items: view.items, order: view.order }
  try { loaded = await loadView(modsIo($), view.root) } catch { /* keep what was shown */ }
  if (loaded.items.length === 0) {
    await setView($, (v) => ({ ...v, ...loaded, pane: null }))
    await $.ui.close({ id: PANE })
    $.ui.toast(`Review done: ${view.pane.done} done, ${view.pane.skipped} skipped, ${view.pane.notes} notes`)
    return
  }
  const found = keep === null ? -1 : loaded.items.indexOf(keep)
  const index = found >= 0 ? found : Math.min(view.pane.index, loaded.items.length - 1)
  await setView($, (v) => ({ ...v, ...loaded, pane: { ...v.pane, noteFor: null, tagsFor: null, draft: null, index } }))
}

// The text typed into the note or tags field so far. A redraw re-applies an Input's value, and the
// band timer redraws ten seconds after any add, so the field must be drawn from the draft.
async function setDraft($, value) {
  await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, draft: value } }))
}

async function tagsAction($, value) {
  const view = await getView($)
  if (view.pane === null || view.pane.tagsFor === null) return
  const item = view.pane.tagsFor
  const { tags, ignored } = store.parseTagInput(value)
  for (const token of ignored) $.ui.toast(`Ignored tag: ${token}`)
  try {
    const updated = await store.setTags(modsIo($), view.root, item, tags)
    if (updated === null) {
      $.ui.toast(`Backlog item changed on disk: ${store.stripMeta(item)}`)
      await refreshPane($, null)
      return
    }
    $.ui.toast(`Tagged: ${store.stripMeta(item)}`)
    await refreshPane($, updated)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Backlog failed: ${error.message}`)
    await refreshPane($, item)
  }
}

async function renderPane($, e, next) {
  const view = await getView($)
  const pane = view.pane
  if (pane === null) return next(e)
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const groups = arrange(view.items, view.order)
  const rows = []
  let position = 0
  for (const group of groups) {
    rows.push(group.tag === null
      ? Text({ bold: true, dimColor: true, children: 'untagged' })
      : Text({ bold: true, color: colorOf(group.tag, view.order), children: `#${group.tag}` }))
    for (const item of group.items) {
      const index = position++
      rows.push(Box({ gap: 1, children: [
        Text({ bold: index === pane.index, dimColor: index < pane.index, wrap: 'truncate', children: `${index + 1}. ${store.withoutTagsField(item)}` }),
        ...store.itemTags(item).map((tag) => Text({ color: colorOf(tag, view.order), children: `#${tag}` })),
      ] }))
    }
  }
  // Plain buttons draw as "d: done", the shape of Claude Code's own survey rows, so each key is visible.
  const noting = pane.noteFor !== null
  const tagging = !noting && pane.tagsFor !== null
  let controls
  if (noting) {
    controls = [Input({ key: 'note', label: 'Note', placeholder: 'empty cancels', value: pane.draft ?? '', autoFocus: true, onInput: (value) => setDraft($, value), onSubmit: (value) => noteAction($, value) })]
  } else if (tagging) {
    controls = [Input({ key: 'tags', label: 'Tags', value: pane.draft ?? '', placeholder: 'space separated, empty clears', autoFocus: true, onInput: (value) => setDraft($, value), onSubmit: (value) => tagsAction($, value) })]
  } else {
    controls = [
      Button({ key: 'done', label: 'done', hotkey: 'd', plain: true, onPress: () => doneAction($) }),
      Button({ key: 'skip', label: 'skip', hotkey: 's', plain: true, onPress: () => advance($, 'skipped', false) }),
      Button({ key: 'note', label: 'note', hotkey: 'n', plain: true, onPress: () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, noteFor: v.items[v.pane.index] ?? null, draft: '' } })) }),
      Button({ key: 'tags', label: 'tags', hotkey: 't', plain: true, onPress: () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, tagsFor: v.items[v.pane.index] ?? null, draft: store.itemTags(v.items[v.pane.index] ?? '').join(' ') } })) }),
      Button({ key: 'close', label: 'close', hotkey: 'q', plain: true, onPress: () => $.ui.close({ id: PANE }) }),
    ]
  }
  const help = noting
    ? 'Enter saves the note, empty Enter cancels, Esc returns to the prompt.'
    : tagging
      ? 'Enter replaces the tags, empty Enter clears them, Esc returns to the prompt.'
      : 'Keys: d done, s skip, n note, t tags, q close. Tab moves, Enter presses, Esc returns to the prompt.'
  return Box({ flexDirection: 'column', gap: 1, children: [
    Box({ flexDirection: 'column', children: rows }),
    Box({ gap: 2, children: controls }),
    Text({ dimColor: true, wrap: 'wrap', children: help }),
  ] })
}

async function closePane($, e, next) {
  await setView($, (view) => ({ ...view, pane: null }))
  return next(e)
}

// The store's io interface over the mods API, declared here because the validator follows $ only
// into functions of this file. fs.read and fs.stat reject when the path is missing; the store wants
// null there. fs.write creates parent directories, as the store relies on.
function modsIo($) {
  return {
    async read(path) {
      try { return await $.fs.read(path) } catch { return null }
    },
    write: (path, text) => $.fs.write(path, text),
    async stat(path) {
      try { return await $.fs.stat(path, { resolve: true }) } catch { return null }
    },
    run: (argv, init) => $.process.run(argv, init),
    sleep: (ms) => $.clock.sleep(ms),
    today: () => localDate(new Date()),
  }
}

// The first marker line to the user-facing reply.
export function replyFor(marker) {
  const first = marker.split('\n')[0]
  if (first.startsWith('BACKLOG_ADDED: ')) return `Added to backlog: ${first.slice('BACKLOG_ADDED: '.length)}`
  if (first.startsWith('BACKLOG_DUPLICATE: ')) return `Already on backlog: ${first.slice('BACKLOG_DUPLICATE: '.length)}`
  return `Backlog failed: ${first.replace(/^BACKLOG_FAILED: /, '')}`
}

// What Claude reads after its own Skill call instead of the skill body: the marker SKILL.md
// section 0 documents, the one-line reply to give, and the data note.
export function contextFor(marker) {
  const first = marker.split('\n')[0]
  return `${first}\nRecorded by the backlog plugin; the skill text was not loaded. Reply with exactly one line: ${replyFor(marker)}. Then resume the current task without further comment. ${store.DATA_NOTE}`
}

// Adds text under the session's root; every refusal becomes a BACKLOG_FAILED marker.
async function performAdd($, cwd, text, byClaude) {
  const io = modsIo($)
  const { root, branch } = await store.locate(io, cwd)
  if (store.rootRefused(root)) return { root, marker: INSIDE }
  try {
    return { root, marker: await store.add(io, { root, branch, text, byClaude }) }
  } catch (error) {
    if (error instanceof store.Refused) return { root, marker: `BACKLOG_FAILED: ${error.message}` }
    throw error
  }
}

async function listText($, cwd, tag = null) {
  const io = modsIo($)
  const { root } = await store.locate(io, cwd)
  if (store.rootRefused(root)) return { root, text: replyFor(INSIDE) }
  try {
    const items = await store.list(io, root, tag)
    return { root, items, text: items.length ? store.numbered(items) : 'Backlog is empty.' }
  } catch (error) {
    if (error instanceof store.Refused) return { root, text: `Backlog failed: ${error.message}` }
    throw error
  }
}

async function runCommand($, e, next) {
  const text = store.normalize(e.args)
  const mode = store.modeOf(text)
  const cwd = await $.session.cwd()
  if (mode === 'empty') {
    capture = { cwd, until: Date.now() + CAPTURE_MS }
    return { text: 'What should go on the backlog?' }
  }
  if (mode === 'review') {
    if ((await $.session.surfaces()).length === 0) return next(e)
    const listed = await listText($, cwd)
    if (!listed.items) return { text: listed.text }
    if (listed.items.length === 0) return { text: 'Backlog is empty.' }
    await openPane($, listed.root)
    return { text: 'Backlog review opened.' }
  }
  if (mode === 'list' || mode === 'list-tag') {
    const listed = await listText($, cwd, mode === 'list-tag' ? store.listFilter(text) : null)
    await showBand($, listed.root)
    return { text: listed.text }
  }
  const { root, marker } = await performAdd($, cwd, text, false)
  const line = replyFor(marker)
  $.ui.toast(line)
  await showBand($, root)
  return { text: line }
}

async function callSkill($, e, next) {
  if (e.skill !== SKILL) return next(e)
  const text = store.normalize(e.args)
  if (store.modeOf(text) !== 'add') return next(e)
  // A tool.call answer would precede the permission rules; a deny rule on this call must still win.
  const { decision } = await $.tool.check({ tool: 'Skill', input: { skill: e.skill, args: e.args } })
  if (decision === 'deny') return next(e)
  const { root, marker } = await performAdd($, await $.session.cwd(), text, true)
  $.ui.toast(replyFor(marker))
  await showBand($, root)
  return { result: { success: true, commandName: SKILL, status: 'inline' }, context: [contextFor(marker)] }
}

async function submitPrompt($, e, next) {
  if (capture === null) return next(e)
  // A notification or a peer's message is not the person's answer: it passes by, the capture stays.
  if (!CAPTURE_ORIGINS.has(e.origin?.kind)) return next(e)
  const pending = capture
  capture = null
  if (Date.now() > pending.until) return next(e)
  const text = store.normalize(e.text)
  if (text === '' || text.startsWith('/')) return next(e)
  const { root, marker } = await performAdd($, pending.cwd, text, false)
  const line = replyFor(marker)
  $.ui.toast(line)
  await showBand($, root)
  return { drop: line }
}

export const register = (on) => {
  on('command.run', { command: 'backlog:backlog' }, runCommand)
  on('tool.call', { tool: 'Skill' }, callSkill)
  on('prompt.submit', submitPrompt)
  on('ui.render', { component: 'AbovePrompt' }, renderBand)
  on('ui.render', { component: 'Pane', requestId: 'backlog-review' }, renderPane)
  on('ui.close', { id: 'backlog-review' }, closePane)
}
