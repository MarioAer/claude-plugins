// A fake mods API for tests: real files through Node, recorded toasts, panes, prompt fills and state.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFile } from 'node:child_process'

export function recorder() {
  const hooks = []
  const PASSED = Symbol('passed')
  const on = (event, a, b) => {
    const [matcher, handler] = typeof a === 'function' ? [{}, a] : [a, b]
    hooks.push({ event, matcher, handler })
    return { catch() {} }
  }
  // Runs the registered hooks for event in order; next() past the last one stands for core.
  async function fire($, event, e) {
    const chain = hooks.filter((h) => h.event === event && Object.entries(h.matcher).every(([k, v]) => e[k] === v))
    let index = 0
    const next = async (input) => {
      const hook = chain[index++]
      if (!hook) return { [PASSED]: true, ...input }
      return hook.handler($, input, next)
    }
    const out = await next(e)
    return { passed: Boolean(out && out[PASSED]), out }
  }
  return { on, fire }
}

export function fakeDollar({ cwd, sessionId = 's1', surfaces = ['terminal'], toolCheck = { decision: 'allow' }, commands = [], todoReply = 'Added to todo list: x' } = {}) {
  const state = new Map()
  const log = { toasts: [], opened: [], closed: [], fills: [], commands: [] }
  const element = (type) => (props) => ({ type, ...props })
  return {
    log,
    session: { cwd: async () => cwd, id: async () => sessionId, surfaces: async () => surfaces },
    fs: {
      read: (path) => readFile(path, 'utf8'),
      write: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, 'utf8') },
      stat: async (path) => { const info = await lstat(path); return { kind: info.isFile() ? 'file' : 'dir', isLink: info.isSymbolicLink() } },
    },
    process: {
      run: (argv, init = {}) => new Promise((resolve) => {
        execFile(argv[0], argv.slice(1), { cwd: init.cwd }, (error, stdout, stderr) => resolve({ exitCode: error ? 1 : 0, stdout, stderr }))
      }),
    },
    tool: { check: async () => toolCheck },
    prompt: { fill: async (input) => { log.fills.push(input); return { isFilled: true } } },
    command: {
      list: async () => commands.map((name) => ({ name })),
      run: async (input) => { log.commands.push(input); return { text: todoReply } },
    },
    state: {
      get: async (ref) => state.get(ref.key) ?? { value: undefined, version: 0 },
      set: async (ref, value, options) => {
        const current = state.get(ref.key) ?? { version: 0 }
        if (options?.ifVersion !== undefined && options.ifVersion !== current.version) return { isSet: false, version: current.version }
        state.set(ref.key, { value, version: current.version + 1 })
        return { isSet: true, version: current.version + 1 }
      },
    },
    ui: {
      toast: (text) => { log.toasts.push(text) },
      open: async (pane) => { log.opened.push(pane); return { isPlaced: true } },
      close: async ({ id }) => { log.closed.push(id) },
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Input: element('Input') }),
    },
  }
}

// Depth-first search of a rendered tree for the first element matching pred.
export function find(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (pred(node)) return node
  const children = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
  for (const child of children) { const hit = find(child, pred); if (hit) return hit }
  return null
}
