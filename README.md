# claude-plugins

A Claude Code plugin marketplace (`marioaer-plugins`) hosting several plugins. Each plugin lives under `plugins/<name>/` with its own README, license, tests and docs.

| Plugin | Description | License |
|---|---|---|
| [todo](plugins/todo) | Capture deferred tasks mid-session into an untracked project todo list without interrupting the current task. | MIT |
| [geparkt](plugins/geparkt) | Keep track of the questions Claude asks and the topics it parks, so none get lost down a rabbit hole. | MIT |
| [skim](plugins/skim) | Keep bulk file contents out of the main model's context: a read guard that teaches outlining first, and a Haiku worker for what still needs the whole file. | MIT |

## Installation

Add the marketplace once, then install the plugins you want:

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install todo@marioaer-plugins
/plugin install skim@marioaer-plugins
/plugin install geparkt@marioaer-plugins
```

From a shell: `claude plugin marketplace add MarioAer/claude-plugins` and `claude plugin install <plugin>@marioaer-plugins`. Run `/reload-plugins` to apply changes in a running session.

Updates: `claude plugin update <plugin>@marioaer-plugins`, or enable auto-update for the marketplace in `/plugin`.

`skim` was previously published from the now-archived `MarioAer/claude-skim` repository. If you added that marketplace, remove it and install from here: `/plugin marketplace remove claude-skim`, then the two commands above.

## Plugins

Each plugin has its own README with usage, permissions and design notes:

- [todo](plugins/todo/README.md)
- [skim](plugins/skim/README.md)
- [geparkt](plugins/geparkt/README.md)

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace; every plugin is a local source under plugins/
plugins/<name>/                   what an install copies: manifest, README, LICENSE, components
plugins/<name>/tests/run.sh       unit suite, no API calls; run by tests/unit.sh and CI
plugins/<name>/tests/e2e.sh       behavioral scenarios that call the Claude API; manual (where present)
plugins/<name>/docs/              reference docs for that plugin (where present)
plugins/<name>/evals/             benchmark harness for that plugin (where present)
tests/                            repository-wide checks
mise.toml, mise.lock, .mise/tasks dev tools and tasks (see Development)
```

## Development

Tools and tasks come from [mise](https://mise.jdx.dev). Once per clone:

```
mise run setup    # installs the pinned tools (mise.lock) and a git pre-commit hook running lint + validate
```

| Task | Purpose |
|---|---|
| `mise run check` | Everything CI runs: `lint`, `validate` and `test`. |
| `mise run lint` | ShellCheck and an shfmt check over every shell script (`mise run fmt` rewrites them; style in `.editorconfig`). |
| `mise run validate` | `tests/validate.sh`: structural tests over the marketplace and every plugin: manifests, names, frontmatter, hooks, README, licenses, `claude plugin validate --strict`. |
| `mise run test` | `tests/unit.sh`: runs every `plugins/<name>/tests/run.sh`. |
| `mise run test:e2e <plugin> [scenario…]` | Headless behavioral scenarios for one plugin (where present). Calls the Claude API; not run in CI. |
| `mise run bump <plugin> <patch\|minor\|major>` | Raises the plugin's `version`. |
| `mise run release <plugin>` | Tags the plugin's current version on `main` (see Releasing). |

Python is pinned to 3.9, the oldest `python3` the hooks support, so tests catch syntax only newer versions accept. `claude` and `gh` are pinned only inside the tasks that need them, so your own installs are never shadowed. Renovate keeps the pins and `mise.lock` current.

Load a working copy without installing: `claude --plugin-dir ./plugins/<name>`.

Adding a plugin: create `plugins/<name>/` with `.claude-plugin/plugin.json`, `README.md`, `LICENSE` and `tests/run.sh`, add an entry to the marketplace, add the install line above. `tests/validate.sh` reports anything missing.

### Releasing

A plugin's `version` in `plugin.json` pins installed users to that version: they receive changes only after it is raised. For every change that users should receive:

1. Raise the version in the same pull request: `mise run bump <plugin> <level>`.
2. After the squash merge, on an up-to-date `main`: `mise run release <plugin>`. It refuses unless the tree is clean, `main` matches `origin/main`, CI passed on that commit and the tag is new, then pushes a signed `<plugin>-v<version>` tag.
3. The `release` workflow checks the tag against `plugin.json` and `main`, runs `mise run check`, and publishes the GitHub release with notes generated since the plugin's previous tag.

Each plugin is versioned and released independently.

## Security

See [SECURITY.md](SECURITY.md) for supported versions and private vulnerability reporting.

## License

The repository and every plugin are [MIT](LICENSE). Each plugin also ships its own copy in `plugins/<name>/LICENSE`, because an install copies only the plugin directory.
