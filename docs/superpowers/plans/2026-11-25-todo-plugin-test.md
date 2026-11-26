# todo: mod tests on `claude plugin test` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the todo mod's event and UI tests against the real engine with `claude plugin test`, and delete the hand-rolled fake of the mods API (`tests/mod/fake-dollar.mjs`).

**Architecture:** Hybrid. Tests that drive the mod through hooks (`events.test.mjs`, `ui.test.mjs`) move to `tests/kit/*.test.ts` and run on the engine's test kit, where the engine dispatches events, checks every rendered tree against the surface's element table, and holds `$.state` to the type contract. The kit has no Node and nothing beneath the plugin, so one helper, `tests/kit/host.ts`, answers the filesystem, git and UI calls from memory. Tests of `store.js` over real files and real git, and tests of the mod's pure exports, stay on Bun.

**Tech Stack:** `claude plugin test` and `claude-code/testing` (Claude Code 2.1.331, pinned per mise task), TypeScript for kit tests, Bun for the remaining `.mjs` tests.

**Spec:** None written. This plan argues from the tests it ports (`plugins/todo/tests/mod/events.test.mjs`, `ui.test.mjs`, `fake-dollar.mjs`) and from the kit's declaration, `declare module 'claude-code/testing'` in the engine's types file. Executors read both. To get the types file: start `claude --plugin-dir plugins/todo` once in a terminal, which lays `plugins/todo/.claude-plugin/types/claude-code/index.d.ts` and `plugins/todo/tsconfig.json` (both already gitignored).

## Global Constraints

- The mods API is early access and moves between releases. Run kit tests through `mise run test`, which pins `tools.claude = "2.1.331"`; a developer's own `claude` may be older.
- No change to `plugins/todo/hooks/*.js`. This plan changes tests only. A mod defect a ported test exposes is recorded, not fixed here.
- Test titles are copied verbatim from the old files, so coverage can be compared by title.
- Kit test files import only from `claude-code/testing`, `claude-code` (types) and `./host`. They do not import the mod's files: the engine loads the mod.
- Kit tests live in `tests/kit/`, Bun tests in `tests/mod/`. Neither runner may see the other's files.
- `mise run check` must pass with no Claude login (CI has none).
- Work on a feature branch. Do not push to `main`.

## What moves where

| Today | After |
| --- | --- |
| `tests/mod/events.test.mjs` (40 tests) | 36 hook-driven tests → `tests/kit/events.test.ts`; 4 pure tests → `tests/mod/pure.test.mjs` |
| `tests/mod/ui.test.mjs` (30 tests) | 27 hook-driven tests → `tests/kit/ui.test.ts`; 3 pure tests → `tests/mod/pure.test.mjs` |
| `tests/mod/fake-dollar.mjs` | deleted; `tests/kit/host.ts` answers the same calls beneath the real engine |
| `tests/mod/store.test.mjs`, `fixtures.test.mjs`, `node-io.mjs` | unchanged, on Bun |

Pure tests (they call exported functions and never register hooks): `replyFor maps markers to the three replies`, `contextFor carries the marker, the reply and the data note`, `tagSuggestions completes a #prefix after /todo only`, `replyFor maps TODO_DONE to Done`, `arrange groups by first tag in tag order, untagged last, empty groups dropped`, `itemMeta, listEntries and windowOf`, `listEntries adds worktree headings in the main checkout only`.

What the port trades: the old tests ran the mod over a real temporary git repository. Kit tests run it over `host.ts`'s invented git output. Real git stays covered by the `locate` tests in `store.test.mjs` (lines 46–60 and 328–335), which this plan does not touch.

## Review Focus

