# Backlog Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tags per backlog item: set with trailing `#tags` on an add, edited with `t` in the review pane, used by `list #tag`, and shown as coloured groups in the pane, with identical rules in the Python hook, the skill fallback and the mod.

**Architecture:** The tag rules live in two mirrored helper sets, `splitTags`/`itemTags`/`listFilter` in `hooks/store.js` and `split_tags`/`item_tags`/`list_filter` in `hooks/backlog_hook.py`, pinned to each other by the shared fixtures. The store's `add` and `list` grow tag awareness; `setTags` is the one new write. The mod keeps the display order and the tag order in its view state and draws groups and colours from them; the pane gains a fifth key.

**Tech Stack:** JavaScript ES modules, Node `node:test`; Python 3 standard library; bash and `claude -p` for e2e.

**Spec:** `docs/superpowers/specs/2026-10-13-backlog-tags-design.md` (builds on `docs/superpowers/specs/2026-10-12-backlog-mod-design.md`)

## Global Constraints

- Branch `feat/backlog-tags`, stacked on `feat/backlog-mod` (PR #10). Version 0.3.0 to 0.4.0 in the last task only.
- Metadata regex, verbatim in both implementations: `\s\(\d{4}-\d{2}-\d{2}(, branch: [^,)]*)?(, by: claude)?(, tags: [^)]*)?\)$`.
- Tag name pattern after lowercasing: `[a-z0-9][a-z0-9_-]{0,23}`. At most 8 tags per item, typed order, duplicates dropped. Stored as `, tags: a, b`, last field, omitted when empty.
- Refusal wording, both implementations: `the item has no text`. Markers carry the text without tags.
- Files without tags are written exactly as 0.3.0 wrote them: every existing fixture must keep passing unchanged.
- No shell for item text; no npm dependencies; `plugin` and `key` literals in `$.state` references; every `$` API call spelled inside `mod.js`.
- SKILL.md stays within the 4500-byte budget and the description within 250 characters (checked by `tests/run.sh`).
- Commits: `chore:` or `docs:`, at most 250 characters, one standalone `git commit` call per commit, with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer. No emojis.

## Review Focus

1. A text that is only tags (`/backlog #auth`) must be refused with `the item has no text` in both implementations, nothing written (Task 2 fixtures).
2. A tag token with an upper-case or invalid character (`#Auth`, `#auth!`) must lowercase or stay text, never crash or store an empty tag (Task 1 and Task 2 tests).
3. `list #auth` typed without the mod must filter, not add an item named `list #auth` (Task 3 hook test).
4. Pressing `t` and submitting tags that move the item to another group must leave the cursor on that item and never on a heading or past the end (Task 8 test).
5. A hand-edited line whose parenthesis holds a malformed `tags:` field must still list and must be left alone by `setTags` when it no longer matches (Task 4 test).

---

## File structure

| File | Responsibility |
|---|---|
| `plugins/backlog/hooks/store.js` | New: `TAG`, `MAX_TAGS`, `PALETTE`, `splitTags`, `itemTags`, `listFilter`, `tagOrder`, `parseTagInput`, `listWithOrder`, `setTags`; changed: `META`, `modeOf`, `add`, `list`. |
| `plugins/backlog/hooks/backlog_hook.py` | New: `TAG`, `MAX_TAGS`, `split_tags`, `item_tags`, `list_filter`; changed: `META`, `add`, `list_items`, `handle`. |
| `plugins/backlog/hooks/mod.js` | `list-tag` command path; view `order`; `loadView`, `arrange`, `colorOf`; grouped and coloured pane rows; `t` key, `tagsAction`, `refreshPane`; help lines. |
| `plugins/backlog/types/index.d.ts` | `ReviewPane.tagsFor`, `View.order`. |
| `plugins/backlog/skills/backlog/SKILL.md`, `fallback.md`, `review.md` | Mode row, add and list rules, one sentence on tags. |
| `plugins/backlog/tests/fixtures/store.json` | Tag cases (both suites). |
| `plugins/backlog/tests/store_fixtures.py` | Passes the `tag` field to `list_items`. |
| `plugins/backlog/tests/mod/store.test.mjs`, `events.test.mjs`, `ui.test.mjs`, `fixtures.test.mjs` | Tests per task. |
| `plugins/backlog/tests/add-hook.sh` | `list #tag` through the hook JSON; tagged add through the hook. |
| `plugins/backlog/tests/e2e.sh`, `tests/scenarios.md`, `README.md`, `plugin.json` | Scenarios S34 to S37, docs, 0.4.0. |

Two refinements of the spec, applied throughout this plan: `setTags` returns the rewritten item text (or `null` when the line is gone) rather than a boolean, because the pane needs the new text to keep the cursor on the item; the view stores `order: string[]` (tags in order of first appearance) and derives each colour from it, instead of a `palette` map, because the order is the only fact the colour depends on.

---

### Task 1: Tag parsing helpers in the store

**Files:**
- Modify: `plugins/backlog/hooks/store.js`
- Modify: `plugins/backlog/tests/mod/store.test.mjs`

**Interfaces:**
- Produces: `TAG` (RegExp), `MAX_TAGS = 8`, `PALETTE` (8 colour names), `splitTags(text) -> { text, tags }`, `itemTags(item) -> string[]`, `listFilter(text) -> string | null`, `tagOrder(content) -> string[]`, `parseTagInput(value) -> { tags, ignored }`; `modeOf` returns `'list-tag'` when `listFilter(text)` is not null; `META` accepts the `tags:` field.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/backlog/tests/mod/store.test.mjs`:

```js
import { splitTags, itemTags, listFilter, tagOrder, parseTagInput, PALETTE, MAX_TAGS } from '../../hooks/store.js'

test('splitTags takes trailing #tags only, lowercased, deduplicated, at most eight', () => {
  assert.deepEqual(splitTags('fix login #Auth #urgent #auth'), { text: 'fix login', tags: ['auth', 'urgent'] })
  assert.deepEqual(splitTags('issue #12 in parser'), { text: 'issue #12 in parser', tags: [] })
  assert.deepEqual(splitTags('fix #auth! #x'), { text: 'fix #auth!', tags: ['x'] })
  assert.deepEqual(splitTags('fix #'), { text: 'fix #', tags: [] })
  assert.deepEqual(splitTags('#only #tags'), { text: '', tags: ['only', 'tags'] })
  const nine = splitTags('x ' + Array.from({ length: 9 }, (_, i) => `#t${i}`).join(' '))
  assert.equal(nine.tags.length, MAX_TAGS)
  assert.equal(nine.tags[0], 't0')
  assert.deepEqual(splitTags(`x #${'a'.repeat(24)} #${'b'.repeat(25)}`), { text: `x #${'a'.repeat(24)} #${'b'.repeat(25)}`, tags: [] })
})

test('itemTags reads the tags field of a stored item', () => {
  assert.deepEqual(itemTags('fix login (2026-10-01, branch: main, tags: auth, urgent)'), ['auth', 'urgent'])
  assert.deepEqual(itemTags('fix login (2026-10-01, by: claude, tags: auth)'), ['auth'])
  assert.deepEqual(itemTags('fix login (2026-10-01, branch: main)'), [])
  assert.deepEqual(itemTags('no meta'), [])
})

test('META still strips a parenthesis with tags; stripMeta and the duplicate rule ignore tags', () => {
  assert.equal(stripMeta('fix login (2026-10-01, branch: main, tags: auth, urgent)'), 'fix login')
  assert.equal(stripMeta('fix login (2026-10-01, tags: auth)'), 'fix login')
})

test('listFilter and modeOf: one tag after list, any case; anything else is an add', () => {
  assert.equal(listFilter('list #Auth'), 'auth')
  assert.equal(listFilter('LIST #auth'), 'auth')
  assert.equal(listFilter('list #a b'), null)
  assert.equal(listFilter('list #'), null)
  assert.equal(listFilter('list'), null)
  assert.equal(modeOf('list #auth'), 'list-tag')
  assert.equal(modeOf('list #a b'), 'add')
  assert.equal(modeOf('list'), 'list')
})

test('tagOrder follows first appearance over open and closed lines', () => {
  const content = '# Backlog\n\n- [x] old (2026-01-01, tags: build)\n- [ ] a (2026-01-02, tags: auth, build)\n- [ ] b (2026-01-03)\n- [ ] c (2026-01-04, tags: docs)\n'
  assert.deepEqual(tagOrder(content), ['build', 'auth', 'docs'])
  assert.deepEqual(tagOrder(''), [])
})

test('parseTagInput splits on spaces and commas, drops # and invalid tokens, keeps eight', () => {
  assert.deepEqual(parseTagInput('#Auth, urgent  build'), { tags: ['auth', 'urgent', 'build'], ignored: [] })
  assert.deepEqual(parseTagInput('auth bad! auth'), { tags: ['auth'], ignored: ['bad!'] })
  assert.deepEqual(parseTagInput('   '), { tags: [], ignored: [] })
  assert.equal(parseTagInput(Array.from({ length: 9 }, (_, i) => `t${i}`).join(' ')).tags.length, MAX_TAGS)
})

test('PALETTE has eight distinct colour names', () => {
  assert.equal(new Set(PALETTE).size, 8)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E 'does not provide|ℹ (pass|fail)'`
Expected: `SyntaxError: ... does not provide an export named 'splitTags'`.

- [ ] **Step 3: Implement**

In `plugins/backlog/hooks/store.js`, replace the `META` line with:

```js
export const META = /\s\(\d{4}-\d{2}-\d{2}(, branch: [^,)]*)?(, by: claude)?(, tags: [^)]*)?\)$/
export const TAG = /^[a-z0-9][a-z0-9_-]{0,23}$/
export const MAX_TAGS = 8
// One colour per tag, by the tag's position in tagOrder, modulo eight.
export const PALETTE = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red', 'cyanBright', 'magentaBright']
```

Replace `modeOf` with:

```js
export function modeOf(text) {
  const mode = text.toLowerCase()
  if (mode === 'list') return 'list'
  if (mode === 'review') return 'review'
  if (text === '') return 'empty'
  if (listFilter(text) !== null) return 'list-tag'
  return 'add'
}

// The one tag of a `list #<tag>` argument, lowercased; null for anything else.
export function listFilter(text) {
  const match = /^list #(.+)$/i.exec(text)
  if (!match) return null
  const name = match[1].toLowerCase()
  return TAG.test(name) ? name : null
}
```

Append after `numbered`:

```js
// Trailing #tags off a normalised text: the text without them, and the tags in typed order,
// lowercased, deduplicated, at most MAX_TAGS. The first trailing token that is not a valid tag
// ends the scan and stays text, so a # inside the text is never a tag.
export function splitTags(text) {
  const words = text.split(' ')
  const found = []
  while (words.length > 0) {
    const last = words[words.length - 1]
    if (!last.startsWith('#')) break
    const name = last.slice(1).toLowerCase()
    if (!TAG.test(name)) break
    found.unshift(name)
    words.pop()
  }
  return { text: words.join(' ').trim(), tags: uniqueTags(found) }
}

function uniqueTags(names) {
  const unique = []
  for (const name of names) if (!unique.includes(name) && unique.length < MAX_TAGS) unique.push(name)
  return unique
}

// The tags field of a stored item (text with metadata), or none.
export function itemTags(item) {
  const match = /, tags: ([^)]*)\)$/.exec(item)
  return match ? match[1].split(',').map((t) => t.trim()).filter((t) => t !== '') : []
}

