// A fake mods API for tests: real files through node-io, recorded toasts, panes, timers and state.
import { nodeIo } from './node-io.mjs'

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

export function fakeDollar({ cwd, surfaces = ['terminal'], today } = {}) {
  const base = nodeIo({ today })
  const state = new Map()
  const log = { toasts: [], opened: [], closed: [], invalidations: 0, timers: [] }
  const element = (type) => (props) => ({ type, ...props })
  return {
    log,
    plugin: { name: 'backlog', root: '/plugin' },
    session: { cwd: async () => cwd, surfaces: async () => surfaces },
    fs: {
      read: async (path) => { const text = await base.read(path); if (text === null) throw new Error('ENOENT'); return text },
      write: base.write,
      stat: async (path) => { const info = await base.stat(path); if (!info) throw new Error('ENOENT'); return info },
    },
    process: { run: base.run },
    clock: {
      sleep: base.sleep,
      now: async () => Date.now(),
      after: (ms, fn) => { log.timers.push({ ms, fn }); return () => {} },
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
      invalidate: () => { log.invalidations++ },
      resolve: () => ({ Box: element('Box'), Text: element('Text'), Button: element('Button'), Input: element('Input') }),
    },
  }
}
