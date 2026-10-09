# backlog

A Claude Code plugin from the [`marioaer-plugins`](https://github.com/MarioAer/claude-plugins) marketplace.

Records tasks you want to defer while Claude Code keeps working on the current task. Items go to `.backlog/backlog.md` in the project root as a flat checklist.

## Installation

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install backlog@marioaer-plugins
```

## Usage

| Command | Action |
|---|---|
| `/backlog <text>` | Add an item, confirm in one line, resume the current task. |
| `/backlog` | Ask once for the text, then add it. |
| `/backlog list` | Show open items as a numbered list. |
| `/backlog review` | For each open item, answer done, skip, update or quit; changes are shown, then written once. |

If another skill or command already uses the name `backlog`, use the namespaced form `/backlog:backlog`.

Item format:

```
- [ ] add tests for the parser (2026-10-06, branch: feature/parser)
- [x] remove dead retry helper (2026-10-02, branch: main, by: claude)
  - 2026-10-04: blocked by API change
```

- The branch is omitted outside git and on a detached HEAD.
- `by: claude` marks items Claude added on its own: concrete, out-of-scope work found during a task, at most two per task.
- An argument of exactly `list` or `review` selects that mode; any other text, including `review the auth code`, is added as an item.

## Why `.backlog/` and not `.claude/`

- `.backlog/.gitignore` contains `*`, so the folder ignores itself. The backlog stays untracked, survives branch switches and never appears in pull requests, without any change to tracked files.
- Claude Code treats `.claude/` and `.git/` as protected paths: every write there prompts, and allow rules cannot pre-approve it. A backlog in either location would interrupt each capture.

## Permissions

- The skill pre-approves `Read` and `Edit` under `.backlog/` and three read-only commands (`git rev-parse --show-toplevel`, `git branch --show-current`, `date +%F`).
- A `PreToolUse` hook (`hooks/allow-backlog-write.sh`) allows writes to exactly two files, `.backlog/backlog.md` and `.backlog/.gitignore`, and only in the project root (the git root of the session directory, symlinks resolved); `Write` only when it creates the file. The hook is needed because Claude Code drops a skill's `allowed-tools` grant when Claude invokes the skill itself and the Skill tool finishes before the response stream ends ([anthropics/claude-code#99353](https://github.com/anthropics/claude-code/issues/99353)). It can be removed once that issue is fixed. The hook gives no decision for paths with `..`, paths inside `.claude/` or `.git/`, symlinks, or any other file, so those get the normal prompt.
- Other writes in the same turn still prompt.
- A `SessionStart` hook (`hooks/session-start.sh`) adds two sentences of context to each session, telling Claude to record out-of-scope findings with the skill instead of only mentioning them. Without it, Claude noticed such defects but did not record them. The cost is about 60 tokens per session in every project where the plugin is enabled.
- A hook (`hooks/backlog-hook.sh`, running `hooks/backlog_hook.py`) performs adds and lists itself, on `UserPromptExpansion` for a typed `/backlog` and on `PostToolUse` for Claude's own `Skill` call. It writes only `<root>/.backlog/backlog.md` and `.backlog/.gitignore`, under the same rules as the write hook above, and returns the result as context, so an add shows no file or shell tool calls. A call refused by a deny rule never reaches `PostToolUse` and writes nothing. The hook needs `python3`. Claude's own adds through the hook need Claude Code 2.1.293 or later; 2.1.286 did not fire `PostToolUse` for the `Skill` tool. Without `python3`, with hooks disabled, or on an older version, the skill performs the steps itself as in 0.1.1.

Claude Code 2.1.293 ran Claude's own `Skill(backlog:backlog)` call without a permission prompt in manual mode. To block self-initiated captures, add `Skill(backlog:backlog)` to `permissions.deny`.

## License

[MIT](LICENSE)
