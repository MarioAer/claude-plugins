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

### Releasing

A plugin's `version` in `plugin.json` pins installed users to that version: they receive changes only after it is raised. For every change that users should receive:

1. Raise `version` in `plugins/<plugin>/.claude-plugin/plugin.json` in the same pull request.
2. After the squash merge, tag the merge commit and publish a release with notes generated from the merged pull requests:

```
git tag -s <plugin>-v<version> -m "<plugin> <version>" && git push origin <plugin>-v<version>
gh release create <plugin>-v<version> --generate-notes --title "<plugin> <version>"
```

## Security

See [SECURITY.md](SECURITY.md) for supported versions and private vulnerability reporting.

## License

[MIT](LICENSE)
