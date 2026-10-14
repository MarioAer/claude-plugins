// Todo mod: answers typed /todo commands and Claude's own Skill call inside Claude Code, and
// draws a toast, a transient band and a review pane. Loads on Claude Code 2.1.287 or later; where it
// does not load, hooks/todo_hook.py and the skill behave as in 0.2.1. Item text never reaches a
// shell: subprocesses take argument vectors and the text is never one of them.
import * as store from './store.js'
import { localDate } from './io.js'

const SKILL = 'todo:todo'
const INSIDE = 'TODO_FAILED: the session directory is inside .git or .claude'

// A bare /todo remembers the session's cwd; the next prompt typed by the person is the item.
const CAPTURE_MS = 10 * 60 * 1000
const CAPTURE_ORIGINS = new Set(['composer', 'sdk', 'bridge'])
let capture = null

export function resetCapture() { capture = null }

// What the band and the pane draw from. Written only from events, never while drawing.
const BAND_MS = 10000
const EMPTY_VIEW = { root: null, items: [], order: [], notes: {}, bandUntil: 0, pane: null }

async function getView($) {
  const { value } = await $.state.get({ plugin: 'todo', key: 'view' })
  return value ?? EMPTY_VIEW
}

async function setView($, change) {
  const { value, version } = await $.state.get({ plugin: 'todo', key: 'view' })
  const next = change(value ?? EMPTY_VIEW)
  await $.state.set({ plugin: 'todo', key: 'view' }, next, { ifVersion: version })
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

// The view's items (display order), tag order and notes from a fresh read.
async function loadView(io, root) {
  const { items, order, notes } = await store.listWithOrder(io, root)
  return { items: arrange(items, order).flatMap((g) => g.items), order, notes }
}

export function summary(pane) {
  return `Review: ${pane.done} done, ${pane.notes} notes, ${pane.retagged} retagged`
}

// Refreshes the open items and shows the band for BAND_MS; a timer redraws once it lapses.
async function showBand($, root) {
  let loaded = { items: [], order: [], notes: {} }
  try { loaded = await loadView(modsIo($), root) } catch { /* the refusal was already reported */ }
  // An open pane keeps its cursor, clamped to the fresh list; an emptied list ends the review.
  const before = await getView($)
  const pane = before.pane && loaded.items.length > 0 ? { ...before.pane, index: Math.min(before.pane.index, loaded.items.length - 1) } : null
  await setView($, (current) => ({ ...current, root, ...loaded, bandUntil: Date.now() + BAND_MS, pane }))
  if (before.pane !== null && pane === null) {
    await $.ui.close({ id: PANE })
    $.ui.toast(summary(before.pane))
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
    Text({ dimColor: true, children: `Todo: ${view.items.length} open` }),
    Button({ key: 'review', label: 'review', hotkey: 'r', plain: true, onPress: () => openPane($, view.root) }),
  ] })
}

const PANE = 'todo-review'
// List rows (headings and items) drawn around the cursor; the rest are counted above and below.
const WINDOW = 10
// Below this many columns the detail card goes first and shows only the latest note.
const NARROW = 60

async function openPane($, root) {
  const loaded = await loadView(modsIo($), root)
  const pane = { index: 0, noteFor: null, tagsFor: null, draft: null, lastDone: null, done: 0, notes: 0, retagged: 0 }
  await setView($, (view) => ({ ...view, root, ...loaded, pane }))
  await $.ui.open({ id: PANE, title: 'Todo review', focus: true, closeOnEscape: true })
}

// Re-reads the list after an action and keeps the cursor on `keep` at its new position, else
// clamps the old index, so a done item hands the cursor to the one below it. `counts` merges into
// the pane. An emptied list ends the review.
async function refreshPane($, keep, counts = {}) {
  const view = await getView($)
  if (view.pane === null) return
  let loaded = { items: view.items, order: view.order, notes: view.notes }
  try { loaded = await loadView(modsIo($), view.root) } catch { /* keep what was shown */ }
  const pane = { ...view.pane, ...counts, noteFor: null, tagsFor: null, draft: null }
  if (loaded.items.length === 0) {
    await setView($, (v) => ({ ...v, ...loaded, pane: null }))
    await $.ui.close({ id: PANE })
    $.ui.toast(summary(pane))
    return
  }
  const found = keep === null ? -1 : loaded.items.indexOf(keep)
  const index = found >= 0 ? found : Math.min(view.pane.index, loaded.items.length - 1)
  await setView($, (v) => ({ ...v, ...loaded, pane: { ...pane, index } }))
}

