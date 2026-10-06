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

## Plugins

Each plugin has its own README with usage, permissions and design notes:

- [backlog](plugins/backlog/README.md)

## Development

| Command | Purpose |
|---|---|
| `bash tests/validate.sh` | Structural tests: manifests, names, frontmatter, hooks, README, `claude plugin validate`. Runs in CI. |
| `bash tests/hooks.sh` | Unit tests for the plugin hook scripts. Runs in CI. |
| `tests/backlog-e2e.sh [ID ...]` | Headless behavioral scenarios against the working copy. Calls the Claude API; `MODEL` defaults to `sonnet`. |
| `tests/backlog-scenarios.md` | All scenarios, including the ones that need an interactive session. |

Load a working copy without installing: `claude --plugin-dir ./plugins/backlog`.

A plugin's `version` in `plugin.json` pins installed users to that version. Bump it with every change that users should receive.

## License

[MIT](LICENSE)
