# todo

A Claude Code plugin from the [`marioaer-plugins`](https://github.com/MarioAer/claude-plugins) marketplace.

Records tasks you want to defer while Claude Code keeps working on the current task. Items go to `.todo/todo.md` in the project root as a flat checklist.

## Installation

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install todo@marioaer-plugins
```

## Usage

| Command | Action |
|---|---|
| `/todo <text>` | Add an item, also while Claude is working, and confirm with a toast; Claude's turn continues untouched. Trailing `#tags` (letters, digits, `-`, `_`, up to 8) are stored as tags. |
| `/todo` | Open a one-line input for the item (headless: ask once, then take the next prompt). |
| `/todo list` | Show open items as a numbered list. |
| `/todo list #<tag>` | Show only the open items carrying that tag. |
| `/todo review` | For each open item, answer done, skip, update or quit; changes are shown, then written once. |

If another skill or command already uses the name `todo`, use the namespaced form `/todo:capture`.

Upgrading from 0.6: the skill is now `capture`, so the namespaced command is `/todo:capture` (formerly `/todo:todo`), and a `Skill(todo:todo)` permission rule must be renamed to `Skill(todo:capture)`.

Item format:

```
- [ ] add tests for the parser (2026-10-06, branch: feature/parser)
- [x] remove dead retry helper (2026-10-02, branch: main, by: claude)
  - 2026-10-04: blocked by API change
- [ ] fix login (2026-10-05, branch: main, tags: auth, urgent)
```

- The branch is omitted outside git and on a detached HEAD.
- Tags are lowercase names inside the metadata; two items that differ only by their tags are duplicates.
- `by: claude` marks items Claude added on its own: concrete, out-of-scope work found during a task, at most two per task.
- An argument of exactly `list` or `review` selects that mode; any other text, including `review the auth code`, is added as an item.

## Mod

On Claude Code 2.1.287 or later the plugin also loads a mod (`hooks/mod.js`, a hooks module that runs inside Claude Code). With it:

- The mod registers `/todo` as an immediate command, so a typed `/todo <text>` is recorded at once, even while Claude is mid-turn; the toast is the only confirmation and nothing enters the transcript. Headless runs, where no toast is drawn, print the reply line instead. Where the engine refuses the registration (older versions, or another plugin owns `/todo`), one toast says so and `/todo:capture` works as before but waits for the turn to end.
- A typed `/todo <text>`, `/todo list` and `/todo review` are answered by the mod: no model turn starts and no skill text is loaded, so they cost no tokens. A bare `/todo` opens a one-line `Add to todo` input above the prompt (Enter adds, empty Enter or Esc cancels), so a message you type to Claude is never taken as the item; in headless runs it prints the question and takes your next prompt as the item, also without a turn.
- Claude's own `Skill(todo:capture)` call is answered by the mod: the item is recorded, Claude reads one context line instead of the skill text, and confirms in one line (about 30 tokens).
- Every add, duplicate or failure shows a toast. A band above the prompt shows `Todo: N open` for ten seconds after any todo call and while review is open; it is never shown otherwise.
- `/todo review` opens a pane with the open items grouped by tag and a detail card for the item under the cursor (date, branch, tags and its notes). Keys: `j`/`k` move, `g`/`e` jump to the first/last item, `d` done, `u` undo the last done, `n` note (stays on the item), `t` tags (lists the known tags), `q` close. Each action is written at once. While the pane has the keyboard its border is cyan and the header shows `● keys active`; otherwise it is dimmed and `ctrl+x tab` focuses it. Closing shows a summary toast. In headless runs, the VS Code extension and the SDK, where nothing is drawn, review falls back to the question loop below.
- The pane groups items by their first tag, one heading per tag in its own colour (stable while the tag exists in the file), untagged items last. `t` edits the current item's tags: space or comma separated, `#` optional, empty clears; invalid names are named in a toast and dropped.

Where the mod does not load (older versions, `--safe-mode`, `disableAllHooks`, WSL sessions in the desktop app), everything behaves as in 0.2.1: the command hook performs adds and lists and the skill handles the rest.

## Why `.todo/` and not `.claude/`

- `.todo/.gitignore` contains `*`, so the folder ignores itself. The todo list stays untracked, survives branch switches and never appears in pull requests, without any change to tracked files.
- Claude Code treats `.claude/` and `.git/` as protected paths: every write there prompts, and allow rules cannot pre-approve it. A todo list in either location would interrupt each capture.

## Permissions

- The skill declares no `allowed-tools`. With `allowed-tools`, Claude's own `Skill(todo:todo)` call returned only `Execute skill: todo:todo` without the skill body (Claude Code 2.1.286 and 2.1.293), and the item was never recorded. Adds and lists are performed by the add hook below. Flows that still run tool calls through the model may ask for permission for `git rev-parse`, `git branch` or `date`: answering the question after a bare `/todo`, and every flow when hooks are disabled. For `/todo review` the hook hands the skill the file path and the open items, so the review starts with no shell call.
- A `PreToolUse` hook (`hooks/allow-todo-write.sh`) allows writes to exactly two files, `.todo/todo.md` and `.todo/.gitignore`, and only in the project root (the git root of the session directory, symlinks resolved); `Write` only when it creates the file. The hook is needed because the skill declares no `allowed-tools` (see above), so nothing else pre-approves these writes for review and the fallback. The hook gives no decision for paths with `..`, a `.todo/` inside `.claude/` or `.git/` when the session directory is outside a git work tree, symlinks, or any other file, so those get the normal prompt.
- Other writes in the same turn still prompt.
- A `SessionStart` hook (`hooks/session-start.sh`) adds two sentences of context to each session, telling Claude to record out-of-scope findings with the skill instead of only mentioning them. Without it, Claude noticed such defects but did not record them. The cost is about 60 tokens per session in every project where the plugin is enabled.
- A hook (`hooks/todo-hook.sh`, running `hooks/todo_hook.py`) performs adds and lists itself, on `UserPromptExpansion` for a typed `/todo` and on `PostToolUse` for Claude's own `Skill` call. It writes only inside `<root>/.todo/` (`todo.md`, `.gitignore`, and a transient `.lock` directory), never when the session directory is inside `.git/`, or inside `.claude/` outside a git work tree (a worktree under `.claude/worktrees/` is a normal root), refusing symlinks like the write hook above, and returns the result as context, so an add shows no file or shell tool calls. A call refused by a deny rule never reaches `PostToolUse` and writes nothing; the mod asks the engine's permission decision before answering the call and passes a denied call through, so the rule holds there too. The hook needs `python3`; without it, or with hooks disabled, the skill performs the steps itself as in 0.1.1, following `skills/capture/fallback.md`.
- The mod runs with your permissions inside Claude Code, outside the Bash sandbox, as every mod does. It writes only `<root>/.todo/` (`todo.md`, `.gitignore`, a transient `.lock` directory), refuses symlinks and the same session directories as the command hook, and runs only `git rev-parse`, `mkdir` and `rmdir` with fixed arguments; item text is never a subprocess argument.
- The mod answers Claude's own `Skill(todo:capture)` call itself, so that call never reaches the skill; no other tool call is answered or approved by the plugin.
- With the mod loaded the skill text is not loaded at all; without it, the skill file holds only the decision logic (about 1,000 tokens per invocation). The manual add and list procedure (`fallback.md`) and the review procedure (`review.md`) are read on demand, so a hook-handled add does not load them.

Claude Code 2.1.293 ran Claude's own `Skill(todo:capture)` call without a permission prompt in manual mode. To block self-initiated captures, add `Skill(todo:capture)` to `permissions.deny`; the mod checks that decision first and leaves a denied call to the engine, which refuses it.

## License

[MIT](LICENSE)