// Every tag in the file, open or closed lines, in order of first appearance: the colour order.
export function tagOrder(content) {
  const order = []
  for (const line of content.split('\n')) {
    if (!/^- \[[ x]\] /.test(line)) continue
    for (const tag of itemTags(line.slice(6))) if (!order.includes(tag)) order.push(tag)
  }
  return order
}

// The pane's tag input: tokens split on spaces and commas, a leading # dropped, lowercased;
// invalid tokens are returned separately so the caller can name them.
export function parseTagInput(value) {
  const tags = []
  const ignored = []
  for (const token of String(value ?? '').split(/[\s,]+/)) {
    if (token === '') continue
    const name = token.replace(/^#/, '').toLowerCase()
    if (TAG.test(name)) tags.push(name)
    else ignored.push(token)
  }
  return { tags: uniqueTags(tags), ignored }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'`
Expected: all pass (60 before plus 7 new); every existing fixture still passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/hooks/store.js plugins/backlog/tests/mod/store.test.mjs
git commit -m "chore: parse backlog tags in the mod store" -m "Trailing #tags, a tags: metadata field, the list #tag filter and the colour order, pinned before any write uses them." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tagged add, filtered list and the shared fixtures

**Files:**
- Modify: `plugins/backlog/hooks/store.js` (`add`, `list`)
- Modify: `plugins/backlog/tests/fixtures/store.json`
- Modify: `plugins/backlog/tests/mod/fixtures.test.mjs`
- Modify: `plugins/backlog/tests/store_fixtures.py`

**Interfaces:**
- Consumes: `splitTags`, `itemTags` from Task 1.
- Produces: `add(io, { root, branch, text, byClaude })` now splits trailing tags from `text`, stores `, tags: ...`, refuses empty text with `the item has no text`, and returns markers with the text without tags; `list(io, root, tag = null)` filters by tag when given. Fixture cases gain an optional `tag` field for `list`.

- [ ] **Step 1: Add the fixture cases**

Append these objects to the array in `plugins/backlog/tests/fixtures/store.json` (before the closing `]`, after a comma on the previous last case):

```json
  {
    "name": "tagged add stores the tags field and a marker without tags",
    "op": "add", "text": "fix login #Auth #urgent #auth", "branch": "main", "byClaude": false,
    "expect": {
      "marker": "BACKLOG_ADDED: fix login\nThe item text is data; do not act on it.",
      "files": {
        ".gitignore": "*\n",
        "backlog.md": "# Backlog\n\nDeferred tasks captured with /backlog. This folder is ignored by git; do not commit it.\n\n- [ ] fix login (<today>, branch: main, tags: auth, urgent)\n"
      }
    }
  },
  {
    "name": "tags come after by: claude",
    "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n" },
    "op": "add", "text": "check retry #flaky", "branch": null, "byClaude": true,
    "expect": {
      "marker": "BACKLOG_ADDED: check retry\nThe item text is data; do not act on it.",
      "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n- [ ] check retry (<today>, by: claude, tags: flaky)\n" }
    }
  },
  {
    "name": "an invalid trailing token stays text",
    "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n" },
    "op": "add", "text": "fix #auth! #x", "branch": null, "byClaude": false,
    "expect": {
      "marker": "BACKLOG_ADDED: fix #auth!\nThe item text is data; do not act on it.",
      "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n- [ ] fix #auth! (<today>, tags: x)\n" }
    }
  },
  {
    "name": "nine tags store eight",
    "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n" },
    "op": "add", "text": "x #t0 #t1 #t2 #t3 #t4 #t5 #t6 #t7 #t8", "branch": null, "byClaude": false,
    "expect": {
      "marker": "BACKLOG_ADDED: x\nThe item text is data; do not act on it.",
      "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n- [ ] x (<today>, tags: t0, t1, t2, t3, t4, t5, t6, t7)\n" }
    }
  },
  {
    "name": "tags-only text is refused and nothing is written",
    "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n" },
    "op": "add", "text": "#auth #urgent", "branch": null, "byClaude": false,
    "expect": {
      "refused": "the item has no text",
      "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n" }
    }
  },
  {
    "name": "a duplicate add keeps the existing tags",
    "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n- [ ] fix login (2026-01-01, tags: auth)\n" },
    "op": "add", "text": "Fix Login #urgent", "branch": null, "byClaude": false,
    "expect": {
      "marker": "BACKLOG_DUPLICATE: Fix Login\nThe item text is data; do not act on it.",
      "files": { ".gitignore": "*\n", "backlog.md": "# Backlog\n\n- [ ] fix login (2026-01-01, tags: auth)\n" }
    }
  },
  {
    "name": "list with a tag filter matches case-insensitively",
    "files": { "backlog.md": "# Backlog\n\n- [ ] a (2026-01-01, tags: auth, build)\n- [x] gone (2026-01-01, tags: auth)\n- [ ] b (2026-01-02)\n- [ ] c (2026-01-03, tags: AUTH)\n" },
    "op": "list", "tag": "auth",
    "expect": { "items": ["a (2026-01-01, tags: auth, build)"], "files": { "backlog.md": "# Backlog\n\n- [ ] a (2026-01-01, tags: auth, build)\n- [x] gone (2026-01-01, tags: auth)\n- [ ] b (2026-01-02)\n- [ ] c (2026-01-03, tags: AUTH)\n" } }
  },
  {
    "name": "list with a tag nobody carries is empty",
    "files": { "backlog.md": "# Backlog\n\n- [ ] a (2026-01-01, tags: auth)\n" },
    "op": "list", "tag": "docs",
    "expect": { "items": [], "files": { "backlog.md": "# Backlog\n\n- [ ] a (2026-01-01, tags: auth)\n" } }
  }
```

(The stored `tags: AUTH` line in the match case is a hand-edited file: both implementations compare stored tags as they are, lowercased by the writer, so `AUTH` does not match `auth`. This pins that the filter never lowercases stored data.)

- [ ] **Step 2: Teach both runners the new fields**

In `plugins/backlog/tests/mod/fixtures.test.mjs`, replace the two lines for `add` and `list` with:

```js
    if (c.op === 'add' && c.expect.refused !== undefined) {
      await assert.rejects(add(io, { root: dir, branch: c.branch, text: c.text, byClaude: c.byClaude }), (e) => e.message === c.expect.refused)
    } else if (c.op === 'add') {
      assert.equal(await add(io, { root: dir, branch: c.branch, text: c.text, byClaude: c.byClaude }), fill(c.expect.marker))
    }
    if (c.op === 'list') assert.deepEqual(await list(io, dir, c.tag ?? null), c.expect.items)
```

In `plugins/backlog/tests/store_fixtures.py`, replace the `add` and `list` branches of `run` with:

```python
        if case["op"] == "add":
            if "refused" in case["expect"]:
                try:
                    hook.add(root, case["branch"], case["text"], case["byClaude"])
                    return "expected a refusal"
                except hook.Refused as exc:
                    if str(exc) != case["expect"]["refused"]:
                        return f"refusal {exc!s}"
            else:
                got = hook.add(root, case["branch"], case["text"], case["byClaude"])
                if got != fill(case["expect"]["marker"]):
                    return f"marker {got!r}"
        elif case["op"] == "list":
            items = case["expect"]["items"]
            want = f"BACKLOG_LIST:\n{hook.numbered(items)}\n{hook.DATA_NOTE}" if items else "BACKLOG_LIST: Backlog is empty."
            got = hook.list_items(root, case.get("tag"))
            if got != want:
                return f"list {got!r}"
```

- [ ] **Step 3: Run both suites to verify the new cases fail**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'` and `python3 tests/store_fixtures.py | grep -c FAIL`
Expected: Node: the eight new fixture tests fail (tags stored as text, no refusal, `list` ignores its third argument); Python: the runner stops with a `TypeError` traceback, because `list_items` takes one argument today, and exits 1. Task 3 turns that into PASS lines.

- [ ] **Step 4: Implement in the store**

In `plugins/backlog/hooks/store.js`, change `add`:

```js
export async function add(io, { root, branch, text: raw, byClaude }) {
  if (raw.length > MAX_LEN) throw new Refused(`the item is longer than ${MAX_LEN} characters`)
  const { text, tags } = splitTags(raw)
  if (text === '') throw new Refused('the item has no text')
  const folder = `${root}/.backlog`
  return withLock(io, folder, async () => {
    const ignore = `${folder}/.gitignore`
    if (!(await io.stat(ignore))) await io.write(ignore, '*\n')
    const path = `${folder}/backlog.md`
    let content = await io.read(path)
    if (content === null) {
      content = HEADER
      await io.write(path, HEADER)
    }
    const wanted = text.toLowerCase()
    for (const item of openItems(content)) {
      if (stripMeta(item).toLowerCase() === wanted) return `BACKLOG_DUPLICATE: ${text}\n${DATA_NOTE}`
    }
    const meta = [io.today()]
    if (branch) meta.push(`branch: ${branch}`)
    if (byClaude) meta.push('by: claude')
    if (tags.length > 0) meta.push(`tags: ${tags.join(', ')}`)
    let line = `- [ ] ${text} (${meta.join(', ')})\n`
    if (content.length > 0 && !content.endsWith('\n')) line = `\n${line}`
    await io.write(path, content + line)
    return `BACKLOG_ADDED: ${text}\n${DATA_NOTE}`
  })
}
```

Change `list`:

```js
export async function list(io, root, tag = null) {
  const folder = `${root}/.backlog`
  await checkLinks(io, folder)
  const items = openItems((await io.read(`${folder}/backlog.md`)) ?? '')
  return tag === null ? items : items.filter((item) => itemTags(item).includes(tag))
}
```

- [ ] **Step 5: Run the Node suite to verify it passes**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'`
Expected: all pass, including every pre-existing fixture. The Python side stays red until Task 3.

- [ ] **Step 6: Commit**

```bash
git add plugins/backlog/hooks/store.js plugins/backlog/tests/fixtures/store.json plugins/backlog/tests/mod/fixtures.test.mjs plugins/backlog/tests/store_fixtures.py
git commit -m "chore: store backlog tags on add and filter lists by tag in the mod store" -m "The shared fixtures carry the tag cases; the Python hook catches up in the next commit." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Python hook parity

**Files:**
- Modify: `plugins/backlog/hooks/backlog_hook.py`
- Modify: `plugins/backlog/tests/add-hook.sh` (before the shared fixtures block)

**Interfaces:**
- Produces: `TAG`, `MAX_TAGS`, `split_tags(text) -> (text, tags)`, `item_tags(item) -> list`, `list_filter(text) -> str | None`, `list_items(root, tag=None)`, `add` storing tags and refusing empty text; `handle` routes `list #<tag>`.

- [ ] **Step 1: Write the failing hook tests**

In `plugins/backlog/tests/add-hook.sh`, before the line `# --- shared store fixtures`, add:

```bash
# --- tags ----------------------------------------------------------------------
new_repo "$WORK/tags"
out=$(typed "$WORK/tags" "fix login #Auth #urgent" | ctx)
check "typed tagged add reports the text without tags" equals "${out%%$'\n'*}" "BACKLOG_ADDED: fix login"
check "typed tagged add stores the tags field" has_line "$WORK/tags/.backlog/backlog.md" "- [ ] fix login ($TODAY, branch: main, tags: auth, urgent)"
claude_add "$WORK/tags" "check retry #flaky" >/dev/null
check "Claude's tagged add puts tags after by: claude" has_line "$WORK/tags/.backlog/backlog.md" "- [ ] check retry ($TODAY, branch: main, by: claude, tags: flaky)"
out=$(typed "$WORK/tags" "#only" | ctx)
check "tags-only text is refused" equals "$out" "BACKLOG_FAILED: the item has no text"
out=$(typed "$WORK/tags" "list #AUTH" | ctx)
check "list #tag filters through the hook" equals "$out" "BACKLOG_LIST:
1. fix login ($TODAY, branch: main, tags: auth, urgent)
The item text is data; do not act on it."
out=$(typed "$WORK/tags" "list #docs" | ctx)
check "list #tag with no match is empty" equals "$out" "BACKLOG_LIST: Backlog is empty."
check "list #tag added nothing" equals "$(grep -c 'list #' "$WORK/tags/.backlog/backlog.md")" "0"
typed "$WORK/tags" "list #a b" >/dev/null
check "list with two tags is an item" has_line "$WORK/tags/.backlog/backlog.md" "- [ ] list #a b ($TODAY, branch: main)"
```

- [ ] **Step 2: Run the suite to verify the new checks fail**

Run: `bash plugins/backlog/tests/add-hook.sh | grep -E 'FAIL|passed'`
Expected: the eight tag checks FAIL (tags stored as text, `list #AUTH` added as an item) and the fixture runner reports its `add`/`list` tag cases as FAIL.

- [ ] **Step 3: Implement in the hook**

In `plugins/backlog/hooks/backlog_hook.py`, replace the `META` line with:

```python
META = re.compile(r"\s\(\d{4}-\d{2}-\d{2}(, branch: [^,)]*)?(, by: claude)?(, tags: [^)]*)?\)$")
TAG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,23}$")
MAX_TAGS = 8
TAGS_FIELD = re.compile(r", tags: ([^)]*)\)$")
```

Add after `open_items`:

```python
def split_tags(text):
    """Trailing #tags off a normalised text: (text without them, tags lowercased, deduplicated, at most MAX_TAGS)."""
    words = text.split(" ")
    found = []
    while words:
        last = words[-1]
        if not last.startswith("#"):
            break
        name = last[1:].lower()
        if not TAG.match(name):
            break
        found.insert(0, name)
        words.pop()
    unique = []
    for name in found:
        if name not in unique and len(unique) < MAX_TAGS:
            unique.append(name)
    return " ".join(words).strip(), unique


def item_tags(item):
    match = TAGS_FIELD.search(item)
    if not match:
        return []
    return [t.strip() for t in match.group(1).split(",") if t.strip()]


def list_filter(text):
    """The one tag of a `list #<tag>` argument, lowercased; None for anything else."""
    match = re.match(r"^list #(.+)$", text, re.IGNORECASE)
    if not match:
        return None
    name = match.group(1).lower()
    return name if TAG.match(name) else None
```

In `add`, after the length check, insert:

```python
    text, tags = split_tags(text)
    if not text:
        raise Refused("the item has no text")
```

and in the metadata build, after the `by: claude` line, insert:

```python
        if tags:
            meta.append(f"tags: {', '.join(tags)}")
```

Change `list_items`:

```python
def list_items(root, tag=None):
    folder = os.path.join(root, ".backlog")
    check_links(folder)
    items = open_items(os.path.join(folder, "backlog.md"))
    if tag is not None:
        items = [item for item in items if tag in item_tags(item)]
    if not items:
        return "BACKLOG_LIST: Backlog is empty."
    return f"BACKLOG_LIST:\n{numbered(items)}\n{DATA_NOTE}"
```

In `handle`, replace the `if mode == "list":` branch with:

```python
        tag = list_filter(text)
        if mode == "list" or tag is not None:
            return list_items(root, tag)
```

- [ ] **Step 4: Run every suite to verify green**

Run: `bash plugins/backlog/tests/run.sh | grep -E 'FAIL|passed|ℹ (pass|fail)'`
Expected: hook suites and fixture runner all pass (the Python runner now reports 15 fixture PASS lines: the 7 earlier plus 8 tag cases of which Python runs the add and list ones), Node all pass, 0 failed anywhere.

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/hooks/backlog_hook.py plugins/backlog/tests/add-hook.sh
git commit -m "chore: parse backlog tags and the list #tag filter in the Python hook" -m "Without the mod a tagged add and a filtered list now mean the same as with it; the shared fixtures pin both." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: setTags in the store

**Files:**
- Modify: `plugins/backlog/hooks/store.js`
- Modify: `plugins/backlog/tests/mod/store.test.mjs`

**Interfaces:**
- Consumes: `edit` (internal, Task 4 of the mod plan), `META`.
- Produces: `setTags(io, root, item, tags) -> Promise<string | null>`: rewrites the `tags:` field of the open item whose full text is `item`, keeping date, branch and `by: claude`; resolves to the rewritten item text, or `null` when the line is gone or `item` carries no metadata parenthesis (nothing written then).

- [ ] **Step 1: Write the failing tests**

Append to `plugins/backlog/tests/mod/store.test.mjs`:

```js
import { setTags } from '../../hooks/store.js'

const TAGGED = '# Backlog\n\n- [ ] alpha (2026-01-01, branch: main, by: claude, tags: auth)\n  - 2026-01-02: note\n- [ ] beta (2026-01-02)\n- [ ] odd (2026-01-03, tags: )\n'

async function taggedDir() {
  const dir = await scratch(); await mkdir(join(dir, '.backlog'))
  await writeFile(join(dir, '.backlog/backlog.md'), TAGGED)
  return dir
}

test('setTags replaces the field and keeps date, branch and by: claude; sub-bullets stay', async () => {
  const dir = await taggedDir()
  const updated = await setTags(io(), dir, 'alpha (2026-01-01, branch: main, by: claude, tags: auth)', ['build', 'urgent'])
  assert.equal(updated, 'alpha (2026-01-01, branch: main, by: claude, tags: build, urgent)')
  assert.equal(await read(dir), TAGGED.replace('tags: auth)', 'tags: build, urgent)'))
})

test('setTags adds a field to an untagged item and clears it with an empty list', async () => {
  const dir = await taggedDir()
  assert.equal(await setTags(io(), dir, 'beta (2026-01-02)', ['docs']), 'beta (2026-01-02, tags: docs)')
  assert.equal(await setTags(io(), dir, 'beta (2026-01-02, tags: docs)', []), 'beta (2026-01-02)')
  assert.equal(await read(dir), TAGGED)
})

test('setTags returns null and writes nothing for a vanished line or a line without metadata', async () => {
  const dir = await taggedDir()
  assert.equal(await setTags(io(), dir, 'gamma (2026-01-09)', ['x']), null)
  assert.equal(await setTags(io(), dir, 'no metadata here', ['x']), null)
  assert.equal(await read(dir), TAGGED)
})

test('a malformed empty tags field still lists and is rewritten cleanly', async () => {
  const dir = await taggedDir()
  assert.ok((await list(io(), dir)).includes('odd (2026-01-03, tags: )'))
  assert.deepEqual(itemTags('odd (2026-01-03, tags: )'), [])
  assert.equal(await setTags(io(), dir, 'odd (2026-01-03, tags: )', ['fixed']), 'odd (2026-01-03, tags: fixed)')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E 'does not provide|ℹ (pass|fail)'`
Expected: `does not provide an export named 'setTags'`.

- [ ] **Step 3: Implement**

Append to `plugins/backlog/hooks/store.js`:

```js
// Rewrites the tags field of one open item inside the lock, keeping the rest of its metadata.
// Resolves to the new item text, or null when the line is gone or the item has no metadata.
export async function setTags(io, root, item, tags) {
  if (!META.test(item)) return null
  const base = item.replace(/, tags: [^)]*\)$/, ')')
  const updated = tags.length > 0 ? base.replace(/\)$/, `, tags: ${tags.join(', ')})`) : base
  const written = await edit(io, root, (lines) => {
    const index = lines.indexOf(`- [ ] ${item}`)
    if (index < 0) return null
    lines[index] = `- [ ] ${updated}`
    return lines
  })
  return written ? updated : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'`
Expected: all pass (4 new).

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/hooks/store.js plugins/backlog/tests/mod/store.test.mjs
git commit -m "chore: rewrite an item's tags field from the mod store" -m "The one new write tags need; it keeps date, branch and by: claude and leaves a vanished or metadata-less line alone." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Skill texts

**Files:**
- Modify: `plugins/backlog/skills/backlog/SKILL.md`
- Modify: `plugins/backlog/skills/backlog/fallback.md`
- Modify: `plugins/backlog/skills/backlog/review.md`
- Modify: `plugins/backlog/tests/run.sh` (before `echo "$passed passed, $failed failed"` in the skill budget block)

- [ ] **Step 1: Write the failing checks**

In `plugins/backlog/tests/run.sh`, after the `description=` check block and before `echo "$passed passed, $failed failed"`, add:

```bash
# Tags: the mode table names the filter, and the fallback stores the same field the hooks write.
# shellcheck disable=SC2016  # literal placeholders from the skill text
if grep -Fq '`list #<tag>`' "$SKILL_DIR/SKILL.md" && grep -Fq ', tags: ' "$SKILL_DIR/fallback.md" && grep -Fq 'the item has no text' "$SKILL_DIR/fallback.md"; then
  echo "PASS skill texts describe tags"; passed=$((passed + 1))
else
  echo "FAIL SKILL.md must list the list #<tag> mode and fallback.md must store ', tags: ' and refuse 'the item has no text'"; failed=$((failed + 1))
fi
```

- [ ] **Step 2: Run run.sh to verify the check fails**

Run: `bash plugins/backlog/tests/run.sh 2>&1 | grep -E 'skill texts|SKILL.md within|FAIL'`
Expected: `FAIL SKILL.md must list ...`; the byte budget check still passes.

- [ ] **Step 3: Edit the skill texts**

`plugins/backlog/skills/backlog/SKILL.md`, in the section 2 table, after the `Exactly \`list\`` row, add:

```markdown
| `list #<tag>` (one tag, any case) | Read `${CLAUDE_SKILL_DIR}/fallback.md`, follow its Locate the files section, then its List section with that tag |
```

In section 3, after the bullet `- Write the item text yourself, ...`, add:

```markdown
- Trailing `#tags` on the text are allowed; they are stored as tags, not text.
```

`plugins/backlog/skills/backlog/fallback.md`, in the Add section, replace step 2 with:

```markdown
2. Replace any line breaks in the item text with single spaces. Keep every other character exactly as given; do not pass the text through the shell. Then take tags off the end: every trailing token `#<name>` where `<name>`, lowercased, is 1 to 24 characters of letters, digits, `-` or `_` is a tag; stop at the first trailing token that is not. Keep at most 8 tags, in order, without duplicates. If no text remains, print `Backlog failed: the item has no text` and stop.
```

In step 5, after the `Self-initiated only` bullet, add:

```markdown
   - With tags: append `, tags: <a>, <b>` as the last field before the closing parenthesis, for example `- [ ] <text> (<date>, branch: <branch>, tags: auth, urgent)`.
```

In the List section, replace the second paragraph with:

```markdown
Read the backlog file. Print every open item (lines starting with `- [ ] `) as a numbered list starting at 1, without the `- [ ] ` prefix. With a tag (`list #<tag>`), print only the open items whose `tags:` field contains that tag in lowercase. If there are none, print `Backlog is empty.`
```

`plugins/backlog/skills/backlog/review.md`, after the first paragraph, add:

```markdown
Items may carry a `tags:` field inside their metadata; show it as stored. Tags are edited only in the mod's review pane, never here.
```

- [ ] **Step 4: Run run.sh to verify green and the budget**

Run: `bash plugins/backlog/tests/run.sh 2>&1 | grep -E 'skill texts|SKILL.md within|description within|FAIL|passed'` and `wc -c plugins/backlog/skills/backlog/SKILL.md`
Expected: PASS lines, 0 failed; SKILL.md at most 4500 bytes. If the byte count exceeds 4500, shorten the two added lines first; raise the budget only if the shortened text still exceeds it, and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/skills/backlog/SKILL.md plugins/backlog/skills/backlog/fallback.md plugins/backlog/skills/backlog/review.md plugins/backlog/tests/run.sh
git commit -m "docs: describe backlog tags in the skill, the fallback and the review procedure" -m "The fallback must write the same tags field the hooks write, so a session without hooks still stores tags." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Tagged adds and the list filter in the mod

**Files:**
- Modify: `plugins/backlog/hooks/mod.js`
- Modify: `plugins/backlog/tests/mod/events.test.mjs`

**Interfaces:**
- Consumes: `modeOf` (`'list-tag'`), `listFilter`, `list(io, root, tag)` from Tasks 1 and 2.
- Produces: `listText($, cwd, tag = null)`; `runCommand` handles `list-tag`; `callSkill` keeps answering only `add` (a `list #tag` from the Skill tool passes through).

- [ ] **Step 1: Write the failing tests**

Append to `plugins/backlog/tests/mod/events.test.mjs`:

```js
test('typed tagged add stores the tags and confirms the text without them', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  const { out } = await fire($, 'command.run', command('fix login #Auth #urgent'))
  assert.equal(out.text, 'Added to backlog: fix login')
  assert.match(await read(dir), new RegExp(`- \\[ \\] fix login \\(${TODAY}, branch: main, tags: auth, urgent\\)\\n$`))
  assert.equal((await fire($, 'command.run', command('#only'))).out.text, 'Backlog failed: the item has no text')
})

test('typed list #tag filters; an unknown tag is empty; list #a b is an add', async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  await fire($, 'command.run', command('one #auth')); await fire($, 'command.run', command('two #build'))
  assert.equal((await fire($, 'command.run', command('list #AUTH'))).out.text, `1. one (${TODAY}, branch: main, tags: auth)`)
  assert.equal((await fire($, 'command.run', command('list #docs'))).out.text, 'Backlog is empty.')
  await fire($, 'command.run', command('list #a b'))
  assert.match(await read(dir), /- \[ \] list #a b \(/)
})

test("Claude's tagged add puts tags after by: claude; list #tag from the Skill tool passes through", async () => {
  const dir = await repo(); const { $, fire } = session(dir)
  const { out } = await fire($, 'tool.call', skillCall('backlog:backlog', 'check retry #flaky'))
  assert.ok(out.context[0].startsWith('BACKLOG_ADDED: check retry\n'))
  assert.match(await read(dir), new RegExp(`- \\[ \\] check retry \\(${TODAY}, branch: main, by: claude, tags: flaky\\)\\n$`))
  assert.equal((await fire($, 'tool.call', skillCall('backlog:backlog', 'list #flaky'))).passed, true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'`
Expected: the `list #tag` test fails (`list #AUTH` is treated as an add by the mod); the tagged add tests pass already because the store does the parsing. That is expected: the store's behaviour was pinned in Task 2, and this task pins the command surface.

- [ ] **Step 3: Implement**

In `plugins/backlog/hooks/mod.js`, change `listText` and its use:

```js
async function listText($, cwd, tag = null) {
  const io = modsIo($)
  const { root } = await store.locate(io, cwd)
  if (store.rootRefused(root)) return { root, text: replyFor(INSIDE) }
  try {
    const items = await store.list(io, root, tag)
    return { root, items, text: items.length ? store.numbered(items) : 'Backlog is empty.' }
  } catch (error) {
    if (error instanceof store.Refused) return { root, text: `Backlog failed: ${error.message}` }
    throw error
  }
}
```

In `runCommand`, replace the `if (mode === 'list') {` block with:

```js
  if (mode === 'list' || mode === 'list-tag') {
    const listed = await listText($, cwd, mode === 'list-tag' ? store.listFilter(text) : null)
    await showBand($, listed.root)
    return { text: listed.text }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'`
Expected: all pass (3 new).

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/hooks/mod.js plugins/backlog/tests/mod/events.test.mjs
git commit -m "chore: answer list #tag and tagged adds from the backlog mod" -m "The command surface now matches the Python hook for every tag flow outside the pane." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Grouped, coloured pane

**Files:**
- Modify: `plugins/backlog/hooks/store.js` (`listWithOrder`)
- Modify: `plugins/backlog/hooks/mod.js`
- Modify: `plugins/backlog/types/index.d.ts`
- Modify: `plugins/backlog/tests/mod/ui.test.mjs`

**Interfaces:**
- Consumes: `itemTags`, `tagOrder`, `PALETTE` from Task 1.
- Produces: store `listWithOrder(io, root) -> Promise<{ items: string[], order: string[] }>`; mod exports `arrange(items, order) -> { tag: string | null, items: string[] }[]` and `colorOf(tag, order) -> string`; internal `loadView(io, root) -> { items (display order), order }`; `openPane($, root)` loads its own items; view state gains `order: string[]`; every path that refreshed `items` (`showBand`, `advance`) now stores display order and `order`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/backlog/tests/mod/ui.test.mjs`:

```js
import { arrange, colorOf } from '../../hooks/mod.js'
import { PALETTE } from '../../hooks/store.js'

const TAGGED3 = '# Backlog\n\n- [x] old (2026-01-01, tags: build)\n- [ ] a (2026-01-02, tags: auth, build)\n- [ ] b (2026-01-03)\n- [ ] c (2026-01-04, tags: build)\n'

test('arrange groups by first tag in tag order, untagged last, empty groups dropped', () => {
  const items = ['a (2026-01-02, tags: auth, build)', 'b (2026-01-03)', 'c (2026-01-04, tags: build)']
  assert.deepEqual(arrange(items, ['build', 'auth']), [
    { tag: 'build', items: ['c (2026-01-04, tags: build)'] },
    { tag: 'auth', items: ['a (2026-01-02, tags: auth, build)'] },
    { tag: null, items: ['b (2026-01-03)'] },
  ])
  assert.deepEqual(arrange([], ['build']), [])
  assert.equal(colorOf('auth', ['build', 'auth']), PALETTE[1])
  assert.equal(colorOf('ninth', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'ninth']), PALETTE[0])
})

test('the pane draws coloured group headings, rows in display order and tag chips', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  const tree = await pane($, fire)
  const headings = []
  find(tree, (n) => { if (n.type === 'Text' && n.bold === true && /^(#|untagged)/.test(String(n.children))) headings.push([n.children, n.color]); return false })
  assert.deepEqual(headings, [['#build', PALETTE[0]], ['#auth', PALETTE[1]], ['untagged', undefined]])
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. c (2026-01-04)' && n.bold === true), 'first row is the build item, tags field stripped')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.color === PALETTE[0] && n.bold !== true), 'tag chip beside the row')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. a (2026-01-02)'))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '3. b (2026-01-03)'))
})