1. **A missing file.** `$.fs.read` of a path the host does not hold must reject, as the real call does, so the mod reads it as "no list yet". Expected: `list` answers `Todo list is empty.` and the test passes. Pinned in Task 1.
2. **Module state between tests.** `mod.js` keeps `capture`, `warned` and `turnAdds` in module variables, and kit tests cannot call `resetCapture()`. Expected: a pending capture in one test does not swallow the next test's prompt. Pinned in Task 1.
3. **No login.** Expected: `claude plugin test` passes with an empty `HOME`. Pinned in Task 1.
4. **Runner separation.** Expected: `bun test tests/mod/` never loads `tests/kit/*.test.ts`. Pinned in Task 1.
5. **Invented git output drifting from real git.** Expected: `host.ts` prints exactly the three lines `store.js:165` parses, and the real-git `locate` tests still run. Pinned in Task 1 (host contract) and Task 4 (title check keeps the `locate` tests).
6. **A second surface.** The old tests drew on `terminal` only. Expected: each pane and band test also passes on `desktop`, or says why not. Pinned in Task 3.

---

### Task 1: `host.ts`, four tests, and the runner

**Files:**
- Create: `plugins/todo/tests/kit/host.ts`
- Create: `plugins/todo/tests/kit/events.test.ts`
- Modify: `plugins/todo/tests/run.sh` (the block after the shell checks, currently "The mod's tests run under Bun")

**Interfaces:**
- Produces, for Tasks 2 and 3:

```ts
// plugins/todo/tests/kit/host.ts
import type { On } from 'claude-code'
import type { MockClock } from 'claude-code/testing'

export const TODAY: string                    // local YYYY-MM-DD, as hooks/io.js localDate formats it
export const ROOT = '/repo'                   // the default repository root

export type HostGit = {
  top: string                                 // work tree root git reports
  main?: string                               // main checkout; default: top
  branch?: string | null                      // default 'main'; null is a detached HEAD
  worktrees?: string[]                        // absolute paths of linked worktrees
}
export type HostOptions = {
  cwd?: string                                // $.session.cwd(); default ROOT
  git?: HostGit | null                        // default { top: ROOT }; null: not a repository
  files?: Record<string, string>              // absolute path → text
  links?: string[]                            // paths fs.stat reports with isLink: true
  surfaces?: ('terminal' | 'desktop' | 'vscode' | 'mobile')[]   // default ['terminal']
  toolCheck?: 'allow' | 'deny'                // default 'allow'
  refuseRegister?: boolean                    // leave command.register unanswered
  core?: Record<string, (e: any) => unknown>  // override the engine's answer for an event
}
export type Host = {
  files: Map<string, string>
  toasts: string[]
  opened: { id: string }[]
  closed: string[]
  registered: { name: string }[]
  reachedCore: string[]                       // events the mod passed on with next(e), in order
  clock: MockClock
}
export function host(on: On, options?: HostOptions): Host
export const todoFile: (root?: string) => string   // `${root}/.todo/todo.md`
export const typed: (args: string, command?: string) => object   // a composer-origin command.run input; command defaults to 'todo:capture'
```

- [ ] **Step 1: Write `events.test.ts` with the four tests (failing: no `host.ts`)**

