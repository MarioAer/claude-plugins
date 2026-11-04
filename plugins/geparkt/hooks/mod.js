// Geparkt mod: answers Claude's own Skill call and the typed /geparkt inside Claude Code, and draws
// a band and a review pane. Where it does not load, hooks/geparkt_hook.py records the same calls.
// Thread text never reaches a shell: subprocesses take argument vectors and the text is never one.
import * as store from './store.js'

const SKILL = 'geparkt:track'
const PANE = 'geparkt-review'
const INSIDE = 'the session directory is inside .git or .claude'

// What the band and the pane draw from. Written only from events, never while drawing.
const EMPTY_VIEW = { root: null, sessionId: null, threads: [], unsent: 0, pane: null }

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

// The navigation order: threads that need a reply, then those with a reply waiting, then sent ones.
function order(threads) {
  const { needs, waiting, sent } = store.sections(threads)
  return [...needs, ...waiting, ...sent]
}

// The pane's selection after the open threads changed, by id. It stays on a thread that is still
// open, else moves to the one that followed it in the previous order, else to the last.
function reselect(selected, before, after) {
  if (after.length === 0) return null
  if (after.includes(selected)) return selected
  if (selected === null) return after[0]
  const index = before.indexOf(selected)
  return (index < 0 ? undefined : before.slice(index + 1).find((id) => after.includes(id))) ?? after[after.length - 1]
}

