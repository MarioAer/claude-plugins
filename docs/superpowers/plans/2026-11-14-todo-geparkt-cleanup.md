# Merge geparkt into todo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire geparkt and turn todo into one list per repository with worktree-scoped items, a `done` mode, and a reminder after compact/clear/resume, with the Python hook removed.

**Architecture:** All file rules live in `plugins/todo/hooks/store.js` over the injected `io` object; `hooks/mod.js` adapts them to the mods API. Where the mod does not load, Claude follows `skills/capture/fallback.md` by hand. Two bash hooks remain: `allow-todo-write.sh` (silent writes for the fallback) and `session-start.sh` (rule + read-only reminder).

**Tech Stack:** JavaScript ES modules (Node 22 `node:test`), bash, git, jq (tests only).

**Spec:** `docs/superpowers/specs/2026-11-14-todo-geparkt-cleanup-design.md`

## Global Constraints

- The list lives at `<main checkout>/.todo/todo.md`; main checkout = parent of `git rev-parse --path-format=absolute --git-common-dir` when that ends in `/.git`; otherwise the current worktree top level; outside git, the session directory.
- New metadata field `worktree: <basename of the worktree dir>`, placed after `branch:` and before `by: claude`.
- Items are never deleted; closing is `- [ ]` → `- [x]` plus an optional `  - <date>: <note>` line.
- Note texts, exactly: `worktree removed`, `done by claude`.
- Markers: `TODO_ADDED: <text>`, `TODO_DUPLICATE: <text>`, `TODO_DONE: <text>`, `TODO_FAILED: <reason>`. Reply lines: `Added to todo list: <text>`, `Already on todo list: <text>`, `Done: <text>`, `Todo failed: <reason>`.
- No-match reason, exactly: `no open item matches: <text>`.
- `#repo` is a control tag: it sets repo scope and is never stored.
- Reminder: at most 8 items, form `Open todo items (N): 1. <text> 2. <text> …`, texts without metadata; only on `resume|clear|compact`.
- No Python anywhere in `plugins/todo` after Task 7.
- todo version `0.8.0`.

## Review Focus

1. A worktree whose directory path contains spaces: `git worktree list --porcelain` parsing must take the whole `worktree <path>` line. Test in Task 3.
2. `git worktree list` failing (git missing, not a repo, timeout): nothing is closed and the list still shows. Test in Task 3.
3. Item text containing `, worktree: x)` mid-text: META stays anchored at the end, so it is text. Test in Task 2.
4. Two worktree sessions adding at once: both lines land in the main checkout file through the existing `.todo/.lock`. Test in Task 2 (two concurrent `add` calls, both lines present).
5. The mods API writing outside the session cwd (main checkout from a worktree session) is unverified. Manual check in Task 9.

---

### Task 1: Remove geparkt

**Files:**
- Delete: `plugins/geparkt/` (whole folder), `docs/superpowers/specs/2026-11-04-geparkt-pane-replies-design.md`, `docs/superpowers/plans/2026-11-04-geparkt-pane-replies.md`
- Modify: `.claude-plugin/marketplace.json` (drop the geparkt entry), `README.md` (drop geparkt; add one line: "geparkt was merged into todo in 0.8; an old `.geparkt/` folder in a project can be deleted.")

- [ ] **Step 1:** `git rm -r plugins/geparkt docs/superpowers/specs/2026-11-04-geparkt-pane-replies-design.md docs/superpowers/plans/2026-11-04-geparkt-pane-replies.md`, then edit the two files.
- [ ] **Step 2:** Run `grep -rn geparkt --exclude-dir=.git . | grep -v docs/superpowers/specs/2026-11-14 | grep -v docs/superpowers/plans/2026-11-14`. Expected: only the README migration line.
- [ ] **Step 3:** Run `VALIDATE_SKIP_CLI=1 bash tests/validate.sh && bash tests/unit.sh`. Expected: both exit 0.
- [ ] **Step 4:** Commit `chore: retire the geparkt plugin`.

### Task 2: Repository location, worktree field and scoped add

**Files:**
- Modify: `plugins/todo/hooks/store.js` (`META`, `locate`, `add`, `itemTags`, `withoutTagsField`, new `itemWorktree`, `scopeOf`)
- Modify: `plugins/todo/hooks/mod.js:221-225` (`itemMeta` reads the shifted groups)
- Test: `plugins/todo/tests/mod/store.test.mjs`, `plugins/todo/tests/fixtures/store.json`, `plugins/todo/tests/mod/fixtures.test.mjs`