test('the cursor walks rows in display order and colours stay stable after done', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'skip')
  let tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. a (2026-01-02)' && n.bold === true))
  await press(tree, 'done')
  assert.match(await read(dir), /- \[x\] a \(2026-01-02, tags: auth, build\)/)
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#auth' && n.bold !== true) === null, 'no auth chip left among open rows')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '1. c (2026-01-04)'))
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.color === PALETTE[0]), 'build keeps its colour')
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. b (2026-01-03)' && n.bold === true), 'cursor on the next row')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E 'does not provide|^✖|ℹ (pass|fail)'`
Expected: `does not provide an export named 'arrange'`.

- [ ] **Step 3: Implement**

Append to `plugins/backlog/hooks/store.js`:

```js
// The open items and the colour order from one read, for the pane.
export async function listWithOrder(io, root) {
  const folder = `${root}/.backlog`
  await checkLinks(io, folder)
  const content = (await io.read(`${folder}/backlog.md`)) ?? ''
  return { items: openItems(content), order: tagOrder(content) }
}
```

In `plugins/backlog/hooks/mod.js`:

Replace `const EMPTY_VIEW = ...` with:

```js
const EMPTY_VIEW = { root: null, items: [], order: [], bandUntil: 0, pane: null }
```

Add after `setView`:

```js
// Open items in display order: one group per tag in `order`, each item under its first tag,
// untagged items last; empty groups are dropped. Exported for tests.
export function arrange(items, order) {
  const groups = order.map((tag) => ({ tag, items: [] }))
  const untagged = { tag: null, items: [] }
  for (const item of items) {
    const first = store.itemTags(item)[0]
    const group = first === undefined ? undefined : groups.find((g) => g.tag === first)
    ;(group ?? untagged).items.push(item)
  }
  return [...groups, untagged].filter((g) => g.items.length > 0)
}

export function colorOf(tag, order) {
  const index = Math.max(order.indexOf(tag), 0)
  return store.PALETTE[index % store.PALETTE.length]
}

const withoutTagsField = (item) => item.replace(/, tags: [^)]*\)$/, ')')

// The view's items (display order) and tag order from a fresh read.
async function loadView(io, root) {
  const { items, order } = await store.listWithOrder(io, root)
  return { items: arrange(items, order).flatMap((g) => g.items), order }
}
```

Replace `showBand` with:

```js
async function showBand($, root) {
  let loaded = { items: [], order: [] }
  try { loaded = await loadView(modsIo($), root) } catch { /* the refusal was already reported */ }
  // An open pane keeps its cursor, clamped to the fresh list; an emptied list ends the review.
  const before = await getView($)
  const pane = before.pane && loaded.items.length > 0 ? { ...before.pane, index: Math.min(before.pane.index, loaded.items.length - 1) } : null
  await setView($, (current) => ({ ...current, root, ...loaded, bandUntil: Date.now() + BAND_MS, pane }))
  if (before.pane !== null && pane === null) {
    await $.ui.close({ id: PANE })
    $.ui.toast(`Review done: ${before.pane.done} done, ${before.pane.skipped} skipped, ${before.pane.notes} notes`)
  }
  $.ui.invalidate('ui.render')
  $.clock.after(BAND_MS + 100, () => $.ui.invalidate('ui.render'))
}
```

