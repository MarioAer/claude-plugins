// Geparkt mod: answers Claude's own Skill call and the typed /geparkt inside Claude Code, and draws
// a band and a review pane. Where it does not load, hooks/geparkt_hook.py records the same calls.
// Thread text never reaches a shell: subprocesses take argument vectors and the text is never one.
import * as store from './store.js'

const SKILL = 'geparkt:geparkt'
const PANE = 'geparkt-review'
const INSIDE = 'the session directory is inside .git or .claude'

// What the band and the pane draw from. Written only from events, never while drawing.
const EMPTY_VIEW = { root: null, sessionId: null, threads: [], pane: null }

async function getView($) {
  const { value } = await $.state.get({ plugin: 'geparkt', key: 'view' })
  return value ?? EMPTY_VIEW
}

// Reads, changes and writes with ifVersion, again on a miss, so interleaved events all land.
async function setView($, change) {
  for (let attempt = 0; ; attempt++) {
    const { value, version } = await $.state.get({ plugin: 'geparkt', key: 'view' })
    const next = change(value ?? EMPTY_VIEW)
    const { isSet } = await $.state.set({ plugin: 'geparkt', key: 'view' }, next, { ifVersion: version })
    if (isSet || attempt >= 4) return next
  }
}

// Every change to the session file runs after the one before, so a pane key pressed during
// Claude's call never overwrites it. A reload starts a fresh queue, as it starts a fresh module.
let queue = Promise.resolve()
function serial(fn) {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

// The open threads go into the view and the pane's cursor is clamped, on the pane as it is at the
// write. An emptied list closes the pane; closePane then clears it, after its summary toast.
// Called only inside serial(), so views are written in the order the file was.
async function publish($, root, sessionId, data) {
  const threads = store.openThreads(data)
  let emptied = false
  await setView($, (v) => {
    emptied = v.pane !== null && threads.length === 0
    const pane = v.pane && { ...v.pane, index: Math.max(0, Math.min(v.pane.index, threads.length - 1)) }
    return { ...v, root, sessionId, threads, pane }
  })
  if (emptied) await $.ui.close({ id: PANE })
}

// The project root, from git once per working directory.
let located = null
async function where($) {
  const io = modsIo($)
  const cwd = await $.session.cwd()
  if (located === null || located.cwd !== cwd) located = { cwd, root: await store.locate(io, cwd) }
  return { io, root: located.root, sessionId: await $.session.id() }
}

// Loads the file and redraws from it, after any change already queued.
function refresh($, io, root, sessionId) {
  return serial(async () => {
    const data = await store.load(io, root, sessionId)
    await publish($, root, sessionId, data)
    return data
  })
}

// Loads this session's threads, so the band is right after a resume or a reload.
async function startSession($, e, next) {
  const result = await next(e)
  try {
    const { io, root, sessionId } = await where($)
    if (!store.rootRefused(root)) await refresh($, io, root, sessionId)
  } catch { /* the band stays empty */ }
  return result
}

async function callSkill($, e, next) {
  if (e.skill !== SKILL) return next(e)
  // A tool.call answer would precede the permission rules; a deny rule on this call must still win.
  // Only an allow is answered here; an ask or a deny goes to the engine, which prompts or refuses.
  const { decision } = await $.tool.check({ tool: 'Skill', input: { skill: e.skill, args: e.args } })
  if (decision === 'deny') return next(e)
  const { io, root, sessionId } = await where($)
  if (decision !== 'allow') {
    // On an approved ask the fallback hook writes the file, so the call holds the queue and the
    // view is redrawn from the file after it.
    return serial(async () => {
      const result = await next(e)
      try {
        if (!store.rootRefused(root)) await publish($, root, sessionId, await store.load(io, root, sessionId))
      } catch { /* redrawn on the next event */ }
      return result
    })
  }
  let marker
  try {
    if (store.rootRefused(root)) throw new store.Refused(INSIDE)
    marker = await serial(async () => {
      const recorded = await store.record(io, root, sessionId, e.args, 'claude')
      // The batch is saved: a band that fails to redraw must not tell Claude it failed.
      try { await publish($, root, sessionId, recorded.data) } catch { /* redrawn on the next event */ }
      return recorded.marker
    })
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    marker = `GEPARKT_FAILED: ${error.message}`
  }
  return { result: { success: true, commandName: SKILL, status: 'inline' }, context: [store.contextFor(marker)] }
}

export function listText(threads, now) {
  if (threads.length === 0) return 'No open threads.'
  return threads.map((t) => `#${t.id} ${store.KINDS[t.kind]} · ${store.age(t, now)} · ${t.text}`).join('\n')
}

async function runCommand($, e, next) {
  const { io, root, sessionId } = await where($)
  if (store.rootRefused(root)) return { text: `Geparkt failed: ${INSIDE}` }
  let data
  try {
    data = await refresh($, io, root, sessionId)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    return { text: `Geparkt failed: ${error.message}` }
  }
  const threads = store.openThreads(data)
  const wantsList = store.normalize(e.args).toLowerCase() === 'list'
  if (wantsList || threads.length === 0 || (await $.session.surfaces()).length === 0) {
    return { text: listText(threads, io.now()) }
  }
  await openPane($)
  return { text: 'Geparkt review opened.' }
}

async function renderBand($, e, next) {
  const view = await getView($)
  if (view.threads.length === 0) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  const now = Date.now()
  const stale = view.threads.filter((t) => store.isStale(t, now)).length
  const questions = view.threads.filter((t) => t.kind === 'q').length
  const parts = [`Geparkt: ${view.threads.length} open`]
  if (questions > 0 && questions < view.threads.length) parts.push(`${questions} questions`)
  if (stale > 0) parts.push(`${stale} stale`)
  return Box({ gap: 1, children: [
    Text({ dimColor: true, children: parts.join(' · ') }),
    Button({ key: 'review', label: 'review', hotkey: 'p', plain: true, onPress: () => openPane($) }),
  ] })
}

async function openPane($) {
  const pane = { index: 0, noteFor: null, draft: null, deferFor: null, resolved: 0 }
  await setView($, (v) => ({ ...v, pane }))
  await $.ui.open({ id: PANE, title: 'Geparkt', focus: true, closeOnEscape: true })
}

async function move($, to) {
  await setView($, (v) => v.pane === null || v.threads.length === 0 ? v
    : { ...v, pane: { ...v.pane, index: Math.max(0, Math.min(v.threads.length - 1, to(v.pane.index, v.threads.length))) } })
}

// Applies fn to a thread in the file (by default the cursor's) and refreshes the view from what
// was written. counts(pane) gives the pane fields a change adds to, read at the write.
async function act($, label, fn, counts = () => ({}), id = null) {
  const view = await getView($)
  if (view.pane === null) return
  const thread = id === null ? view.threads[view.pane.index] : view.threads.find((t) => t.id === id)
  if (!thread) {
    if (id !== null) $.ui.toast(`Thread #${id} is no longer open`)
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, noteFor: null, draft: null, deferFor: null } }))
    return
  }
  try {
    const ok = await serial(async () => {
      const { data, ok } = await store.change(modsIo($), view.root, view.sessionId, thread.id, fn)
      await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, ...(ok ? counts(v.pane) : {}), noteFor: null, draft: null, deferFor: null } }))
      await publish($, view.root, view.sessionId, data)
      return ok
    })
    $.ui.toast(ok ? `${label}: ${store.clip(thread.text)}` : `Thread #${thread.id} is no longer open`)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Geparkt failed: ${error.message}`)
  }
}

const resolveAction = ($) => act($, 'Resolved', (t) => { t.status = 'resolved'; t.by = 'user' }, (pane) => ({ resolved: pane.resolved + 1 }))

const dropAction = ($) => act($, 'Dropped', (t) => { t.status = 'dropped'; t.by = 'user' })

// The note goes to the thread n was pressed on, wherever the cursor is by now.
async function noteAction($, value) {
  const view = await getView($)
  const target = view.pane?.noteFor ?? null
  const text = store.cut(store.normalize(value).replace(/\s+/g, ' '), store.MAX_TEXT)
  if (target === null || text === '') {
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, noteFor: null, draft: null } }))
    return
  }
  await act($, 'Noted', (t, now) => { t.notes.push({ at: now, text }) }, () => ({}), target)
}

async function setDraft($, value) {
  await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, draft: value } }))
}

// Puts the thread back in the prompt box as a draft; no turn starts until the person sends it.
async function backAction($) {
  const view = await getView($)
  const thread = view.pane && view.threads[view.pane.index]
  if (!thread) return
  const { isFilled } = await $.prompt.fill({ text: `Back to #${thread.id}: ${thread.text} `, mode: 'replace' })
  if (!isFilled) { $.ui.toast('The prompt box is not available'); return }
  await $.ui.close({ id: PANE })
}