**Interfaces:**
- Produces:
  - `META = /\s\(\d{4}-\d{2}-\d{2}(, branch: [^,)]*)?(, worktree: [^,)]*)?(, by: claude)?(, tags: ([^)]*))?\)$/` (groups: 1 branch, 2 worktree, 3 by, 4 tags field, 5 tag list)
  - `locate(io, cwd) -> Promise<{ root: string, branch: string|null, inRepo: boolean, worktree: string|null }>`: `root` is the main checkout; `worktree` is the basename of `--show-toplevel` when it differs from `root`, else null.
  - `itemWorktree(item: string) -> string|null`
  - `scopeOf({ worktree, byClaude, tags }) -> { worktree: string|null, tags: string[] }`: drops `repo` from tags; returns `worktree: null` when `repo` was present, or when `byClaude` and `question` is not in tags; otherwise the given worktree.
  - `add(io, { root, branch, worktree, text, byClaude }) -> Promise<marker>`; a duplicate whose existing item has a different worktree than the computed scope has its `, worktree: …` field removed inside the lock, and the marker is still `TODO_DUPLICATE`.

- [ ] **Step 1: Failing tests** in `store.test.mjs`:
  - `locate in a linked worktree returns the main checkout as root and the worktree basename` (real `git init` + `git worktree add` under a temp dir; assert `root === realpath(main)`, `worktree === 'wt'`, `branch === 'wt'`).
  - `locate in the main checkout returns worktree null`.
  - `scopeOf`: `{worktree:'wt',byClaude:false,tags:['x']}` → `{worktree:'wt',tags:['x']}`; with tags `['repo','x']` → `{worktree:null,tags:['x']}`; `byClaude:true, tags:[]` → `worktree:null`; `byClaude:true, tags:['question']` → `worktree:'wt'`.
  - `META keeps ", worktree: x)" inside the text as text` (`itemWorktree('a, worktree: x) b (2026-01-01)') === null`).
  - `concurrent adds from two worktrees both land` (two `add` calls via `Promise.all`; both lines in the file).
  - Fixtures in `store.json` (fields `worktree`, optional): add in worktree writes `(<today>, branch: wt, worktree: wt)`; `#repo` add writes no worktree and no `repo` tag; claude add with `#question` keeps worktree; duplicate from repo scope promotes `worktree: a` item to no worktree.
