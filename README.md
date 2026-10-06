# claude-plugins

A Claude Code plugin marketplace (`marioaer-plugins`).

| Plugin | Description |
|---|---|
| [backlog](plugins/backlog) | Capture deferred tasks mid-session into an untracked project backlog without interrupting the current task. |

## Installation

Add the marketplace once, then install plugins from it:

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install backlog@marioaer-plugins
```

From a shell: `claude plugin marketplace add MarioAer/claude-plugins` and `claude plugin install backlog@marioaer-plugins`. Run `/reload-plugins` to apply changes in a running session.

## backlog

Records tasks you want to defer while Claude Code keeps working on the current task. Items go to `.backlog/backlog.md` in the project root as a flat checklist.

### Usage

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

### Why `.backlog/` and not `.claude/`

- `.backlog/.gitignore` contains `*`, so the folder ignores itself. The backlog stays untracked, survives branch switches and never appears in pull requests, without any change to tracked files.
- Claude Code treats `.claude/` and `.git/` as protected paths: every write there prompts, and allow rules cannot pre-approve it. A backlog in either location would interrupt each capture.

### Permissions

The skill pre-approves only `Read` and `Edit` under `.backlog/` and three read-only commands (`git rev-parse --show-toplevel`, `git branch --show-current`, `date +%F`). Other writes in the same turn still prompt.

For captures without any prompt, also add these rules to `permissions.allow` in your settings:

| Rule | Reason |
|---|---|
| `Skill(backlog:backlog)` | Claude invoking the skill on its own requires approval of the Skill tool. |
| `Edit(//**/.backlog/**)` | Self-initiated adds occasionally lose the skill's grant and prompt for the write. |

## Development

| Command | Purpose |
|---|---|
| `bash tests/validate.sh` | Structural tests: manifests, names, frontmatter, README, `claude plugin validate`. Runs in CI. |
| `tests/backlog-e2e.sh [ID ...]` | Headless behavioral scenarios against the working copy. Calls the Claude API; `MODEL` defaults to `sonnet`. |
| `tests/backlog-scenarios.md` | All scenarios, including the ones that need an interactive session. |

Load a working copy without installing: `claude --plugin-dir ./plugins/backlog`.

A plugin's `version` in `plugin.json` pins installed users to that version. Bump it with every change that users should receive.

## License

[MIT](LICENSE)