// The first f asks, the second hands the thread to the todo plugin and marks it deferred.
async function deferAction($) {
  const view = await getView($)
  if (view.pane === null) return
  const thread = view.threads[view.pane.index]
  if (!thread) return
  if (view.pane.deferFor !== thread.id) {
    const commands = (await $.command.list()).map((c) => c.name)
    if (!commands.includes('todo:todo')) { $.ui.toast('Defer needs the todo plugin'); return }
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, deferFor: thread.id } }))
    return
  }
  const { text = '' } = await $.command.run({ command: 'todo:todo', args: `${thread.text} #question` })
  if (!/^(Added to|Already on) todo list/.test(text)) {
    $.ui.toast(text === '' ? 'Todo did not confirm the item' : text)
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, deferFor: null } }))
    return
  }
  await act($, 'Deferred to todo', (t) => { t.status = 'deferred'; t.by = 'user' })
}

async function renderPane($, e, next) {
  const view = await getView($)
  const pane = view.pane
  if (pane === null || view.threads.length === 0) return next(e)
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const focused = e.props?.isFocused === true
  const now = Date.now()
  const current = view.threads[pane.index]

  const rows = view.threads.map((t, i) => {
    const isCursor = i === pane.index
    const mark = isCursor ? (focused ? '▶' : '▷') : ' '
    return Box({ gap: 1, children: [
      Text({ bold: isCursor, inverse: isCursor && focused, dimColor: !isCursor && store.isStale(t, now), wrap: 'truncate', children: `${mark} #${t.id} ${t.text}` }),
      Text({ color: t.kind === 'q' ? 'cyan' : 'magenta', children: t.kind === 'q' ? '?' : '§' }),
      Text({ dimColor: true, children: store.age(t, now) }),
    ] })
  })
  const list = Box({ flexDirection: 'column', borderStyle: 'single', paddingX: 1, ...(focused ? { borderColor: 'cyan' } : { borderDimColor: true }), children: [
    Box({ gap: 2, children: [
      Text({ bold: true, children: `Geparkt · ${view.threads.length} open · ${pane.resolved} resolved` }),
      focused ? Text({ color: 'green', children: '● keys active' }) : Text({ dimColor: true, children: '○ not focused' }),
    ] }),
    ...rows,
  ] })

  const notes = current.notes ?? []
  const card = Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, ...(focused ? {} : { borderDimColor: true }), children: [
    Text({ bold: true, wrap: 'wrap', children: current.text }),
    Text({ dimColor: true, children: `${store.KINDS[current.kind]} · parked ${store.age(current, now)} ago${store.isStale(current, now) ? ' · stale' : ''}` }),
    ...(notes.length === 0 ? [Text({ dimColor: true, children: 'No notes. n adds one.' })] : notes.map((note) => Text({ wrap: 'wrap', children: `· ${note.text}` }))),
  ] })

  let controls
  let help
  if (pane.noteFor !== null) {
    controls = [Input({ key: 'note', label: 'Note', placeholder: 'empty cancels', value: pane.draft ?? '', submitLabel: 'save', autoFocus: true, onInput: (value) => setDraft($, value), onSubmit: (value) => noteAction($, value) })]
    help = 'Enter saves the note, empty Enter cancels, Esc returns to the prompt.'
  } else {
    const key = (name, label, hotkey, onPress) => Button({ key: name, label, hotkey, plain: true, ...(focused ? {} : { dimColor: true }), onPress })
    controls = [
      Box({ columnGap: 2, flexWrap: 'wrap', children: [
        key('down', 'down', 'j', () => move($, (i) => i + 1)),
        key('up', 'up', 'k', () => move($, (i) => i - 1)),
        key('back', 'back to it', 'b', () => backAction($)),
        key('resolve', 'resolve', 'd', () => resolveAction($)),
        key('drop', 'drop', 'x', () => dropAction($)),
        key('note', 'note', 'n', () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, noteFor: v.threads[v.pane.index]?.id ?? null, draft: '' } }))),
        key('defer', pane.deferFor === current.id ? 'defer: press f again' : 'defer to todo', 'f', () => deferAction($)),
        key('close', 'close', 'q', () => $.ui.close({ id: PANE })),
      ] }),
    ]
    help = focused ? 'b puts the thread in the prompt box. Esc returns to the prompt.' : 'ctrl+x tab to focus · keys go to the prompt'
  }
  return Box({ flexDirection: 'column', gap: 1, children: [list, card, Box({ flexDirection: 'column', children: controls }), Text({ dimColor: true, wrap: 'wrap', children: help })] })
}

async function closePane($, e, next) {
  const view = await getView($)
  if (view.pane !== null && view.pane.resolved > 0) $.ui.toast(`Geparkt: ${view.pane.resolved} resolved`)
  await setView($, (v) => ({ ...v, pane: null }))
  return next(e)
}

// The store's io interface over the mods API, declared here because the validator follows $ only
// into functions of this file. fs.read and fs.stat reject when the path is missing; the store wants
// null there. fs.write creates parent directories.
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
    now: () => Date.now(),
  }
}

export const register = (on) => {
  on('session.start', startSession)
  on('tool.call', { tool: 'Skill' }, callSkill)
  on('command.run', { command: 'geparkt:geparkt' }, runCommand)
  on('ui.render', { component: 'AbovePrompt' }, renderBand)
  on('ui.render', { component: 'Pane', requestId: 'geparkt-review' }, renderPane)
  on('ui.close', { id: 'geparkt-review' }, closePane)
}
