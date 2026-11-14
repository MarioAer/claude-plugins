# Merge geparkt into todo: one list per repository with a worktree dimension

Date: 2026-11-14. Status: draft for approval.

## Intent

The `todo` and `geparkt` plugins do the same job in practice: Claude uses both to park things for later. The todo list (originally the "backlog" idea) is the model that works. geparkt's open questions fail in two ways:

- they stay open after they are settled, because nothing closes them unless Claude remembers a second call;
- they break in git worktrees: geparkt refuses to record when the worktree sits under `.claude/` (todo fixed the same bug in #18), and its per-session, per-checkout storage scatters threads.

todo has a related problem: its list lives at `git rev-parse --show-toplevel`, which inside a worktree is the worktree folder. Items captured in a worktree never reach the main checkout and are deleted with the worktree.

Goal: one plugin, `todo`, holding one list per repository. Items captured in a worktree belong to that worktree and close themselves when the worktree is removed.

## Goals

1. Retire geparkt completely.
2. One todo list per repository, stored in the main checkout, shared by every worktree and session.
3. A worktree dimension: items captured inside a worktree carry its name and are closed automatically once that worktree no longer exists.
4. A reminder of open items after `/compact`, `/clear` and resume (carried over from geparkt).
5. Less code: drop todo's Python hook, so each rule is implemented once, in `store.js`.

## Non-goals

- No separate "question" kind, no reply-to-thread from the pane, no per-session scope. A parked question is an ordinary item tagged `#question`.
- No deprecation release of geparkt; it is removed in this change.
- No migration of existing per-worktree `.todo/todo.md` files. Today those lists are deleted with their worktree anyway; nothing gets worse. (Builder's call.)
- No new UI beyond the worktree grouping and reminder below.

## Anti-goals

- Silently deleting items. Worktree cleanup closes items (`[x]` plus a note); it never removes a line.
- Losing Claude's out-of-scope findings when a branch is thrown away.
- Behaviour that differs between the mod and the manual fallback in what gets written.

## Constraints

- Mods run inside Claude Code with the user's permissions, outside the Bash sandbox. The manual fallback runs through Claude's Write/Edit tools, which are subject to permission prompts; the `PreToolUse` allow hook is what keeps those silent.
- Worktree sessions write to the main checkout, which is outside the session's working directory.
- There is no event when a worktree is removed: git does not announce it, and the desktop app's worktree cleanup does not run plugin hooks.
- Existing file format stays readable: current items without a `worktree:` field are repo-wide.

## Approaches considered

- **A. Update all three paths** (mod, Python hook, manual fallback) with the new rules. Keeps every environment as it is today, but writes worktree scoping and cleanup twice (JS and Python) and grows the cross-language fixture suite.
- **B. Drop the Python hook; keep the mod plus the manual fallback.** All logic lives once in `store.js`. Where the mod does not load (Claude Code before 2.1.292, `--safe-mode`, WSL sessions in the desktop app), an add costs a few tool calls and may prompt.

**Chosen: B**, by the user. It is the cleanup asked for, and the environments that lose out are edge cases for this marketplace.

## Design (decided with the user)

### Storage location

- The list is `<main checkout>/.todo/todo.md`, where the main checkout is the parent of `git rev-parse --path-format=absolute --git-common-dir` when that path ends in `/.git`.
- Outside git: the session directory, as today.
- A repository without a main working tree (bare repository with worktrees, or a separate git dir): fall back to today's behaviour, the current worktree's top level. (Builder's call.)
- `.todo/.gitignore` containing `*` stays as is.

### Item format

One new optional metadata field, placed after `branch:`:

```
- [ ] fix flaky login test (2026-11-14, branch: feat/x, worktree: feat-x-1a2b3c)
- [ ] retry helper swallows errors (2026-11-14, branch: feat/x, by: claude)
- [x] does the API need pagination? (2026-11-14, branch: feat/x, worktree: feat-x-1a2b3c, tags: question)
  - 2026-11-20: worktree removed
```

- The worktree name is the basename of the worktree's directory. (Builder's call; collisions between worktrees with the same basename are accepted.)
- Items without `worktree:` are repo-wide. Every item captured in the main checkout is repo-wide.
- Duplicate detection keeps ignoring metadata, so the same text in two worktrees is a duplicate.
- When an add duplicates an open item whose scope differs (the new add is repo-wide, or belongs to a different worktree), the existing item is promoted: its `worktree:` field is removed, so it becomes repo-wide and survives both worktrees. The reply stays `Already on todo list`. (Builder's call; keeps Claude's out-of-scope findings from closing with someone else's branch.)

### Scope rules (decided)

Inside a worktree:

| Who adds | Default scope |
|---|---|
| The user, `/todo <text>` | this worktree |
| The user, with `#repo` in the trailing tags | repo-wide; `#repo` is consumed, not stored as a tag |
| Claude on its own (`by: claude`) | repo-wide, because these are out-of-scope by definition |
| Claude on its own, tagged `#question` | this worktree |

### Worktree cleanup

- On every mod read of the list (list, band, pane, add, turn line), todo runs `git worktree list --porcelain` once and treats any `worktree:` name that is not among the live, non-prunable worktrees as removed.
- Each open item of a removed worktree is marked `[x]` and gets the note `  - <date>: worktree removed`, inside the existing lock, in one write.
- If `git worktree list` fails, nothing is closed.

### Views

- In a worktree: `/todo list`, the review pane and the reminder show this worktree's items first, then the repo-wide ones. Items of other worktrees are not shown there.
- In the main checkout: everything, grouped by worktree (repo-wide first).
- The turn line and band count the items shown in that view.

### Closing items: `done` (decided)

- New mode: `/todo done <text>` and Claude's own Skill call with args `done <text>`. The remainder is matched against the open items of the current view, ignoring metadata and case. Exactly one match: it is marked `[x]` and gets the note `  - <date>: done by claude` (Claude) or no note (user). Reply `Done: <text>`, marker `TODO_DONE: <text>`.
- No match: `TODO_FAILED: no open item matches: <text>`; nothing is added. An argument starting with `done ` is therefore never item text. (Builder's call.)
- The `SessionStart` rule tells Claude: when a `#question` item it parked is answered or becomes moot, close it with `done <item text>`. The reminder lists item texts without metadata so Claude can copy them exactly.
- `fallback.md` gets a Done section (find the line, Edit `- [ ]` to `- [x]`).

### Reminder after compact, clear and resume

- The existing `SessionStart` hook (`session-start.sh`, bash) adds, on `resume|clear|compact`, up to eight open items of the current view after the existing rule, in the form `Open todo items (N): 1. … 2. …`. On `startup` it adds only the rule, as today.
- It reads the file with shell tools and git only; no Python. It never writes: items of worktrees missing from `git worktree list` are left out of the reminder, and the next mod read closes them. Repeating the location and view rules in bash is accepted; it is read-only and small. (Builder's call.)

### Retiring geparkt

- Delete `plugins/geparkt/`, its marketplace entry, its mention in the root README, and its pane-replies spec and plan under `docs/superpowers/`.
- Existing `.geparkt/` folders are not imported: their threads were per session and are dead once the session ends. The root README tells users the folder can be deleted. (Builder's call.)
- SKILL.md markers that only the Python hook emitted (`TODO_LIST`, `TODO_EMPTY`, `TODO_REVIEW`) are removed; the mod's `TODO_ADDED`/`TODO_DUPLICATE`/`TODO_FAILED` stay. (Builder's call.)
- The todo `SessionStart` rule gains one sentence: a question or topic Claude parks for later is recorded as a todo item tagged `#question` (within the existing two-per-task limit). (Builder's call on wording.)

### Dropping the Python hook

- Delete `todo_hook.py`, `todo-hook.sh`, their hook entries, `tests/store_fixtures.py` and the Python half of the fixture tests; keep `fixtures/store.json` if the JS tests still use it.
- `skills/capture/fallback.md` learns the new location (main checkout), the `worktree:` field and the scope rules, so a manual add writes the same line the mod would. Manual flows do not perform worktree cleanup; the next mod read does.
- `allow-todo-write.sh` must also allow `<main checkout>/.todo/todo.md` and `.gitignore` when the session is in a worktree, with the same symlink and path checks.

### Release

- todo becomes 0.8.0. The README is rewritten to current behaviour only: upgrade notes and version history move to a short "Changes in 0.8" section; the rest is trimmed.

## Left to the builder

- Function boundaries in `store.js` and `mod.js`, and the test layout.
- Exact wording of the reminder, the `#question` rule sentence and the README.
- How the pane draws worktree groups (reusing the tag-group headings is fine).
- Whether `tests/validate.sh` still needs `python3` for its own checks.