// j, k, g and e: the new index from the old one and the list length, clamped, never wrapping.
async function move($, to) {
  await setView($, (v) => v.pane === null || v.items.length === 0 ? v
    : { ...v, pane: { ...v.pane, index: Math.max(0, Math.min(v.items.length - 1, to(v.pane.index, v.items.length))) } })
}

async function doneAction($) {
  const view = await getView($)
  if (view.pane === null) return
  const item = view.items[view.pane.index]
  try {
    const ok = await store.markDone(modsIo($), view.root, item)
    $.ui.toast(ok ? `Done: ${store.stripMeta(item)}` : `Todo item changed on disk: ${store.stripMeta(item)}`)
    await refreshPane($, null, ok ? { done: view.pane.done + 1, lastDone: item } : {})
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Todo failed: ${error.message}`)
    await refreshPane($, item)
  }
}

// Reopens the item last marked done in this review and puts the cursor back on it.
async function undoAction($) {
  const view = await getView($)
  if (view.pane === null) return
  const item = view.pane.lastDone
  if (item === null) {
    $.ui.toast('Nothing to undo')
    return
  }
  try {
    const ok = await store.markUndone(modsIo($), view.root, item)
    $.ui.toast(ok ? `Reopened: ${store.stripMeta(item)}` : `Todo item changed on disk: ${store.stripMeta(item)}`)
    await refreshPane($, ok ? item : null, ok ? { done: view.pane.done - 1, lastDone: null } : { lastDone: null })
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Todo failed: ${error.message}`)
  }
}

// A saved note stays on its item, so the card shows it at once.
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
    $.ui.toast(ok ? `Noted: ${store.stripMeta(item)}` : `Todo item changed on disk: ${store.stripMeta(item)}`)
    await refreshPane($, ok ? item : null, ok ? { notes: view.pane.notes + 1 } : {})
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Todo failed: ${error.message}`)
    await refreshPane($, item)
  }
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
      $.ui.toast(`Todo item changed on disk: ${store.stripMeta(item)}`)
      await refreshPane($, null)
      return
    }
    $.ui.toast(`Tagged: ${store.stripMeta(item)}`)
    await refreshPane($, updated, { retagged: view.pane.retagged + 1 })
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Todo failed: ${error.message}`)
    await refreshPane($, item)
  }
}

// The date and branch of an item's metadata, for the detail card.
export function itemMeta(item) {
  const match = store.META.exec(item)
  if (!match) return { date: null, branch: null }
  return { date: match[0].slice(2, 12), branch: match[1] ? match[1].slice(', branch: '.length) : null }
}

// List entries in display order, headings included, and the cursor's entry. Exported for tests.
export function listEntries(items, order) {
  const entries = []
  let position = 0
  for (const group of arrange(items, order)) {
    entries.push({ heading: group.tag })
    for (const item of group.items) entries.push({ item, index: position++ })
  }
  return entries
}

// The slice of entries drawn around the cursor's entry, and how many items are left out each side.
export function windowOf(entries, cursor, size = WINDOW) {
  const at = entries.findIndex((entry) => entry.index === cursor)
  const start = Math.max(0, Math.min(at - Math.floor(size / 2), entries.length - size))
  const end = Math.min(entries.length, start + size)
  const count = (list) => list.filter((entry) => entry.item !== undefined).length
  return { shown: entries.slice(start, end), above: count(entries.slice(0, start)), below: count(entries.slice(end)) }
}

