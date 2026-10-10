# claude-plugins

A Claude Code plugin marketplace (`marioaer-plugins`) hosting several plugins. Each plugin lives under `plugins/<name>/` with its own README, license, tests and docs.

| Plugin | Description | License |
|---|---|---|
| [backlog](plugins/backlog) | Capture deferred tasks mid-session into an untracked project backlog without interrupting the current task. | MIT |
| [skim](plugins/skim) | Keep bulk file contents out of the main model's context: a read guard that teaches outlining first, and a Haiku worker for what still needs the whole file. | MIT |

## Installation

Add the marketplace once, then install the plugins you want:

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install backlog@marioaer-plugins
/plugin install skim@marioaer-plugins
```

From a shell: `claude plugin marketplace add MarioAer/claude-plugins` and `claude plugin install <plugin>@marioaer-plugins`. Run `/reload-plugins` to apply changes in a running session.

Updates: `claude plugin update <plugin>@marioaer-plugins`, or enable auto-update for the marketplace in `/plugin`.

`skim` was previously published from the now-archived `MarioAer/claude-skim` repository. If you added that marketplace, remove it and install from here: `/plugin marketplace remove claude-skim`, then the two commands above.

## Plugins

Each plugin has its own README with usage, permissions and design notes:

- [backlog](plugins/backlog/README.md)
- [skim](plugins/skim/README.md)

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace; every plugin is a local source under plugins/
plugins/<name>/                   what an install copies: manifest, README, LICENSE, components
plugins/<name>/tests/run.sh       unit suite, no API calls; run by tests/unit.sh and CI
plugins/<name>/tests/e2e.sh       behavioral scenarios that call the Claude API; manual (where present)
plugins/<name>/docs/              reference docs for that plugin (where present)
plugins/<name>/evals/             benchmark harness for that plugin (where present)
docs/superpowers/                 design specs and implementation plans
tests/                            repository-wide checks
```

## Development

| Command | Purpose |
|---|---|
| `bash tests/validate.sh` | Structural tests over the marketplace and every plugin: manifests, names, frontmatter, hooks, README, licenses, `claude plugin validate --strict`. Runs in CI. |
| `bash tests/unit.sh` | Runs every `plugins/<name>/tests/run.sh`. Runs in CI, after ShellCheck over all shell scripts. |
| `plugins/<name>/tests/e2e.sh` | Headless behavioral scenarios for one plugin (where present). Calls the Claude API; not run in CI. |

Load a working copy without installing: `claude --plugin-dir ./plugins/<name>`.

Adding a plugin: create `plugins/<name>/` with `.claude-plugin/plugin.json`, `README.md`, `LICENSE` and `tests/run.sh`, add an entry to the marketplace, add the install line above. `tests/validate.sh` reports anything missing.

### Releasing

A plugin's `version` in `plugin.json` pins installed users to that version: they receive changes only after it is raised. For every change that users should receive:

1. Raise `version` in `plugins/<plugin>/.claude-plugin/plugin.json` in the same pull request.
2. After the squash merge, tag the merge commit and publish a release with notes generated from the merged pull requests:

```
git tag -s <plugin>-v<version> -m "<plugin> <version>" && git push origin <plugin>-v<version>
gh release create <plugin>-v<version> --generate-notes --title "<plugin> <version>"
```

Each plugin is versioned and released independently.

## Security

See [SECURITY.md](SECURITY.md) for supported versions and private vulnerability reporting.

## License

The repository and every plugin are [MIT](LICENSE). Each plugin also ships its own copy in `plugins/<name>/LICENSE`, because an install copies only the plugin directory.
