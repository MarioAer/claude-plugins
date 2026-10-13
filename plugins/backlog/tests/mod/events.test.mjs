import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { register, replyFor } from '../../hooks/mod.js'
import { localDate } from '../../hooks/io.js'
import { fakeDollar, recorder } from './fake-dollar.mjs'

const TODAY = localDate(new Date())
async function repo() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'backlog-events-')))
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
  return dir
}
const read = (dir) => readFile(join(dir, '.backlog/backlog.md'), 'utf8')
function session(dir, options = {}) {
  const $ = fakeDollar({ cwd: dir, ...options })
  const { on, fire } = recorder()
  register(on)
  return { $, fire }
}
const command = (args) => ({ command: 'backlog:backlog', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

test('replyFor maps markers to the three replies', () => {
  assert.equal(replyFor('BACKLOG_ADDED: x\nnote'), 'Added to backlog: x')
  assert.equal(replyFor('BACKLOG_DUPLICATE: x\nnote'), 'Already on backlog: x')
  assert.equal(replyFor('BACKLOG_FAILED: the reason'), 'Backlog failed: the reason')
})

test('typed add writes the line, toasts and answers without reaching core', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  const { passed, out } = await fire($, 'command.run', command('  add tests\nfor parser  '))
  assert.equal(passed, false)
  assert.equal(out.text, 'Added to backlog: add tests for parser')
  assert.deepEqual($.log.toasts, ['Added to backlog: add tests for parser'])
  assert.match(await read(dir), new RegExp(`- \\[ \\] add tests for parser \\(${TODAY}, branch: main\\)\\n$`))
})

test('typed duplicate and refusal answer with their lines', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'command.run', command('Same'))
  assert.equal((await fire($, 'command.run', command('same'))).out.text, 'Already on backlog: same')
  const linked = await repo(); await mkdir(join(linked, '.backlog')); await writeFile(join(linked, 'o.md'), '')
  await symlink(join(linked, 'o.md'), join(linked, '.backlog/backlog.md'))
  const s2 = session(linked)
  assert.equal((await s2.fire(s2.$, 'command.run', command('x'))).out.text, `Backlog failed: ${linked}/.backlog/backlog.md is a symlink`)
})

test('typed list answers the numbered items or the empty line', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', command('list'))).out.text, 'Backlog is empty.')
  await fire($, 'command.run', command('one')); await fire($, 'command.run', command('two'))
  assert.equal((await fire($, 'command.run', command('LIST'))).out.text, `1. one (${TODAY}, branch: main)\n2. two (${TODAY}, branch: main)`)
})

test('a session directory inside .git is refused in every mode', async () => {
  const dir = await repo(); const { $, fire } = session(join(dir, '.git'))
  assert.equal((await fire($, 'command.run', command('x'))).out.text, 'Backlog failed: the session directory is inside .git or .claude')
  assert.equal((await fire($, 'command.run', command('list'))).out.text, 'Backlog failed: the session directory is inside .git or .claude')
})

test('other commands pass through untouched', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  assert.equal((await fire($, 'command.run', { ...command('x'), command: 'other:cmd' })).passed, true)
})