In `renderBand`, change the button to `onPress: () => openPane($, view.root)`.

Replace `openPane` with:

```js
async function openPane($, root) {
  const loaded = await loadView(modsIo($), root)
  await setView($, (view) => ({ ...view, root, ...loaded, pane: { index: 0, noteFor: null, done: 0, skipped: 0, notes: 0 } }))
  await $.ui.open({ id: PANE, title: 'Backlog review', focus: true, closeOnEscape: true })
}
```

In `advance`, replace the two lines `let items = view.items` and `try { items = await store.list(...) } catch {...}` with:

```js
  let loaded = { items: view.items, order: view.order }
  try { loaded = await loadView(modsIo($), view.root) } catch { /* keep what was shown */ }
  const items = loaded.items
```

and both `setView` calls in `advance` spread `...loaded` instead of `items`: `({ ...v, ...loaded, pane: null })` and `({ ...v, ...loaded, pane })`.

In `runCommand`'s review branch, replace `await openPane($, listed.root, listed.items)` with `await openPane($, listed.root)`.

In `renderPane`, replace the `const rows = ...` statement with:

```js
  const groups = arrange(view.items, view.order)
  const rows = []
  let position = 0
  for (const group of groups) {
    rows.push(group.tag === null
      ? Text({ bold: true, dimColor: true, children: 'untagged' })
      : Text({ bold: true, color: colorOf(group.tag, view.order), children: `#${group.tag}` }))
    for (const item of group.items) {
      const index = position++
      rows.push(Box({ gap: 1, children: [
        Text({ bold: index === pane.index, dimColor: index < pane.index, wrap: 'truncate', children: `${index + 1}. ${withoutTagsField(item)}` }),
        ...store.itemTags(item).map((tag) => Text({ color: colorOf(tag, view.order), children: `#${tag}` })),
      ] }))
    }
  }
