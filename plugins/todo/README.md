# todo

A Claude Code plugin from the [`marioaer-plugins`](https://github.com/MarioAer/claude-plugins) marketplace.

Records work you want to park while Claude Code keeps working on the current task: deferred tasks, out-of-scope findings and open questions. Each repository has one list, `.todo/todo.md` in the main checkout, shared by every worktree and session.

## Installation

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install todo@marioaer-plugins
```

## Usage

| Command | Action |
|---|---|
| `/todo <text>` | Add an item, also while Claude is working; Claude's turn continues untouched. Trailing `#tags` (letters, digits, `-`, `_`, up to 8) are stored as tags. |
| `/todo` | Open a one-line input for the item (headless: ask once, then take the next prompt). |
| `/todo list` | Show the open items of this session's view as a numbered list. |
| `/todo list #<tag>` | Only the open items carrying that tag. |
| `/todo done <text>` | Close the open item whose text matches, ignoring case and metadata. With no match nothing is added. |
| `/todo review` | Review the open items one by one: done, note, retag. |
| `/todo … #` | With the mod loaded, typing `#` after `/todo` completes the tags already in the list. |

If another skill or command already uses the name `todo`, use `/todo:capture`.

## Items

```
- [ ] add tests for the parser (2026-10-06, branch: main)
- [ ] fix flaky login test (2026-11-14, branch: feat/x, worktree: feat-x)
- [ ] retry helper swallows errors (2026-11-14, branch: feat/x, by: claude)
- [x] does the API need pagination? (2026-11-14, branch: feat/x, worktree: feat-x, by: claude, tags: question)
  - 2026-11-20: worktree removed
```

- The branch is omitted outside git and on a detached HEAD.
- `worktree:` names the linked worktree (its folder name) the item belongs to; items without it are repo-wide.
- `by: claude` marks items Claude added on its own: concrete, out-of-scope work found during a task, at most two per task, and questions it parks with `#question`.
- Tags are lowercase names inside the metadata. Two open items with the same text, ignoring case and metadata, are duplicates.
- Notes (`  - <date>: <text>`) sit under their item. Items are never deleted, only closed with `[x]`.

## Worktrees

The list lives in the main checkout (found with `git rev-parse --git-common-dir`), so an item captured in a worktree is not lost when the worktree goes. Inside a worktree:

| Who adds | Scope |
|---|---|
| You, `/todo <text>` | this worktree |
| You, with `#repo` among the trailing tags | repo-wide; `#repo` is not stored |
| Claude on its own | repo-wide: out-of-scope findings outlive the branch |
| Claude on its own, tagged `#question` | this worktree |

- **View.** In a worktree, list, review and the counts show that worktree's items first, then the repo-wide ones; other worktrees' items are hidden. The main checkout shows everything, repo-wide first, then one block per worktree.
- **Cleanup.** When `git worktree list` no longer shows a worktree (removed, or its folder deleted), the mod's next read closes its open items with the note `worktree removed`. If git fails, nothing is closed.
- **Duplicates across scopes.** Adding text that is already open in another worktree makes the existing item repo-wide, so it outlives both.
- Outside git the list is in the session directory. In a repository without a main checkout (a bare repository), each worktree has its own list.

## Reminder after compact, clear and resume

A `SessionStart` hook (`hooks/session-start.sh`) adds two things to Claude's context:

- On every start, a short rule (about 100 tokens): record out-of-scope findings with the skill instead of only mentioning them; park questions as `#question` items and close them with `done <item text>` once answered or moot.
- After `/compact`, `/clear` and on resume, the open items of the view, at most eight: `Open todo items (N): 1. … 2. …`. The hook only reads; items of removed worktrees are left out.

## Mod

On Claude Code 2.1.292 or later the plugin loads a mod (`hooks/mod.js`, a hooks module that runs inside Claude Code). With it:

- `/todo` is an immediate command: a typed add, list or done is handled at once, even mid-turn, without a model turn and without loading skill text. The toast is the confirmation; headless runs print the reply line. Where the engine refuses the registration (older versions, or another plugin owns `/todo`), one toast says so and `/todo:capture` works but waits for the turn to end.
- A bare `/todo` opens a one-line `Add to todo` input above the prompt (Enter adds, empty Enter or Esc cancels), so a message you type to Claude is never taken as the item.
- Claude's own `Skill(todo:capture)` call, an add or a `done`, is answered by the mod: Claude reads one context line instead of the skill text and confirms in one line.
- A turn that added items ends with one line under the answer, such as `Todo: +2 this turn · 7 open`.
- A band above the prompt shows `Todo: N open` for ten seconds after any todo call and while review is open.
- `/todo review` opens a pane: open items grouped by tag (and by worktree in the main checkout), a detail card for the item under the cursor. Keys: `j`/`k` move, `g`/`e` first/last, `d` done, `u` undo the last done, `n` note, `t` tags, `q` close. Each action is written at once. In headless runs, the VS Code extension and the SDK, review falls back to a question loop.

Without the mod (Claude Code before 2.1.292, `--safe-mode`, `disableAllHooks`, WSL sessions in the desktop app), Claude performs adds, lists, done and review itself by following `skills/capture/fallback.md` and `review.md`. That costs a few tool calls; `git rev-parse` and `date` may ask for permission. Items of removed worktrees are closed on the mod's next read, not by the fallback.

## Why `.todo/` and not `.claude/`

- `.todo/.gitignore` contains `*`, so the folder ignores itself. The list stays untracked, survives branch switches and never appears in pull requests, without any change to tracked files.
- Claude Code treats `.claude/` and `.git/` as protected paths: every write there prompts, and allow rules cannot pre-approve it.

## Permissions

- The mod runs with your permissions inside Claude Code, outside the Bash sandbox, as every mod does. It writes only `<root>/.todo/` (`todo.md`, `.gitignore`, a transient `.lock` directory), refuses symlinks, refuses a session directory inside `.git/` (or inside `.claude/` outside a git work tree), and runs only `git rev-parse`, `git worktree list`, `mkdir` and `rmdir` with fixed arguments; item text is never a subprocess argument.
- The mod answers Claude's own `Skill(todo:capture)` call only when the engine's permission decision is not `deny`; a deny rule on `Skill(todo:capture)` is left to the engine, which refuses it. No other tool call is answered or approved.
- A `PreToolUse` hook (`hooks/allow-todo-write.sh`) lets the fallback write exactly two files without a prompt, `<root>/.todo/todo.md` and `<root>/.todo/.gitignore`, where `<root>` is the main checkout; `Write` only when it creates the file. It also allows `Read` of `<root>/.todo/todo.md`, which lies outside a worktree session's working directory. Paths with `..`, symlinks, a `.todo/` anywhere else and every other file get the normal prompt.
- The skill declares no `allowed-tools`: with them, Claude's own `Skill(todo:capture)` call returned only `Execute skill: todo:capture` without the skill body (Claude Code 2.1.286 and 2.1.293).

To block self-initiated captures, add `Skill(todo:capture)` to `permissions.deny`.

## Changes in 0.8

- geparkt is merged into todo: park a question as an item tagged `#question`; uninstall geparkt.
- One list per repository in the main checkout, with the `worktree:` field, scoped views and cleanup of removed worktrees. A list kept inside a worktree by 0.7 is not migrated; its open items can be re-added from the main checkout.
- `/todo done <text>` closes an item; an argument starting with `done ` is never item text.
- The Python hook (`hooks/todo_hook.py`) is gone; without the mod, the skill performs the steps itself.
- After compact, clear and resume the open items come back as a reminder.

## License

[MIT](LICENSE)