- [ ] **Step 2:** Run `node --test plugins/todo/tests/mod/*.test.mjs`. Expected: the new tests fail.
- [ ] **Step 3:** Implement. `locate` makes one call: `git -C cwd rev-parse --show-toplevel --path-format=absolute --git-common-dir --git-path HEAD`. Pass `worktree` through `fixtures.test.mjs`. Shift group numbers in `itemTags`, `withoutTagsField`, `itemMeta`.
- [ ] **Step 4:** Run `node --test plugins/todo/tests/mod/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Commit `feat(todo): one list per repository with a worktree field`.

### Task 3: Worktree cleanup and views

**Files:**
- Modify: `plugins/todo/hooks/store.js` (`list`, `listWithOrder`; new `liveWorktrees`, `closeRemoved`, `viewItems`)
- Test: `plugins/todo/tests/mod/store.test.mjs`

**Interfaces:**
- Consumes: `itemWorktree`, `locate` from Task 2.
- Produces:
  - `liveWorktrees(io, root) -> Promise<Set<string>|null>`: basenames of `git worktree list --porcelain` entries that have no `prunable` line; null on any failure.
  - `closeRemoved(io, root, live: Set<string>) -> Promise<number>`: under the lock, marks open items whose worktree is not in `live` as `[x]` with note `worktree removed`, one write; returns the count.
  - `viewItems(items: string[], here: string|null) -> string[]`: `here` set: items of `here`, then repo-wide; others left out. `here` null (main checkout): repo-wide first, then each worktree in first-appearance order.
  - `list(io, root, { tag = null, here = null } = {})` and `listWithOrder(io, root, here = null)` call `liveWorktrees` then `closeRemoved` (skipped when null) before reading, and return items through `viewItems`.

- [ ] **Step 1: Failing tests:** `closeRemoved closes items of a removed worktree with a note` (asserts the exact `- [x] …` line and `  - <today>: worktree removed`); `a failing git closes nothing` (io whose `run` returns exitCode 128); `liveWorktrees reads a path with spaces`; `a prunable worktree counts as removed`; `viewItems orders own worktree first and hides others`; `viewItems in the main checkout groups repo-wide first`.
- [ ] **Step 2:** Run the mod tests. Expected: new tests fail.
- [ ] **Step 3:** Implement the signatures above; update the existing `list(io, root, tag)` callers in tests to the options form.
- [ ] **Step 4:** Run the mod tests. Expected: all pass.
- [ ] **Step 5:** Commit `feat(todo): close items of removed worktrees`.

### Task 4: `done` mode in the store

**Files:**
- Modify: `plugins/todo/hooks/store.js` (`modeOf`, new `doneText`, `closeByText`)
- Test: `plugins/todo/tests/mod/store.test.mjs`, `plugins/todo/tests/fixtures/store.json`

**Interfaces:**
- Produces:
  - `modeOf(text)` returns `'done'` when `text` matches `/^done\s+\S/i`.
  - `doneText(text) -> string` (the remainder after `done `, trimmed).
  - `closeByText(io, { root, here, text, byClaude }) -> Promise<marker>`: matches `stripMeta(item).toLowerCase() === text.toLowerCase()` among `viewItems` of the open items; marks it done, adds note `done by claude` when `byClaude`; returns `TODO_DONE: <stripped text>\n${DATA_NOTE}`, or `TODO_FAILED: no open item matches: <text>`.

- [ ] **Step 1: Failing tests:** `modeOf('done fix login') === 'done'`, `modeOf('done') === 'add'`; fixtures: claude done writes `[x]` plus `done by claude`; user done writes `[x]` and no note; unknown text returns the no-match marker and leaves the file unchanged; an item of another worktree does not match.
- [ ] **Step 2:** Run the mod tests. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the mod tests. Expected: pass.
- [ ] **Step 5:** Commit `feat(todo): done mode`.

### Task 5: Mod wiring

**Files:**
- Modify: `plugins/todo/hooks/mod.js` (`performAdd`, `listText`, `showBand`, `loadView`, `openPane`, `refreshPane`, `turnComplete`, `autocomplete`, `runCommand`, `callSkill`, `replyFor`, `listEntries`, header comment), `plugins/todo/types/index.d.ts` (`View.here: string|null`)
- Test: `plugins/todo/tests/mod/events.test.mjs`, `plugins/todo/tests/mod/ui.test.mjs`

**Interfaces:**
- Consumes: `locate`, `add`, `list`, `listWithOrder`, `closeByText`, `modeOf`, `doneText`, `itemWorktree` from Tasks 2–4.
- Produces: `replyFor` maps `TODO_DONE: x` → `Done: x`. The view stores `here` next to `root`. `listEntries(items, order, here)` inserts `{ worktreeHeading: name|null }` entries before each scope's tag groups only when `here` is null. `ARGUMENT_HINT = '[<task text> | list | review | done <text>]'`.

- [ ] **Step 1: Failing tests:** in `events.test.mjs`, `/todo done <text>` from the composer toasts `Done: <text>`; Claude's `Skill(todo:capture, 'done <text>')` returns context starting `TODO_DONE:`; a denied permission still passes through for `done`. In `ui.test.mjs`, `listEntries` with `here` null emits worktree headings; with `here` set it emits none.
- [ ] **Step 2:** Run the mod tests. Expected: fail.
- [ ] **Step 3:** Implement; the header comment drops the reference to `todo_hook.py`.
- [ ] **Step 4:** Run the mod tests. Expected: pass.
- [ ] **Step 5:** Commit `feat(todo): worktree views and done in the mod`.

### Task 6: Session-start rule and reminder

**Files:**
- Modify: `plugins/todo/hooks/session-start.sh`
- Test: `plugins/todo/tests/run.sh` (replace the `python3 -c json.loads` check with `jq -e .`)

**Interfaces:**
- Produces: on stdin JSON with `source` and `cwd`, prints one JSON object. `additionalContext` = the existing rule + one sentence: "Park a question or topic for later as a todo item tagged #question; when it is answered or moot, close it with args \"done <item text>\"." On `resume|clear|compact` with open items in the view (Task 3 rules, removed worktrees left out, read-only), it appends the reminder line from Global Constraints.

- [ ] **Step 1: Failing tests** in `run.sh`: startup output has no `Open todo items`; compact in a worktree lists its own item then a repo-wide one and leaves out a removed worktree's item; nine items yield `Open todo items (9):` with eight listed; output is valid per `jq -e .`; the file is byte-identical before and after.
- [ ] **Step 2:** Run `bash plugins/todo/tests/run.sh`. Expected: new checks fail.
- [ ] **Step 3:** Implement with `git`, `grep`, `sed` and `jq -n --arg` for the JSON.
- [ ] **Step 4:** Run `bash plugins/todo/tests/run.sh`. Expected: pass.
- [ ] **Step 5:** Commit `feat(todo): remind of open items after compact and resume`.

### Task 7: Drop the Python hook; update the fallback path

**Files:**
- Delete: `plugins/todo/hooks/todo_hook.py`, `plugins/todo/hooks/todo-hook.sh`, `plugins/todo/tests/add-hook.sh`, `plugins/todo/tests/store_fixtures.py`
- Modify: `plugins/todo/hooks/hooks.json` (drop `UserPromptExpansion` and `PostToolUse`), `plugins/todo/hooks/store.js` header comment, `plugins/todo/tests/run.sh` (stop calling `add-hook.sh`), `plugins/todo/skills/capture/SKILL.md` (section 0: only `TODO_ADDED`, `TODO_DUPLICATE`, `TODO_DONE`, `TODO_FAILED`; mode table gains `done <text>`), `plugins/todo/skills/capture/fallback.md` (Locate uses `git rev-parse --path-format=absolute --git-common-dir`; Add writes `worktree:` per the scope rules; new Done section), `plugins/todo/skills/capture/review.md` (locate as fallback.md does), `plugins/todo/hooks/allow-todo-write.sh` (root = main checkout as in Global Constraints)
- Test: `plugins/todo/tests/run.sh`

- [ ] **Step 1: Failing tests** in `run.sh`: `expect "main checkout todo from a worktree" allow Write "$WORK/wtrepo/.todo/todo.md" "$WORK/wtrepo/.claude/worktrees/wt"`; `expect "worktree-local todo" none Write "$WORK/wtrepo/.claude/worktrees/wt/.todo/todo.md"`; `fallback.md` contains `, worktree: ` and `## Done`; `SKILL.md` contains `TODO_DONE` and no `TODO_REVIEW`; `! grep -rq python plugins/todo`.
- [ ] **Step 2:** Run `bash plugins/todo/tests/run.sh`. Expected: fail.
- [ ] **Step 3:** Implement. Keep `SKILL.md` within its 4,500-byte check.
- [ ] **Step 4:** Run `bash plugins/todo/tests/run.sh && bash tests/unit.sh`. Expected: pass.
- [ ] **Step 5:** Commit `chore(todo): drop the Python hook`.