async function renderPane($, e, next) {
  const view = await getView($)
  const pane = view.pane
  if (pane === null) return next(e)
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const focused = e.props?.isFocused === true
  const narrow = (e.props?.bodyColumns ?? NARROW) < NARROW
  const total = view.items.length
  const current = view.items[pane.index]
  const chips = (item) => store.itemTags(item).map((tag) => Text({ color: colorOf(tag, view.order), children: `#${tag}` }))

  // The list: a header with the focus badge, then the rows around the cursor.
  const { shown, above, below } = windowOf(listEntries(view.items, view.order), pane.index)
  const rows = shown.map((entry) => {
    if (entry.item === undefined) {
      return entry.heading === null
        ? Text({ bold: true, dimColor: true, children: 'untagged' })
        : Text({ bold: true, color: colorOf(entry.heading, view.order), children: `#${entry.heading}` })
    }
    const isCursor = entry.index === pane.index
    const mark = isCursor ? (focused ? '▶' : '▷') : ' '
    return Box({ gap: 1, children: [
      Text({ bold: isCursor, inverse: isCursor && focused, wrap: 'truncate', children: `${mark} ${entry.index + 1}. ${store.stripMeta(entry.item)}` }),
      ...chips(entry.item),
    ] })
  })
  const list = Box({ flexDirection: 'column', borderStyle: 'single', paddingX: 1, ...(focused ? { borderColor: 'cyan' } : { borderDimColor: true }), children: [
    Box({ gap: 2, children: [
      Text({ bold: true, children: `Todo · ${total} open · ${pane.done} done · ${pane.index + 1}/${total}` }),
      focused ? Text({ color: 'green', children: '● keys active' }) : Text({ dimColor: true, children: '○ not focused' }),
    ] }),
    ...(above > 0 ? [Text({ dimColor: true, children: `▲ ${above} more` })] : []),
    ...rows,
    ...(below > 0 ? [Text({ dimColor: true, children: `▼ ${below} more` })] : []),
  ] })

  // The card: everything about the cursor's item, its notes included.
  const { date, branch } = itemMeta(current)
  const notes = view.notes?.[current] ?? []
  const noteLine = (note) => Text({ wrap: 'wrap', children: `· ${note.date ? note.date.slice(5) : '     '}  ${note.text}` })
  const noteRows = notes.length === 0
    ? [Text({ dimColor: true, children: 'No notes yet. n adds one.' })]
    : narrow
      ? [noteLine(notes.at(-1)), ...(notes.length > 1 ? [Text({ dimColor: true, children: `+${notes.length - 1} earlier` })] : [])]
      : notes.map(noteLine)
  const card = Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, ...(focused ? {} : { borderDimColor: true }), children: [
    Text({ bold: true, wrap: 'wrap', children: store.stripMeta(current) }),
    Text({ dimColor: true, children: [date && `added ${date}`, branch && `branch ${branch}`].filter(Boolean).join(' · ') || 'no metadata' }),
    ...(store.itemTags(current).length > 0 ? [Box({ gap: 1, children: chips(current) })] : []),
    Text({ bold: true, children: `Notes (${notes.length})` }),
    ...noteRows,
  ] })

  // Plain buttons draw as "d: done", the shape of Claude Code's own survey rows, so each key is visible.
  const noting = pane.noteFor !== null
  const tagging = !noting && pane.tagsFor !== null
  let controls
  let help
  if (noting) {
    controls = [Input({ key: 'note', label: 'Note', placeholder: 'empty cancels', value: pane.draft ?? '', submitLabel: 'save', autoFocus: true, onInput: (value) => setDraft($, value), onSubmit: (value) => noteAction($, value) })]
    help = 'Enter saves the note, empty Enter cancels, Esc returns to the prompt.'
  } else if (tagging) {
    controls = [
      Input({ key: 'tags', label: 'Tags', value: pane.draft ?? '', placeholder: 'space separated, empty clears', submitLabel: 'save', autoFocus: true, onInput: (value) => setDraft($, value), onSubmit: (value) => tagsAction($, value) }),
      Text({ dimColor: true, wrap: 'wrap', children: view.order.length > 0 ? `known: ${view.order.map((tag) => `#${tag}`).join(' ')}` : 'no tags yet' }),
    ]
    help = 'Enter replaces the tags, empty Enter clears them, Esc returns to the prompt.'
  } else {
    const key = (name, label, hotkey, onPress, dim = false) => Button({ key: name, label, hotkey, plain: true, ...(dim || !focused ? { dimColor: true } : {}), onPress })
    controls = [
      Box({ columnGap: 2, flexWrap: 'wrap', children: [
        key('down', 'down', 'j', () => move($, (i) => i + 1)),
        key('up', 'up', 'k', () => move($, (i) => i - 1)),
        key('top', 'top', 'g', () => move($, () => 0)),
        key('end', 'end', 'e', () => move($, (_, n) => n - 1)),
      ] }),
      Box({ columnGap: 2, flexWrap: 'wrap', children: [
        key('done', 'done', 'd', () => doneAction($)),
        key('undo', 'undo', 'u', () => undoAction($), pane.lastDone === null),
        key('note', 'note', 'n', () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, noteFor: v.items[v.pane.index] ?? null, draft: '' } }))),
        key('tags', 'tags', 't', () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, tagsFor: v.items[v.pane.index] ?? null, draft: store.itemTags(v.items[v.pane.index] ?? '').join(' ') } }))),
        key('close', 'close', 'q', () => $.ui.close({ id: PANE })),
      ] }),
    ]
    help = focused
      ? 'Tab moves between keys, Enter presses, Esc returns to the prompt.'
      : 'ctrl+x tab to focus · keys go to the prompt'
  }
  return Box({ flexDirection: 'column', gap: 1, children: [
    ...(narrow ? [card, list] : [list, card]),
    Box({ flexDirection: 'column', children: controls }),
    Text({ dimColor: true, wrap: 'wrap', children: help }),
  ] })
}