```ts
import { expect, test } from 'claude-code/testing'
import { host, typed, todoFile, TODAY } from './host'

test('typed add writes the line, toasts and answers without reaching core', async ($, on) => {
  const h = host(on)
  const out = await $.command.run(typed('  add tests\nfor parser  '))
  expect(out.text).toBe('Added to todo list: add tests for parser')
  expect(h.reachedCore).toEqual([])
  expect(h.toasts).toEqual(['Added to todo list: add tests for parser'])
  expect(h.files.get(todoFile())).toMatch(new RegExp(`- \\[ \\] add tests for parser \\(${TODAY}, branch: main\\)\\n$`))
})

test('typed list answers the numbered items or the empty line', async ($, on) => {
  host(on)                                    // holds no todo file: fs.read must reject
  expect((await $.command.run(typed('list'))).text).toBe('Todo list is empty.')
  await $.command.run(typed('one')); await $.command.run(typed('two'))
  expect((await $.command.run(typed('LIST'))).text).toBe(`1. one (${TODAY}, branch: main)\n2. two (${TODAY}, branch: main)`)
})

test('headless bare /todo asks, then the next prompt is captured and dropped', async ($, on) => {
  // events.test.mjs:125-134, by the rules in Task 2, with host(on, { surfaces: [] })
})

test('without a pending capture prompts pass through', async ($, on) => {
  const h = host(on)
  await $.prompt.submit(prompt('hello'))      // prompt(): the helper at the top of events.test.mjs, copied
  expect(h.reachedCore).toEqual(['prompt.submit'])
})

// Review Focus 2. The old tests called resetCapture(); kit tests cannot. Keep these two adjacent and in this order.
test('module state: a bare /todo leaves a capture pending', async ($, on) => {
  host(on, { surfaces: [] })
  expect((await $.command.run(typed(''))).text).toBe('What should go on the todo list?')
})

test('module state: the next test sees no pending capture', async ($, on) => {
  const h = host(on, { surfaces: [] })
  await $.prompt.submit(prompt('hello'))
  expect(h.reachedCore).toEqual(['prompt.submit'])
})
```

- [ ] **Step 2: Wire the runner**

In `plugins/todo/tests/run.sh`, after the Bun block and before the final `[ "$failed" -eq 0 ]`:

```bash
# The hook-driven tests run on the engine's own kit (tests/kit/*.test.ts).
echo
if command -v claude >/dev/null 2>&1 && claude plugin test --help >/dev/null 2>&1; then
  claude plugin test "$ROOT" || failed=$((failed + 1))
else
  echo "SKIP kit tests: claude plugin test not available"
fi
```

Change the comment above the Bun block to say Bun runs the store and pure tests.

- [ ] **Step 3: Run and see it fail**

Run: `mise run test`
Expected: the todo suite FAILS in the kit section, `./host` cannot be resolved. The Bun section still passes.

- [ ] **Step 4: Write `host.ts`**

`host(on, options)` registers one test hook per event below and calls `mock.clock(on)` for `Host.clock`. In the kit a call on `$` is answered `{ value }` and an event by its own result; for each event, the `ResultOf` entry in the types file is the authority.

| Event | Answer |
| --- | --- |
| `session.cwd`, `session.surfaces` | the option's value |
| `fs.read` | the text when `files` holds the path; otherwise `next(e)`, so the kit's bottom rejects the call |
| `fs.write` | sets `files` |
| `fs.stat` | `{ kind: 'file', isLink, mtimeMs: 0, realPath: path }` for a held file; `kind: 'dir'` for a prefix of a held path or a held lock; otherwise `next(e)`. `isLink` is true for a path in `links`, whatever its kind |
| `process.run` with `git … rev-parse` | not a repository: `exitCode: 128`, empty `stdout`. Otherwise `stdout` is three lines: `top`, `${main}/.git`, and the HEAD path: `${main}/.git/HEAD` when `top === main`, else `${main}/.git/worktrees/${basename(top)}/HEAD`. `host` seeds that HEAD path in `files` with `ref: refs/heads/${branch}\n`, or a bare hash for `branch: null` |
| `process.run` with `git … worktree list --porcelain` | blocks `worktree <path>\nHEAD 0\nbranch refs/heads/<basename>`, main checkout first, separated by a blank line |
| `process.run` with `mkdir <lock>` / `rmdir <lock>` | `exitCode` 0 and the lock taken or released; `mkdir` on a held lock answers `exitCode: 1` |
| any other `process.run` | `next(e)` |
| `tool.check` | the option's decision |
| `command.register` | records the spec and answers its name; with `refuseRegister`, `next(e)` |
| `ui.toast`, `ui.open`, `ui.close` | record; `ui.open` answers `{ isPlaced: true }` |
| `session.start`, `command.run`, `prompt.submit`, `prompt.autocomplete`, `tool.call`, `turn.start`, `turn.complete` | the engine's stand-in: push the event name to `reachedCore`, then answer `options.core[event](e)` when given, else the event's empty result (`command.run`: `{ text: 'core' }`; `tool.call`: `{ result: {} }`; `session.start`: `{ cwd: e.cwd }`) |