```

`plugins/backlog/types/index.d.ts`: add `order: string[]` to `View` after `items`.

- [ ] **Step 4: Run the tests and validate**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'` and `claude plugin validate plugins/backlog 2>&1 | grep -E '^✔|^✘|error'`
Expected: all pass (3 new, every earlier pane test still green because untagged files arrange into one `untagged` group in file order); validation passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/hooks/store.js plugins/backlog/hooks/mod.js plugins/backlog/types/index.d.ts plugins/backlog/tests/mod/ui.test.mjs
git commit -m "chore: group the backlog review pane by tag with one colour per tag" -m "Colour follows the tag's first appearance in the file, so it survives reloads and closed items keep it fixed." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The t key

**Files:**
- Modify: `plugins/backlog/hooks/mod.js`
- Modify: `plugins/backlog/types/index.d.ts`
- Modify: `plugins/backlog/tests/mod/ui.test.mjs`

**Interfaces:**
- Consumes: `setTags`, `parseTagInput`, `itemTags` from the store; `loadView` from Task 7.
- Produces: `pane.tagsFor: string | null`; `tagsAction($, value)`, `refreshPane($, keep)` (internal); the `t` button and its input; help lines naming `t`.

- [ ] **Step 1: Write the failing tests and update the help-line expectation**