// The open threads go into the view and the pane's selection follows them, on the pane as it is at
// the write. An emptied list closes the pane; closePane then clears it, after its summary toast.
// Called only inside serial(), so views are written in the order the file was.
async function publish($, root, sessionId, data) {
  const threads = store.openThreads(data)
  const unsent = store.unsentReplies(data).length
  let emptied = false
  await setView($, (v) => {
    emptied = v.pane !== null && threads.length === 0
    const after = order(threads).map((t) => t.id)
    const pane = v.pane && {
      ...v.pane,
      selected: reselect(v.pane.selected, order(v.threads).map((t) => t.id), after),
      replyFor: after.includes(v.pane.replyFor) ? v.pane.replyFor : null,
    }
    return { ...v, root, sessionId, threads, unsent, pane }
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

// The mod's own /geparkt, registered as immediate so the review opens while Claude is mid-turn.
// A skill may not share a registered command's name, which is why the skill is named track.
const COMMAND = 'geparkt'
// The fallback toast for a refused registration is shown once per mod load.
let warned = false

// Loads this session's threads, so the band is right after a resume or a reload, then registers
// /geparkt last: a refusal (an older engine, or a name taken by another plugin) leaves
// /geparkt:track, which waits for the turn to end, and one toast says so.
async function startSession($, e, next) {
  const result = await next(e)
  try {
    const { io, root, sessionId } = await where($)
    if (!store.rootRefused(root)) await refresh($, io, root, sessionId)
  } catch { /* the band stays empty */ }
  try {
    await $.command.register({ name: COMMAND, description: 'Review the open questions and parked topics, also while Claude is working', argumentHint: '[list]', immediate: true })
  } catch {
    if (!warned) $.ui.toast('Mid-turn /geparkt is unavailable here; use /geparkt:track')
    warned = true
  }
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

// The open count when the current turn started, for the line under its answer.
let openAtStart = 0

async function turnStart($, e, next) {
  openAtStart = (await getView($)).threads.length
  return next(e)
}

// One line under an answer, only when the turn changed the number of open threads. A subagent's
// turn ends without a turn.start of its own and leaves the count to the main turn. next(e)
// resolves to the answer, or to a line another mod set, which is kept above this one.
async function turnComplete($, e, next) {
  if (e.agentId !== undefined) return next(e)
  const open = (await getView($)).threads.length
  const delta = open - openAtStart
  openAtStart = open
  if (delta === 0) return next(e)
  const result = await next(e)
  const line = `Geparkt: ${open} open (${delta > 0 ? '+' : ''}${delta})`
  const set = result.text !== undefined && result.text !== e.answer ? result.text : null
  return { ...result, text: set === null ? line : `${set}\n${line}` }
}

// Replies the user wrote in the pane ride on the next prompt typed here (or from the phone or
// web), as context, so they cost no turn of their own. The file is read before the prompt goes on
// and again after it entered the session; next(e) is never awaited inside serial(), which would hold
// up every other change to the file for as long as the prompt takes. A reply edited in between has
// a new `at` and stays waiting. Any failure passes the prompt on unchanged.
async function submitPrompt($, e, next) {
  const origin = e.origin?.kind
  if ((origin !== 'composer' && origin !== 'bridge') || e.command !== undefined || e.isMeta === true) return next(e)
  let sent = null
  try {
    const { io, root, sessionId } = await where($)
    if (!store.rootRefused(root)) {
      sent = await serial(async () => {
        const waiting = store.unsentReplies(await store.load(io, root, sessionId))
        if (waiting.length === 0) return null
        return { io, root, sessionId, stamps: waiting.map((t) => ({ id: t.id, at: t.reply.at })), block: store.replyBlock(waiting) }
      })
    }
  } catch { /* the prompt goes on without replies */ }
  if (sent === null) return next(e)
  const result = await next({ ...e, context: [...(e.context ?? []), sent.block] })
  if (result.drop) return result
  try {
    await serial(async () => {
      const data = await store.load(sent.io, sent.root, sent.sessionId)
      store.markSent(data, sent.stamps, sent.io.now())
      await store.save(sent.io, sent.root, sent.sessionId, data)
      await publish($, sent.root, sent.sessionId, data)
    })
  } catch { /* the replies stay waiting */ }
  return result
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
  await setView($, (v) => ({ ...v, pane: { selected: order(v.threads)[0]?.id ?? null, replyFor: null, drafts: {}, deferFor: null, resolved: 0 } }))
  await $.ui.open({ id: PANE, title: 'Geparkt', focus: true, closeOnEscape: true })
}

// The thread the pane has selected, or undefined.
const selectedOf = (view) => view.pane && view.threads.find((t) => t.id === view.pane.selected)

// Steps the selection through the navigation order by id; it stops at either end.
async function move($, delta) {
  await setView($, (v) => {
    const ids = order(v.threads).map((t) => t.id)
    if (v.pane === null || ids.length === 0) return v
    const at = ids.indexOf(v.pane.selected)
    const selected = ids[at < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, at + delta))]
    return { ...v, pane: { ...v.pane, selected } }
  })
}

const oneLine = (text) => store.clip(text.replace(/\s+/g, ' '))

// What closing a thread from the pane does to a reply Claude has not seen: it is dropped, and the
// toast says so. A sent reply stays on the thread.
function discardUnsent(thread) {
  if (!thread.reply || thread.reply.sentAt !== null) return ''
  const text = thread.reply.text
  thread.reply = null
  return `; unsent reply discarded: ${oneLine(text)}`
}

// Applies fn to a thread in the file (by default the selected one) and refreshes the view from what
// was written. fn may return text for the end of the toast. Options: counts(pane) gives the pane
// fields a change adds to, read at the write; id names another thread; subject replaces the
// thread's text in the toast.
async function act($, label, fn, { counts = () => ({}), id = null, subject = null } = {}) {
  const view = await getView($)
  if (view.pane === null) return
  const thread = id === null ? selectedOf(view) : view.threads.find((t) => t.id === id)
  if (!thread) {
    if (id !== null) $.ui.toast(`Thread #${id} is no longer open`)
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, replyFor: null, deferFor: null } }))
    return
  }
  let extra = ''
  try {
    const ok = await serial(async () => {
      const { data, ok } = await store.change(modsIo($), view.root, view.sessionId, thread.id, (t, now) => { extra = fn(t, now) ?? '' })
      await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, ...(ok ? counts(v.pane) : {}), replyFor: null, deferFor: null } }))
      await publish($, view.root, view.sessionId, data)
      return ok
    })
    $.ui.toast(ok ? `${label}: ${subject ?? store.clip(thread.text)}${extra}` : `Thread #${thread.id} is no longer open`)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Geparkt failed: ${error.message}`)
  }
}

const resolveAction = ($) => act($, 'Resolved', (t) => { t.status = 'resolved'; t.by = 'user'; return discardUnsent(t) }, { counts: (pane) => ({ resolved: pane.resolved + 1 }) })

const dropAction = ($) => act($, 'Dropped', (t) => { t.status = 'dropped'; t.by = 'user'; return discardUnsent(t) })

const without = (drafts, id) => Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== String(id)))

// Opens the reply input on the selected thread; its draft, if any, is shown in it.
async function replyAction($) {
  await setView($, (v) => v.pane === null || v.pane.selected === null ? v : { ...v, pane: { ...v.pane, replyFor: v.pane.selected } })
}

async function draftReply($, id, value) {
  await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, drafts: { ...v.pane.drafts, [String(id)]: value } } }))
}

// Saves the reply on the thread it was typed for. An empty reply only closes the input. A reply
// replaces the one before, also a sent one, and waits for the next typed prompt.
async function saveReply($, id, value) {
  if (id === null) return
  const text = store.replyText(value)
  if (text === '') {
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, replyFor: null, drafts: without(v.pane.drafts, id) } }))
    return
  }
  await act($, 'Reply saved', (t, now) => { t.reply = { text, at: now, sentAt: null } }, { id, subject: oneLine(text), counts: (pane) => ({ drafts: without(pane.drafts, id) }) })
}

// The save button: the draft as it is when the key is pressed, not as it was when drawn.
async function saveDraft($) {
  const { pane } = await getView($)
  const id = pane?.replyFor ?? pane?.selected ?? null
  if (id !== null) await saveReply($, id, pane.drafts[String(id)] ?? '')
}

// Puts the thread back in the prompt box as a draft; no turn starts until the person sends it.
async function backAction($) {
  const view = await getView($)
  const thread = selectedOf(view)
  if (!thread) return
  const { isFilled } = await $.prompt.fill({ text: `Back to #${thread.id}: ${thread.text} `, mode: 'replace' })
  if (!isFilled) { $.ui.toast('The prompt box is not available'); return }
  await $.ui.close({ id: PANE })
}