Every `process.run` answer carries all `ProcessRunResult` fields. `ui.render`, `ui.invalidate` and `state.*` are left to the kit's own bottom.

- [ ] **Step 5: Run and see it pass**

Run: `mise run test`
Expected: PASS; the kit section reports 6 tests.

If `list` on a missing file fails the test instead of answering `Todo list is empty.`, change the `fs.read` and `fs.stat` fall-through from `next(e)` to `throw new Error('ENOENT')` and run again. If both forms fail the test, stop and report the kit's failure text: the port is blocked on how a test hook rejects a call.

If the module-state pair fails, move every test that leaves a capture pending into its own file, `tests/kit/capture-<n>.test.ts`, one test per file (each file runs in its own process), and note it at the top of `events.test.ts`.

- [ ] **Step 6: Prove the tests can fail**

In `plugins/todo/hooks/mod.js`, change `'Added to todo list: '` in `replyFor` to `'X: '`. Run `mise run test`. Expected: the first test FAILS on `out.text`. Revert the change with `git checkout plugins/todo/hooks/mod.js`.

- [ ] **Step 7: Verify separation and the no-login run**

Run: `mise exec -- bun test plugins/todo/tests/mod/ 2>&1 | grep -c 'tests/kit'`
Expected: `0`. Bun is given the `tests/mod/` path and loads nothing from `tests/kit/`.

Run: `CLAUDE_CONFIG_DIR="$(mktemp -d)" mise run test`
Expected: PASS with no login prompt: an empty config directory holds no credentials. If the kit asks for a login, stop and report: CI cannot run it, and the runner's SKIP branch has to cover CI.

- [ ] **Step 8: Commit**

```bash
git add plugins/todo/tests/kit plugins/todo/tests/run.sh
git commit -m "test(todo): first mod tests on claude plugin test"
```

---

### Task 2: Port the remaining event tests

**Files:**
- Modify: `plugins/todo/tests/kit/events.test.ts`
- Read: `plugins/todo/tests/mod/events.test.mjs`

**Interfaces:**
- Consumes: everything `host.ts` exports (Task 1).

- [ ] **Step 1: Port the 32 remaining hook-driven tests**

Every test in `events.test.mjs` except the four pure ones and the four already ported. Keep each title and each asserted value. Translate by these rules:

| Old | Kit |
| --- | --- |
| `const dir = await repo(); session(dir, options)` | `const h = host(on, options)`; paths use `ROOT` |
| `fire($, 'command.run', command(args))` | `await $.command.run(typed(args))` |
| `fire($, '<event>', e)` | `await $.<noun>.<verb>(e)`, same input; copy the old file's `prompt()` and other input helpers |
| `passed === true` / `false` | `h.reachedCore` contains / does not contain the event |
| `out.<field>` | the call's result |
| `$.log.toasts`, `.opened`, `.closed`, `.registered` | `h.toasts`, `h.opened`, `h.closed`, `h.registered` |
| `await read(dir)` | `h.files.get(todoFile())` |
| a symlinked `.todo/todo.md` | `links: [todoFile()]`, and the expected text names `/repo/.todo/todo.md` |
| `session(join(dir, '.git'))` | `host(on, { cwd: '/repo/.git', git: null })` |
| a real linked worktree `wt` | `host(on, { cwd: '/repo/.claude/worktrees/wt', git: { top: '/repo/.claude/worktrees/wt', main: ROOT, branch: 'wt', worktrees: ['/repo/.claude/worktrees/wt'] } })` |
| `toolCheck: { decision: 'deny' }` | `toolCheck: 'deny'` |
| `registerThrows: true` | `refuseRegister: true` |
| the `core` argument of `fire` | `core: { '<event>': () => (…) }` |
| `fire($, 'tool.call', { tool: 'Skill', … })` | `await $.tool.call({ tool: 'Skill', … })` |

