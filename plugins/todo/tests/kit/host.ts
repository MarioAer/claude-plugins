// The engine side of a kit test: answers the calls the todo mod makes on `$` from memory and
// records what happened. A test hook sits beneath the plugin and stands for the engine, so a call
// on `$` is answered { value } and an event by its own result; next(e) reaches the kit's bottom,
// which rejects the call.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

// Local YYYY-MM-DD, formatted as hooks/io.js localDate does.
const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
export const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
export const ROOT = '/repo'

export type HostGit = {
  top: string
  main?: string
  branch?: string | null
  worktrees?: string[]
}
export type HostOptions = {
  cwd?: string
  git?: HostGit | null
  files?: Record<string, string>
  links?: string[]
  surfaces?: ('terminal' | 'desktop' | 'vscode' | 'mobile')[]
  toolCheck?: 'allow' | 'deny'
  refuseRegister?: boolean
  core?: Record<string, (e: any) => unknown>
}
export type Host = {
  files: Map<string, string>
  toasts: string[]
  opened: { id: string }[]
  closed: string[]
  registered: { name: string }[]
  reachedCore: string[]
  clock: MockClock
}

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)

// What the engine's events answer when nothing else does: the event's empty result.
const EMPTY: Record<string, (e: any) => unknown> = {
  'session.start': (e) => ({ cwd: e.cwd }),
  'command.run': () => ({ text: 'core' }),
  'prompt.submit': (e) => ({ text: e.text }),
  'prompt.autocomplete': () => ({ suggestions: [] }),
  'tool.call': () => ({ result: {} }),
  'turn.start': (e) => ({ turnId: e.turnId }),
  'turn.complete': (e) => ({ text: e.answer }),
}

export function host(on: On, options: HostOptions = {}): Host {
  const { cwd = ROOT, surfaces = ['terminal'], toolCheck = 'allow', refuseRegister = false, core = {} } = options
  const git = options.git === undefined ? { top: ROOT } : options.git
  const links = new Set(options.links ?? [])
  const files = new Map<string, string>(Object.entries(options.files ?? {}))
  const locks = new Set<string>()
  const h: Host = { files, toasts: [], opened: [], closed: [], registered: [], reachedCore: [], clock: mock.clock(on) }

  const main = git ? git.main ?? git.top : ROOT
  // The HEAD file `git rev-parse --git-path HEAD` names: the main checkout's, or a linked worktree's.
  const gitHead = () => (git!.top === main ? `${main}/.git/HEAD` : `${main}/.git/worktrees/${base(git!.top)}/HEAD`)
  if (git) files.set(gitHead(), git.branch === null ? '0'.repeat(40) + '\n' : `ref: refs/heads/${git.branch ?? 'main'}\n`)

  const ran = (exitCode: number, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

  on('session.cwd', () => ({ value: cwd }))
  on('session.surfaces', () => ({ value: surfaces }))

  on('fs.read', ($, e, next) => {
    const text = files.get(e.path)
    return text === undefined ? next(e) : { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', ($, e, next) => {
    const isLink = links.has(e.path)
    const text = files.get(e.path)
    if (text !== undefined) return { value: { kind: 'file', size: text.length, isLink, mtimeMs: 0, realPath: e.path } }
    const prefix = `${e.path}/`
    if (locks.has(e.path) || [...files.keys(), ...locks].some((held) => held.startsWith(prefix))) {
      return { value: { kind: 'dir', size: 0, isLink, mtimeMs: 0, realPath: e.path } }
    }
    return next(e)
  })

  on('process.run', ($, e, next) => {
    const argv = e.argv
    if (argv[0] === 'git' && argv.includes('rev-parse')) {
      if (git === null) return ran(128, '', 'fatal: not a git repository')
      return ran(0, `${git.top}\n${main}/.git\n${gitHead()}\n`)
    }
    if (argv[0] === 'git' && argv.includes('worktree') && argv.includes('list')) {
      if (git === null) return ran(128, '', 'fatal: not a git repository')
      const blocks = [main, ...(git.worktrees ?? [])].map((path) => `worktree ${path}\nHEAD 0\nbranch refs/heads/${base(path)}`)
      return ran(0, `${blocks.join('\n\n')}\n`)
    }
    if (argv[0] === 'mkdir') {
      if (locks.has(argv[1])) return ran(1, '', 'File exists')
      locks.add(argv[1])
      return ran(0)
    }
    if (argv[0] === 'rmdir') {
      locks.delete(argv[1])
      return ran(0)
    }
    return next(e)
  })

  on('tool.check', () => ({ decision: toolCheck }))

  on('command.register', ($, e, next) => {
    if (refuseRegister) return next(e)
    h.registered.push(e)
    return { value: { command: e.name } }
  })

  on('ui.toast', (_$, e) => {
    h.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    h.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    h.closed.push(e.id)
    return { value: undefined }
  })

  for (const event of Object.keys(EMPTY)) {
    on(event as any, ((_$: unknown, e: any) => {
      h.reachedCore.push(event)
      return (core[event] ?? EMPTY[event])(e)
    }) as any)
  }

  return h
}

export const todoFile = (root = ROOT) => `${root}/.todo/todo.md`

// A composer-origin command.run input, as the engine raises it for a typed /todo.
export const typed = (args: string, command = 'todo:capture'): object => ({
  command,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})
