import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as store from '../../hooks/store.js'

const NOW = 1_000_000

test('parse reads every operation and rejects the batch on one bad part', () => {
  assert.deepEqual(store.parse('+q Use Postgres? | +T retry policy | r2 yes, Postgres | x#3'), [
    { op: 'add', kind: 'q', text: 'Use Postgres?' },
    { op: 'add', kind: 't', text: 'retry policy' },
    { op: 'resolve', id: 2, decision: 'yes, Postgres' },
    { op: 'drop', id: 3 },
  ])
  assert.throws(() => store.parse('+q fine | resolve 2'), /cannot read "resolve 2"/)
  assert.throws(() => store.parse('  '), /empty batch/)
  assert.throws(() => store.parse(Array(11).fill('x1').join(' | ')), /more than 10/)
  assert.throws(() => store.parse(`+q ${'a'.repeat(301)}`), /longer than 300/)
})

test('apply adds with monotonic ids, dedups open threads and never reuses an id', () => {
  let { data, changes } = store.apply(store.emptyData(), store.parse('+q A? | +t B'), { now: NOW, by: 'claude' })
  assert.deepEqual(changes, ['+1', '+2'])
  ;({ data, changes } = store.apply(data, store.parse('r1 yes | +q a?'), { now: NOW, by: 'claude' }))
  // a? matches nothing open once #1 is resolved, so it is a new thread with a new id.
  assert.deepEqual(changes, ['r1', '+3'])
  ;({ data, changes } = store.apply(data, store.parse('+t b'), { now: NOW, by: 'claude' }))
  assert.deepEqual(changes, ['=2'])
  assert.equal(data.threads.find((t) => t.id === 1).decision, 'yes')
  assert.equal(data.threads.find((t) => t.id === 1).by, 'claude')
})

test('apply refuses the whole batch on an unknown id, and closing twice changes nothing', () => {
  const { data } = store.apply(store.emptyData(), store.parse('+q A?'), { now: NOW, by: 'claude' })
  assert.throws(() => store.apply(data, store.parse('+q B? | r7'), { now: NOW, by: 'claude' }), /#7 is not a thread/)
  const once = store.apply(data, store.parse('r1 yes | +q B?'), { now: NOW, by: 'claude' })
  const twice = store.apply(once.data, store.parse('r1 yes | +q B?'), { now: NOW + 1, by: 'claude' })
  assert.deepEqual(twice.changes, ['~1', '=2'])
  assert.deepEqual(twice.data, once.data)
})

test('the marker lists the open ids and clips long text', () => {
  const { data, changes } = store.apply(store.emptyData(), store.parse(`+q ${'x'.repeat(80)} | +t short`), { now: NOW, by: 'claude' })
  const marker = store.okMarker(changes, data)
  assert.match(marker, /^GEPARKT_OK: \+1 \+2 \| open: #1 q x{59}…; #2 t short$/)
  assert.equal(store.openLine(store.emptyData()), 'none')
})

test('session ids that are not plain names are refused', () => {
  assert.throws(() => store.sessionPath('/r', '../x'), /not a plain name/)
  assert.throws(() => store.sessionPath('/r', null), /not a plain name/)
  assert.throws(() => store.sessionPath('/r', undefined), /not a plain name/)
  assert.equal(store.sessionPath('/r', 'abc-1'), '/r/.geparkt/abc-1.json')
})

test('age and staleness', () => {
  const t = { at: 0, touched: 0 }
  assert.equal(store.age(t, 5 * 60000), '5m')
  assert.equal(store.age(t, 3 * 3600000), '3h')
  assert.equal(store.age(t, 72 * 3600000), '3d')
  assert.equal(store.isStale(t, store.STALE_MS + 1), true)
})

test('text is cut by code point, never inside an emoji', () => {
  const text = `${'a'.repeat(58)}😀😀😀`
  assert.equal(store.clip(text), `${'a'.repeat(58)}😀…`)
  assert.equal(store.parse(`r1 ${'b'.repeat(299)}😀😀`)[0].decision, `${'b'.repeat(299)}😀`)
})

test('a file that does not read is refused and left as it is', async () => {
  const files = new Map([['/r/.geparkt/s.json', '{"next": 3, "threads": [{"id": 1}]}'], ['/r/.geparkt/t.json', '[]']])
  const io = { read: async (p) => files.get(p) ?? null, stat: async () => null, write: async (p, t) => files.set(p, t), run: async () => ({ exitCode: 1 }), now: () => NOW }
  await assert.rejects(store.record(io, '/r', 's', '+q A?', 'claude'), /is not a geparkt file/)
  await assert.rejects(store.load(io, '/r', 't'), /is not a geparkt file/)
  assert.equal(files.get('/r/.geparkt/s.json'), '{"next": 3, "threads": [{"id": 1}]}')
})