// What todo's answer to another plugin's /todo means: todo returns its marker line to plugin
// callers, so the check does not depend on the wording of its replies. Exported for tests.
export function deferOutcome(text) {
  if (text.startsWith('TODO_ADDED: ') || text.startsWith('TODO_DUPLICATE: ')) return 'ok'
  if (text.startsWith('TODO_FAILED: ')) return { failed: text.slice('TODO_FAILED: '.length) }
  return { failed: 'no answer from the todo plugin' }
}

// todo's immediate /todo where registered, else its skill command.
async function todoCommand($) {
  const commands = (await $.command.list()).map((c) => c.name)
  return ['todo', 'todo:capture'].find((name) => commands.includes(name)) ?? null
}

// The first f asks, the second hands the thread to the todo plugin and marks it deferred.
async function deferAction($) {
  const view = await getView($)
  if (view.pane === null) return
  const thread = selectedOf(view)
  if (!thread) return
  const command = await todoCommand($)
  if (command === null) { $.ui.toast('Defer needs the todo plugin'); return }
  if (view.pane.deferFor !== thread.id) {
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, deferFor: thread.id } }))
    return
  }
  const { text = '' } = await $.command.run({ command, args: `${thread.text} #question` })
  const outcome = deferOutcome(text)
  if (outcome !== 'ok') {
    $.ui.toast(`Defer failed: ${outcome.failed}`)
    await setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, deferFor: null } }))
    return
  }
  await act($, 'Deferred to todo', (t) => { t.status = 'deferred'; t.by = 'user'; return discardUnsent(t) })
}

