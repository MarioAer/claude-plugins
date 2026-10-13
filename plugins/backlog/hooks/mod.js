// Backlog mod: answers typed /backlog commands and Claude's own Skill call inside Claude Code, and
// draws a toast, a transient band and a review pane. Loads on Claude Code 2.1.287 or later; where it
// does not load, hooks/backlog_hook.py and the skill behave as in 0.2.1. Item text never reaches a
// shell: subprocesses take argument vectors and the text is never one of them.
import * as store from './store.js'
import { localDate } from './io.js'

const SKILL = 'backlog:backlog'
const INSIDE = 'BACKLOG_FAILED: the session directory is inside .git or .claude'

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

async function listText($, cwd) {
  const io = modsIo($)
  const { root } = await store.locate(io, cwd)
  if (store.rootRefused(root)) return { root, text: replyFor(INSIDE) }
  try {
    const items = await store.list(io, root)
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
  if (mode === 'empty') return { text: 'What should go on the backlog?' }
  if (mode === 'review') return next(e)
  if (mode === 'list') return { text: (await listText($, cwd)).text }
  const { marker } = await performAdd($, cwd, text, false)
  const line = replyFor(marker)
  $.ui.toast(line)
  return { text: line }
}

export const register = (on) => {
  on('command.run', { command: 'backlog:backlog' }, runCommand)
}