### Task 8: README and release

**Files:**
- Modify: `plugins/todo/README.md`, `plugins/todo/.claude-plugin/plugin.json` (`"version": "0.8.0"`), `tests/validate.sh` only if a check named geparkt or Python

- [ ] **Step 1:** Rewrite the README to current behaviour: storage (one list per repo, worktree field, scope table, cleanup), `done`, the reminder, mod vs fallback. Upgrade notes collapse into a "Changes in 0.8" section (geparkt merged, Python hook removed, list moved to the main checkout, `done <text>` is no longer item text).
- [ ] **Step 2:** Run `VALIDATE_SKIP_CLI=1 bash tests/validate.sh && bash tests/unit.sh`. Expected: exit 0.
- [ ] **Step 3:** Commit `chore: bump todo to 0.8.0`.

### Task 9: End-to-end check in a real worktree

- [ ] **Step 1:** Run `bash plugins/todo/tests/e2e.sh` (calls the Claude API). Expected: all pass; fix expectations that named the Python hook.
- [ ] **Step 2:** Manual: in a worktree session of this repo with the plugin loaded from this branch, `/todo check worktree write`; expect the line with `worktree: <name>` in the main checkout's `.todo/todo.md` (Review Focus 5). Then `/todo done check worktree write`; expect `[x]`.
- [ ] **Step 3:** Commit any e2e fixes `test(todo): e2e for worktree scope`.