- [ ] **Step 2: Run**

Run: `mise run test`
Expected: PASS; the kit section reports 38 tests in `events.test.ts` (36 ported titles plus the two module-state tests).

A test that fails because the engine refuses something the fake allowed (a result of the wrong shape, a rewrite of a pinned field) has found a mod defect. Do not edit `mod.js`. Mark the test with `// engine refuses: <text of the refusal>`, make it assert the refusal, record the defect with the `todo:capture` skill, and list it in the task's report.

- [ ] **Step 3: Prove the new tests can fail**

In `mod.js`, change `'Already on todo list: '` to `'X: '`. Run `mise run test`. Expected: `typed duplicate and refusal answer with their lines` FAILS. Revert with `git checkout plugins/todo/hooks/mod.js`.

- [ ] **Step 4: Commit**

```bash
git add plugins/todo/tests/kit/events.test.ts
git commit -m "test(todo): port the mod's event tests to the engine kit"
```

---

### Task 3: Port the UI tests

**Files:**
- Create: `plugins/todo/tests/kit/ui.test.ts`
- Read: `plugins/todo/tests/mod/ui.test.mjs`

**Interfaces:**
- Consumes: `host.ts` (Task 1). Mount targets:

```ts
const SURFACES = ['terminal', 'desktop'] as const
const BAND = { plugin: 'todo', component: 'AbovePrompt', props: {} } as const
const PANE = {
  plugin: 'todo', component: 'Pane', requestId: 'todo-review',
  props: { title: 'Todo', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const CAPTURE = { ...PANE, requestId: 'todo-capture' } as const
```

- [ ] **Step 1: Port the 27 hook-driven tests**

Every test in `ui.test.mjs` except the three pure ones, titles and asserted values kept. A test registers its hooks before its first call on `$`, so each surface gets its own test, declared through one helper at the top of the file:

```ts
// TestBody is imported as a type from 'claude-code/testing'
type Body = (surface: (typeof SURFACES)[number], ...kit: Parameters<TestBody>) => unknown
const each = (title: string, body: Body) => {
  for (const surface of SURFACES) test(`${title} [${surface}]`, ($, on) => body(surface, $, on))
}

each('band is hidden before any todo call', async (surface, $, on) => {
  host(on, { surfaces: [surface], files: { [todoFile()]: TWO } })
  const ui = await $.ui.mount({ ...BAND, surface })
  expect(await ui.find({ type: 'Text', text: /^Todo:/ })).toBeUndefined()
  await ui.unmount()
})
```

Every ported test starts with `each('<old title>', …` at column 0, which Task 4's title check relies on.

| Old | Kit |
| --- | --- |
| `fire($, 'ui.render', band)` and `passed === true` (band hidden) | `const ui = await $.ui.mount({ ...BAND, surface })`; `expect(await ui.find({ type: 'Text', text: /^Todo:/ })).toBeUndefined()` |
| `find(out, (n) => n.type === 'Text' && n.children === 'Todo: 3 open')` | `expect((await ui.find({ type: 'Text', text: 'Todo: 3 open' }))?.text).toBe('Todo: 3 open')` |
| `pane($, fire, props)` | `await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, ...props } })` |
| `press(tree, key)` | `await ui.press({ key })` |
| calling an Input's `onSubmit` / `onInput` | `await ui.input({ key, text })` / `await ui.input({ key, text, kind: 'change' })` |
| re-rendering to see a change | nothing: the handle follows the mod's `$.ui.invalidate`; read with `ui.find` again |
| a redraw with other props (narrow pane, unfocused) | `await ui.redraw({ ...PANE.props, bodyColumns: 40 })` |
| `$.log.timers.some((t) => t.ms > 10000 && t.ms < 11000)` | set the view's `bandUntil` into the past through `$.state.set`, check the band is still drawn, `await h.clock.advance(10_100)`, check it is gone |
| `$.state.get/set({ plugin: 'todo', key: 'view' }, …)` | the same calls on the test's `$` |
| `fire($, 'ui.close', { id })` | `await $.ui.close({ id })` |

