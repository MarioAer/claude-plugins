import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { register } from '../../hooks/mod.js'
import { fakeDollar, recorder } from './fake-dollar.mjs'

async function repo(content) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'backlog-ui-')))
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
  if (content !== undefined) { await mkdir(join(dir, '.backlog')); await writeFile(join(dir, '.backlog/backlog.md'), content) }
  return dir
}
const read = (dir) => readFile(join(dir, '.backlog/backlog.md'), 'utf8')
function session(dir, options = {}) {
  const $ = fakeDollar({ cwd: dir, ...options }); const { on, fire } = recorder(); register(on); return { $, fire }
}
const command = (args) => ({ command: 'backlog:backlog', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const band = { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: {} }
// Depth-first search of a rendered tree for the first element matching pred.
export function find(node, pred) {
  if (!node || typeof node !== 'object') return null
  if (pred(node)) return node
  const children = Array.isArray(node.children) ? node.children : node.children ? [node.children] : []
  for (const child of children) { const hit = find(child, pred); if (hit) return hit }
  return null
}
const TWO = '# Backlog\n\n- [ ] alpha (2026-01-01)\n- [ ] beta (2026-01-02)\n'

test('band is hidden before any backlog call', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  assert.equal((await fire($, 'ui.render', band)).passed, true)
})

test('band shows the open count after an add, with a 10 s timer', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('gamma'))
  const { passed, out } = await fire($, 'ui.render', band)
  assert.equal(passed, false)
  assert.ok(find(out, (n) => n.type === 'Text' && n.children === 'Backlog: 3 open'))
  assert.ok($.log.timers.some((t) => t.ms > 10000 && t.ms < 11000))
  assert.ok($.log.invalidations >= 1)
})

test('band hides once bandUntil has passed and when there are no items', async () => {
  const dir = await repo(TWO); const { $, fire } = session(dir)
  await fire($, 'command.run', command('list'))
  const { value, version } = await $.state.get({ plugin: 'backlog', key: 'view' })
  await $.state.set({ plugin: 'backlog', key: 'view' }, { ...value, bandUntil: Date.now() - 1 }, { ifVersion: version })
  assert.equal((await fire($, 'ui.render', band)).passed, true)
  const empty = await repo(); const s2 = session(empty)
  await s2.fire(s2.$, 'command.run', command('list'))
  assert.equal((await s2.fire(s2.$, 'ui.render', band)).passed, true)
})