In `plugins/backlog/tests/mod/ui.test.mjs`, in the test `the pane names its keys`, change the first help regex to `/d done, s skip, n note, t tags, q close\. Tab moves, Enter presses, Esc returns to the prompt\./`.

Append:

```js
test('t shows an input with the current tags; submitting moves the item and keeps the cursor on it', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  let tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Button' && n.key === 'tags' && n.hotkey === 't' && n.plain === true))
  assert.ok(find(tree, (n) => n.type === 'Text' && /t tags/.test(String(n.children))))
  await press(tree, 'tags')
  tree = await pane($, fire)
  const input = find(tree, (n) => n.type === 'Input' && n.key === 'tags')
  assert.equal(input.value, 'build')
  assert.ok(find(tree, (n) => n.type === 'Text' && /Enter replaces the tags, empty Enter clears them, Esc returns to the prompt\./.test(String(n.children))))
  await input.onSubmit('auth bad! #Auth')
  assert.deepEqual($.log.toasts, ['Ignored tag: bad!', 'Tagged: c'])
  assert.match(await read(dir), /- \[ \] c \(2026-01-04, tags: auth\)\n/)
  tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '2. c (2026-01-04)' && n.bold === true), 'cursor follows the item into the auth group')
  assert.equal(find(tree, (n) => n.type === 'Text' && n.children === '#build' && n.bold === true), null, 'build group is gone')
  assert.ok(find(tree, (n) => n.type === 'Button' && n.key === 'done'), 'buttons are back')
})

test('an empty tag submission clears the tags and moves the item to untagged', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'tags')
  await find(await pane($, fire), (n) => n.type === 'Input').onSubmit('')
  assert.match(await read(dir), /- \[ \] c \(2026-01-04\)\n/)
  const tree = await pane($, fire)
  assert.ok(find(tree, (n) => n.type === 'Text' && n.children === '3. c (2026-01-04)' && n.bold === true))
})

test('t on a line that vanished reports it and keeps the pane open', async () => {
  const dir = await repo(TAGGED3); const { $, fire } = session(dir)
  await fire($, 'command.run', command('review'))
  await press(await pane($, fire), 'tags')
  await writeFile(join(dir, '.backlog/backlog.md'), '# Backlog\n\n- [ ] b (2026-01-03)\n')
  await find(await pane($, fire), (n) => n.type === 'Input').onSubmit('x')
  assert.deepEqual($.log.toasts, ['Backlog item changed on disk: c'])
  assert.deepEqual($.log.closed, [])
  assert.ok(find(await pane($, fire), (n) => n.type === 'Text' && n.children === '1. b (2026-01-03)' && n.bold === true))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'`
Expected: the key-names test and the three new tests fail (no `tags` button, old help text).

- [ ] **Step 3: Implement**

In `plugins/backlog/hooks/mod.js`:

In `openPane`, the initial pane becomes `{ index: 0, noteFor: null, tagsFor: null, done: 0, skipped: 0, notes: 0 }`. In `advance`, the computed `pane` gains `tagsFor: null` beside `noteFor: null`.

Add after `noteAction`:

```js
// Re-reads the list and keeps the cursor on `keep` at its new position, else clamps the old index.
async function refreshPane($, keep) {
  const view = await getView($)
  if (view.pane === null) return
  let loaded = { items: view.items, order: view.order }
  try { loaded = await loadView(modsIo($), view.root) } catch { /* keep what was shown */ }
  if (loaded.items.length === 0) {
    await setView($, (v) => ({ ...v, ...loaded, pane: null }))
    await $.ui.close({ id: PANE })
    $.ui.toast(`Review done: ${view.pane.done} done, ${view.pane.skipped} skipped, ${view.pane.notes} notes`)
    return
  }
  const found = keep === null ? -1 : loaded.items.indexOf(keep)
  const index = found >= 0 ? found : Math.min(view.pane.index, loaded.items.length - 1)
  await setView($, (v) => ({ ...v, ...loaded, pane: { ...v.pane, noteFor: null, tagsFor: null, index } }))
}

async function tagsAction($, value) {
  const view = await getView($)
  if (view.pane === null || view.pane.tagsFor === null) return
  const item = view.pane.tagsFor
  const { tags, ignored } = store.parseTagInput(value)
  for (const token of ignored) $.ui.toast(`Ignored tag: ${token}`)
  try {
    const updated = await store.setTags(modsIo($), view.root, item, tags)
    if (updated === null) {
      $.ui.toast(`Backlog item changed on disk: ${store.stripMeta(item)}`)
      await refreshPane($, null)
      return
    }
    $.ui.toast(`Tagged: ${store.stripMeta(item)}`)
    await refreshPane($, updated)
  } catch (error) {
    if (!(error instanceof store.Refused)) throw error
    $.ui.toast(`Backlog failed: ${error.message}`)
    await refreshPane($, item)
  }
}
```

In `renderPane`, replace from `const noting = ...` through the `const help = ...` statement with:

```js
  const noting = pane.noteFor !== null
  const tagging = !noting && pane.tagsFor !== null
  let controls
  if (noting) {
    controls = [Input({ key: 'note', label: 'Note', placeholder: 'empty cancels', autoFocus: true, onSubmit: (value) => noteAction($, value) })]
  } else if (tagging) {
    controls = [Input({ key: 'tags', label: 'Tags', value: store.itemTags(pane.tagsFor).join(' '), placeholder: 'space separated, empty clears', autoFocus: true, onSubmit: (value) => tagsAction($, value) })]
  } else {
    controls = [
      Button({ key: 'done', label: 'done', hotkey: 'd', plain: true, onPress: () => doneAction($) }),
      Button({ key: 'skip', label: 'skip', hotkey: 's', plain: true, onPress: () => advance($, 'skipped', false) }),
      Button({ key: 'note', label: 'note', hotkey: 'n', plain: true, onPress: () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, noteFor: v.items[v.pane.index] ?? null } })) }),
      Button({ key: 'tags', label: 'tags', hotkey: 't', plain: true, onPress: () => setView($, (v) => ({ ...v, pane: v.pane && { ...v.pane, tagsFor: v.items[v.pane.index] ?? null } })) }),
      Button({ key: 'close', label: 'close', hotkey: 'q', plain: true, onPress: () => $.ui.close({ id: PANE }) }),
    ]
  }
  const help = noting
    ? 'Enter saves the note, empty Enter cancels, Esc returns to the prompt.'
    : tagging
      ? 'Enter replaces the tags, empty Enter clears them, Esc returns to the prompt.'
      : 'Keys: d done, s skip, n note, t tags, q close. Tab moves, Enter presses, Esc returns to the prompt.'
```

`plugins/backlog/types/index.d.ts`: add `tagsFor: string | null` to `ReviewPane` after `noteFor`.

- [ ] **Step 4: Run the tests and validate**

Run: `cd plugins/backlog && node --test 'tests/mod/*.test.mjs' 2>&1 | grep -E '^✖|ℹ (pass|fail)'` and `claude plugin validate plugins/backlog 2>&1 | grep -E '^✔|^✘|error'`
Expected: all pass; validation passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/hooks/mod.js plugins/backlog/types/index.d.ts plugins/backlog/tests/mod/ui.test.mjs
git commit -m "chore: edit an item's tags from the backlog review pane with t" -m "The cursor follows the item into its new group; an invalid token is named and dropped rather than refused." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Scenarios, documentation and version

**Files:**
- Modify: `plugins/backlog/tests/e2e.sh` (scenarios before `ALL=`, and the `ALL` line)
- Modify: `plugins/backlog/tests/scenarios.md` (rows after S33)
- Modify: `plugins/backlog/README.md`
- Modify: `plugins/backlog/.claude-plugin/plugin.json`

- [ ] **Step 1: Add the scenarios**

In `plugins/backlog/tests/e2e.sh`, before `ALL=(`:

```bash
# --- Tags ---

S34() {
  new_repo "$WORK/s34"
  out=$(backlog_json "/backlog tagged item #Auth #urgent")
  check "tagged add starts no model turn" [ "$(jq -r '.num_turns' <<<"$out")" = "0" ]
  check "text confirmed without tags" contains "$(jq -r '.result' <<<"$out")" "Added to backlog: tagged item"
  check "tags stored" has_line .backlog/backlog.md "- [ ] tagged item ($TODAY, branch: main, tags: auth, urgent)"
}

S35() {
  new_repo "$WORK/s35"
  mkdir .backlog && printf '# Backlog\n\n- [ ] a (2026-01-01, tags: auth)\n- [ ] b (2026-01-02)\n' >.backlog/backlog.md
  out=$(backlog_json "/backlog list #auth")
  check "filtered list starts no model turn" [ "$(jq -r '.num_turns' <<<"$out")" = "0" ]
  check "matching item listed" contains "$(jq -r '.result' <<<"$out")" "1. a (2026-01-01, tags: auth)"
  check "other item absent" lacks "$(jq -r '.result' <<<"$out")" "b (2026-01-02)"
}

# Hooks disabled: the skill's fallback must store the same tags field.
S36() {
  new_repo "$WORK/s36"
  backlog "/backlog fallback tagged #ops" --settings '{"disableAllHooks": true}' \
    --allowedTools "Read" "Write" "Edit" "Bash(git rev-parse --show-toplevel)" "Bash(git branch --show-current)" "Bash(date +%F)" >/dev/null
  check "fallback stores the tags field" has_line .backlog/backlog.md "- [ ] fallback tagged ($TODAY, branch: main, tags: ops)"
}
```

Append `S34 S35 S36` to the `ALL=(...)` array.

In `plugins/backlog/tests/scenarios.md`, after the S33 row:

```markdown
| S34 | e2e | Git repo, mod loaded | `/backlog tagged item #Auth #urgent` | No model turn; `Added to backlog: tagged item`; line ends `tags: auth, urgent)` |
| S35 | e2e | Mod loaded, one tagged and one untagged item | `/backlog list #auth` | No model turn; only the tagged item is listed |
| S36 | e2e | Hooks disabled, fallback tools approved | `/backlog fallback tagged #ops` | The skill's fallback stores `, tags: ops` |
| S37 | manual | Interactive terminal, items with two tags and one without | `/backlog review`; `t`, type `docs`, Enter | Pane shows one heading per tag in its own colour, untagged last; the item moves under `#docs` with the cursor on it; `list #docs` then shows it |
```

- [ ] **Step 2: Run the new scenarios and the exposed ones**

Run: `shellcheck plugins/backlog/tests/e2e.sh` and `MODEL=haiku bash plugins/backlog/tests/e2e.sh S34 S35 S36 S21 S27 S29 S30`
Expected: every check `ok`. S36 depends on the model following `fallback.md`; if it fails on Haiku, rerun it with `MODEL=sonnet` and record which model passed in the commit body.

- [ ] **Step 3: README and version**

`plugins/backlog/README.md`, Usage table: change the first row's action to `Add an item, confirm in one line, resume the current task. Trailing \`#tags\` (letters, digits, \`-\`, \`_\`, up to 8) are stored as tags.` and add after the `/backlog list` row:

```markdown
| `/backlog list #<tag>` | Show only the open items carrying that tag. |
```

Item format block: add a third example line `- [ ] fix login (2026-10-05, branch: main, tags: auth, urgent)` and the bullet `- Tags are lowercase names inside the metadata; two items that differ only by their tags are duplicates.`

Mod section: after the review bullet, add:

```markdown
- The pane groups items by their first tag, one heading per tag in its own colour (stable while the tag exists in the file), untagged items last. `t` edits the current item's tags: space or comma separated, `#` optional, empty clears; invalid names are named in a toast and dropped.
```

`plugins/backlog/.claude-plugin/plugin.json`: `"version": "0.4.0"`.

- [ ] **Step 4: Full verification**

Run, from the repository root:

```bash
find . -name '*.sh' -not -path './.git/*' -print0 | xargs -0 shellcheck
bash tests/validate.sh
bash tests/unit.sh
claude plugin validate plugins/backlog
```

Expected: ShellCheck clean; validate passes; every unit suite passes with 0 failed; plugin validation passes.

- [ ] **Step 5: Commit**

```bash
git add plugins/backlog/tests/e2e.sh plugins/backlog/tests/scenarios.md plugins/backlog/README.md plugins/backlog/.claude-plugin/plugin.json
git commit -m "docs: describe backlog tags and release 0.4.0" -m "Scenarios pin the typed tag flows headless and the fallback parity; the pane is a manual scenario." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

After PR #10 merges: rebase `feat/backlog-tags` onto `main`, open the PR, and after its squash merge tag `backlog-v0.4.0` and publish a release, per the root README.