async function renderPane($, e, next) {
  const view = await getView($)
  const pane = view.pane
  if (pane === null || view.threads.length === 0) return next(e)
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const focused = e.props?.isFocused === true
  const now = Date.now()
  const threads = order(view.threads)
  const current = threads.find((t) => t.id === pane.selected) ?? threads[0]

  const rows = threads.map((t) => {
    const isCursor = t.id === current.id
    const mark = isCursor ? (focused ? '▶' : '▷') : ' '
    return Box({ gap: 1, children: [
      Text({ bold: isCursor, inverse: isCursor && focused, dimColor: !isCursor && store.isStale(t, now), wrap: 'truncate', children: `${mark} #${t.id} ${t.text}` }),
      Text({ color: t.kind === 'q' ? 'cyan' : 'magenta', children: t.kind === 'q' ? '?' : '§' }),
      Text({ dimColor: true, children: store.age(t, now) }),
    ] })
  })
  const list = Box({ flexDirection: 'column', borderStyle: 'single', paddingX: 1, ...(focused ? { borderColor: 'cyan' } : { borderDimColor: true }), children: [
    Box({ gap: 2, children: [
      Text({ bold: true, children: `Geparkt · ${threads.length} open · ${pane.resolved} resolved` }),
      focused ? Text({ color: 'green', children: '● keys active' }) : Text({ dimColor: true, children: '○ not focused' }),
    ] }),
    ...rows,
  ] })

  const reply = current.reply
  const card = Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, ...(focused ? {} : { borderDimColor: true }), children: [
    Text({ bold: true, wrap: 'wrap', children: current.text }),
    Text({ dimColor: true, children: `${store.KINDS[current.kind]} · parked ${store.age(current, now)} ago${store.isStale(current, now) ? ' · stale' : ''}` }),
    reply ? Text({ wrap: 'wrap', children: `Reply (${store.stage(current)}): ${reply.text}` }) : Text({ dimColor: true, children: 'No reply. r adds one.' }),
  ] })

  // While the input is open the hotkeys are off, so typing j or k reaches the input.
  const typing = pane.replyFor === current.id
  const key = (name, label, hotkey, onPress) => Button({ key: name, label, ...(typing ? {} : { hotkey }), plain: true, ...(focused ? {} : { dimColor: true }), onPress })
  const controls = []
  if (typing) {
    const id = current.id
    controls.push(Input({ key: 'reply-input', label: 'Reply', placeholder: 'empty cancels', value: pane.drafts[String(id)] ?? '', submitLabel: 'save', autoFocus: true, onInput: (value) => draftReply($, id, value), onSubmit: (value) => saveReply($, id, value) }))
  }
  controls.push(Box({ columnGap: 2, flexWrap: 'wrap', children: [
    key('down', 'down', 'j', () => move($, 1)),
    key('up', 'up', 'k', () => move($, -1)),
    key('back', 'back to it', 'b', () => backAction($)),
    key('resolve', 'resolve', 'd', () => resolveAction($)),
    key('drop', 'drop', 'x', () => dropAction($)),
    typing ? key('save', 'save', 's', () => saveDraft($)) : key('reply', 'reply', 'r', () => replyAction($)),
    key('defer', pane.deferFor === current.id ? 'defer: press f again' : 'defer to todo', 'f', () => deferAction($)),
    key('close', 'close', 'q', () => $.ui.close({ id: PANE })),
  ] }))
  const help = typing ? 'Enter saves the reply, empty Enter cancels, Esc returns to the prompt.'
    : focused ? 'b puts the thread in the prompt box. Esc returns to the prompt.' : 'ctrl+x tab to focus · keys go to the prompt'
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
  on('command.run', { command: SKILL }, runCommand)
  on('command.run', { command: COMMAND }, runCommand)
  on('prompt.submit', submitPrompt)
  on('turn.start', turnStart)
  on('turn.complete', turnComplete)
  on('ui.render', { component: 'AbovePrompt' }, renderBand)
  on('ui.render', { component: 'Pane', requestId: 'geparkt-review' }, renderPane)
  on('ui.close', { id: 'geparkt-review' }, closePane)
}