// Closing by q, Esc or ctrl+x x ends the review with its summary.
async function closePane($, e, next) {
  const view = await getView($)
  if (view.pane !== null) $.ui.toast(summary(view.pane))
  await setView($, (v) => ({ ...v, pane: null }))
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
  if (first.startsWith('TODO_ADDED: ')) return `Added to todo list: ${first.slice('TODO_ADDED: '.length)}`
  if (first.startsWith('TODO_DUPLICATE: ')) return `Already on todo list: ${first.slice('TODO_DUPLICATE: '.length)}`
  return `Todo failed: ${first.replace(/^TODO_FAILED: /, '')}`
}

// What Claude reads after its own Skill call instead of the skill body: the marker SKILL.md
// section 0 documents, the one-line reply to give, and the data note.
export function contextFor(marker) {
  const first = marker.split('\n')[0]
  return `${first}\nRecorded by the todo plugin; the skill text was not loaded. Reply with exactly one line: ${replyFor(marker)}. Then resume the current task without further comment. ${store.DATA_NOTE}`
}

// Adds text under the session's root; every refusal becomes a TODO_FAILED marker.
async function performAdd($, cwd, text, byClaude) {
  const io = modsIo($)
  const { root, branch } = await store.locate(io, cwd)
  if (store.rootRefused(root)) return { root, marker: INSIDE }
  try {
    return { root, marker: await store.add(io, { root, branch, text, byClaude }) }
  } catch (error) {
    if (error instanceof store.Refused) return { root, marker: `TODO_FAILED: ${error.message}` }
    throw error
  }
}

async function listText($, cwd, tag = null) {
  const io = modsIo($)
  const { root } = await store.locate(io, cwd)
  if (store.rootRefused(root)) return { root, text: replyFor(INSIDE) }
  try {
    const items = await store.list(io, root, tag)
    return { root, items, text: items.length ? store.numbered(items) : 'Todo list is empty.' }
  } catch (error) {
    if (error instanceof store.Refused) return { root, text: `Todo failed: ${error.message}` }
    throw error
  }
}

async function runCommand($, e, next) {
  const text = store.normalize(e.args)
  const mode = store.modeOf(text)
  const cwd = await $.session.cwd()
  if (mode === 'empty') {
    capture = { cwd, until: Date.now() + CAPTURE_MS }
    return { text: 'What should go on the todo list?' }
  }
  if (mode === 'review') {
    if ((await $.session.surfaces()).length === 0) return next(e)
    const listed = await listText($, cwd)
    if (!listed.items) return { text: listed.text }
    if (listed.items.length === 0) return { text: 'Todo list is empty.' }
    await openPane($, listed.root)
    return { text: 'Todo review opened.' }
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
  on('command.run', { command: 'todo:todo' }, runCommand)
  on('tool.call', { tool: 'Skill' }, callSkill)
  on('prompt.submit', submitPrompt)
  on('ui.render', { component: 'AbovePrompt' }, renderBand)
  on('ui.render', { component: 'Pane', requestId: 'todo-review' }, renderPane)
  on('ui.close', { id: 'todo-review' }, closePane)
}