End every test with `await ui.unmount()`.

- [ ] **Step 2: Run**

Run: `mise run test`
Expected: PASS; `ui.test.ts` reports 54 tests, each of the 27 titles on both surfaces.

A test that passes on `terminal` and fails on `desktop` because the surface refuses the mod's tree is a mod defect on that surface. Handle it as Task 2 Step 2 says, and keep the terminal half asserting the old values.

- [ ] **Step 3: Prove the new tests can fail**

In `mod.js`, change `BAND_MS = 10000` to `BAND_MS = 60000`. Run `mise run test`. Expected: `band shows the open count after an add, with a 10 s timer` FAILS (the band is still drawn after `advance(10_100)`). Revert with `git checkout plugins/todo/hooks/mod.js`.

- [ ] **Step 4: Commit**

```bash
git add plugins/todo/tests/kit/ui.test.ts
git commit -m "test(todo): port the mod's pane and band tests to the engine kit"
```

---

### Task 4: Pure tests to their own file, delete the fake

**Files:**
- Create: `plugins/todo/tests/mod/pure.test.mjs`
- Delete: `plugins/todo/tests/mod/events.test.mjs`, `plugins/todo/tests/mod/ui.test.mjs`, `plugins/todo/tests/mod/fake-dollar.mjs`
- Modify: `plugins/todo/README.md` and `README.md` only where they describe how the mod is tested

- [ ] **Step 1: Record the old titles before deleting anything**

```bash
titles() { grep -hE "^(test|each)\(" "$@" | sed -E "s/^(test|each)\('([^']*)'.*$/\2/; s/^(test|each)\(\"([^\"]*)\".*$/\2/" | sort; }
titles plugins/todo/tests/mod/events.test.mjs plugins/todo/tests/mod/ui.test.mjs >"$TMPDIR/old-titles.txt"
wc -l <"$TMPDIR/old-titles.txt"
```

Expected: 70.

- [ ] **Step 2: Create `pure.test.mjs`**

Move the seven pure tests named under "What moves where" verbatim, with the imports they use from `../../hooks/mod.js` and `../../hooks/store.js`. No import of `fake-dollar.mjs`.

- [ ] **Step 3: Delete the three files and compare titles**

```bash
git rm plugins/todo/tests/mod/events.test.mjs plugins/todo/tests/mod/ui.test.mjs plugins/todo/tests/mod/fake-dollar.mjs
titles plugins/todo/tests/mod/pure.test.mjs plugins/todo/tests/kit/*.test.ts >"$TMPDIR/new-titles.txt"
comm -23 "$TMPDIR/old-titles.txt" "$TMPDIR/new-titles.txt"
grep -rn 'fake-dollar' plugins/todo README.md
```

Expected: both commands print nothing. A title `comm` prints is a test that was dropped: port it before going on. The new files hold two titles the old ones did not (the module-state tests).

- [ ] **Step 4: Update the docs**

Where `plugins/todo/README.md` or the root `README.md` says how the mod is tested, say: store and pure functions under Bun in `tests/mod/`, hooks and UI on the engine's kit in `tests/kit/`, both through `mise run test`. If neither file describes the mod's tests, add one line to the root README's task table row for `mise run test`.

- [ ] **Step 5: Run everything**

Run: `mise run check`
Expected: PASS. Bun runs `store.test.mjs`, `fixtures.test.mjs` and `pure.test.mjs`; the kit runs `events.test.ts` and `ui.test.ts`; `tests/validate.sh` still passes `claude plugin validate --strict`.

- [ ] **Step 6: Commit**

```bash
git add -A plugins/todo README.md
git commit -m "test(todo): drop the hand-rolled mods API fake"
```
