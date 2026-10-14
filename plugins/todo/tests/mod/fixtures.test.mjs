import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { add, list, markDone, addNote } from '../../hooks/store.js'
import { localDate } from '../../hooks/io.js'
import { nodeIo } from './node-io.mjs'

const TODAY = localDate(new Date())
const cases = JSON.parse(await readFile(new URL('../fixtures/store.json', import.meta.url), 'utf8'))
const fill = (text) => text.replaceAll('<today>', TODAY)

async function folderContent(dir) {
  const out = {}
  let names = []
  try { names = await readdir(join(dir, '.todo')) } catch { return out }
  for (const name of names) if (name !== '.lock') out[name] = await readFile(join(dir, '.todo', name), 'utf8')
  return out
}

for (const c of cases) {
  test(`fixture: ${c.name}`, async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'todo-fixture-')))
    if (c.files) {
      await mkdir(join(dir, '.todo'))
      for (const [name, content] of Object.entries(c.files)) await writeFile(join(dir, '.todo', name), content)
    }
    const io = nodeIo({ today: TODAY })
    if (c.op === 'add' && c.expect.refused !== undefined) {
      await assert.rejects(add(io, { root: dir, branch: c.branch, text: c.text, byClaude: c.byClaude }), (e) => e.message === c.expect.refused)
    } else if (c.op === 'add') {
      assert.equal(await add(io, { root: dir, branch: c.branch, text: c.text, byClaude: c.byClaude }), fill(c.expect.marker))
    }
    if (c.op === 'list') assert.deepEqual(await list(io, dir, c.tag ?? null), c.expect.items)
    if (c.op === 'done') assert.equal(await markDone(io, dir, c.item), c.expect.ok)
    if (c.op === 'note') assert.equal(await addNote(io, dir, c.item, c.note), c.expect.ok)
    const expected = Object.fromEntries(Object.entries(c.expect.files).map(([k, v]) => [k, fill(v)]))
    assert.deepEqual(await folderContent(dir), expected)
  })
}
