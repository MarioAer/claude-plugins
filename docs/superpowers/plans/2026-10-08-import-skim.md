# Import skim into the multi-plugin repository: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `skim` plugin from `MarioAer/claude-skim` into this repository as `plugins/skim`, make both plugins share one layout, CI and release procedure, and retire the old repository.

**Architecture:** Each plugin is self-contained under `plugins/<name>/` (manifest, README, LICENSE, components, `tests/`, `docs/`, and for skim `evals/`). Repository-wide material stays at the root: `tests/validate.sh` (structural checks over every plugin), `tests/unit.sh` (runs every `plugins/*/tests/run.sh`), `docs/superpowers/` (specs and plans), one CI workflow. Skim's files are copied, not merged with history; the old repository is archived with a notice and deleted later by hand.

**Tech Stack:** Bash, jq, python3, ShellCheck, `claude plugin validate --strict`, GitHub Actions, `gh`.

**Spec:** No separate spec file was written. The design was agreed in chat on 2026-10-08 and is recorded in the Design Summary below; the plan argues from it.

## Design Summary

| Decision | Value |
|---|---|
| History | Copy files only. The repository allows squash merges only; skim's history stays in the archived old repository. |
| License | Per plugin. `plugins/skim/LICENSE` stays Apache-2.0, `plugins/backlog/LICENSE` stays MIT, root `LICENSE` (MIT) covers repository-level files. CI checks that `plugin.json` `license` matches the LICENSE text. |
| Layout | Plugin-local: `plugins/<name>/tests/run.sh` is the unit entry point, `tests/e2e.sh` is the manual API-calling suite, `docs/` holds reference docs, skim adds `evals/`. Design specs live in `docs/superpowers/specs/`. |
| Version | `version` lives in `plugin.json` only (setting it in the marketplace entry as well fails `--strict`). Skim ships here as `0.1.1`. |
| Release | Raising `version` is what delivers an update. Tag `<plugin>-v<version>` plus a GitHub release stays as the changelog layer, unchanged from the README. |
| Old repository | Final commit replaces the README with a deprecation notice, removes Dependabot config; close Dependabot PR #6; archive. Delete later by hand. The plugin name `skim` is unchanged, so no `renames` entry is needed; the marketplace name changes, so users must remove `claude-skim` and reinstall from `marioaer-plugins`. |
| CI | One workflow: ShellCheck over all `.sh`, `tests/validate.sh` with the official validator in strict mode, `tests/unit.sh`. Skim's "Use when" description lint is dropped (C8 covers frontmatter). |

## Global Constraints

- Never commit to `main`. All work on branch `chore/import-skim`. The PR is squash-merged.
- Commit messages: conventional commit, no ticket scope (open-source repository), whole message at most 250 characters, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Each commit is a standalone `git commit -m "..." -m "..." --trailer "..."` call: no `cd`, `&&`, `git -C`, redirects or `$(...)` in that call.
- No new Markdown files beyond those this plan names (the moved spec, the moved scenarios file, this plan).
- The plugin name `skim` and the marketplace name `marioaer-plugins` are immutable.
- `tests/validate.sh` must pass with 0 failures, `tests/unit.sh` must pass, ShellCheck must be clean, `claude plugin validate <target> --strict` must pass for `.`, `plugins/backlog`, `plugins/skim`, before every commit that touches them.
- Hook wiring keeps `${CLAUDE_PLUGIN_ROOT}` paths; test scripts resolve paths relative to their own plugin directory, never to the repository root.
- Temporary files go under `$TMPDIR`.
- `SRC` in every task means the fresh clone of the old repository created in Task 0.

## Review Focus

1. **A user who installed skim from the old `claude-skim` marketplace** expects to keep receiving updates. They will not; the deprecation notice (Task 8) must carry the three commands to remove, add and install. Pinned to Task 8 step 2.
2. **A plugin test script run from a different working directory** (`bash plugins/skim/tests/run.sh` from the repository root, or from `/`) must still find its hook and reporter. Pinned to Task 1 step 5 and Task 4 step 9, which run the suites from `/`.
3. **Relative links in the moved spec and docs** silently break on GitHub. Pinned to Task 4 step 12, which resolves every relative Markdown link under `docs/` and `plugins/` and fails on a missing target.
4. **`claude plugin validate --strict` rejects unknown top-level manifest fields.** The skim manifest gains `repository`; the check must run after the edit. Pinned to Task 4 step 10.
5. **A plugin directory without `tests/run.sh`** would be skipped silently by `tests/unit.sh`. C14 in Task 3 fails the structural suite for such a plugin, so the runner's `continue` can never hide a missing suite.

---

### Task 0: Branch and source clone

**Files:**
- None in the repository.

**Interfaces:**
- Produces: branch `chore/import-skim`; environment variable `SRC` pointing at a clean clone of `MarioAer/claude-skim` at its current `main`.

- [ ] **Step 1: Create the branch from an up-to-date main**

```bash
git -C /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins fetch origin
git -C /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins switch -c chore/import-skim origin/main
git -C /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins branch --show-current
```
Expected: `chore/import-skim`.

- [ ] **Step 2: Clone the old repository into the scratchpad**

```bash
SRC="$TMPDIR/claude-skim"
rm -rf "$SRC"
git clone -q https://github.com/MarioAer/claude-skim.git "$SRC"
git -C "$SRC" log --oneline -1
```
Expected: `fbb26b6 chore: add security & repo hygiene files (#5)`. If the hash differs, the old repository changed after planning; read the new commits before continuing.

- [ ] **Step 3: Confirm the baseline is green**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
bash tests/validate.sh | tail -1
bash tests/hooks.sh | tail -1
bash "$SRC/tests/run-tests.sh" | tail -1
```
Expected: `14 passed, 0 failed`, the hooks suite ends `... 0 failed`, skim ends `passed: 21   failed: 0`.

---

### Task 1: Move backlog's tests into the plugin directory

**Files:**
- Move: `tests/hooks.sh` to `plugins/backlog/tests/run.sh`
- Move: `tests/backlog-e2e.sh` to `plugins/backlog/tests/e2e.sh`
- Move: `tests/backlog-scenarios.md` to `plugins/backlog/tests/scenarios.md`
- Modify: `.github/workflows/validate.yml:21-22`
- Modify: `README.md` (Development table)

**Interfaces:**
- Produces: the convention `plugins/<name>/tests/run.sh` (unit suite, no API calls, exit 0 on success) and `plugins/<name>/tests/e2e.sh` (manual, calls the Claude API). Tasks 2, 3 and 4 depend on this convention.

- [ ] **Step 1: Move the three files with git so renames are tracked**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
mkdir -p plugins/backlog/tests
git mv tests/hooks.sh plugins/backlog/tests/run.sh
git mv tests/backlog-e2e.sh plugins/backlog/tests/e2e.sh
git mv tests/backlog-scenarios.md plugins/backlog/tests/scenarios.md
```

- [ ] **Step 2: Run the moved unit suite to see it fail on the old paths**

```bash
bash plugins/backlog/tests/run.sh | tail -3
```
Expected: every case reports `FAIL` or the script errors, because `$ROOT/plugins/backlog/hooks/...` now resolves to `plugins/backlog/plugins/backlog/hooks/...`.

- [ ] **Step 3: Point the unit suite at its own plugin root**

In `plugins/backlog/tests/run.sh` change the header and the two hook paths. `ROOT` now resolves to `plugins/backlog`.

Old:
```bash
# Unit tests for plugin hook scripts. Exit 0 on success, 1 on failure.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/plugins/backlog/hooks/allow-backlog-write.sh"
```
New:
```bash
# Unit tests for the backlog hook scripts. Exit 0 on success, 1 on failure.
# Usage: bash plugins/backlog/tests/run.sh   (ROOT is the plugin directory)
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/hooks/allow-backlog-write.sh"
```
Old (near the end of the file):
```bash
SESSION_HOOK="$ROOT/plugins/backlog/hooks/session-start.sh"
```
New:
```bash
SESSION_HOOK="$ROOT/hooks/session-start.sh"
```

- [ ] **Step 4: Point the e2e script and scenarios at the new paths**

In `plugins/backlog/tests/e2e.sh`:

Old:
```bash
# Usage: tests/backlog-e2e.sh [scenario-id ...]   (default: all)
```
New:
```bash
# Usage: plugins/backlog/tests/e2e.sh [scenario-id ...]   (default: all)
```
Old:
```bash
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLUGIN="$ROOT/plugins/backlog"
```
New:
```bash
PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
```
Old:
```bash
# --- Scenarios (IDs match tests/backlog-scenarios.md) ---
```
New:
```bash
# --- Scenarios (IDs match tests/scenarios.md next to this script) ---
```

In `plugins/backlog/tests/scenarios.md` replace every `tests/backlog-e2e.sh` with `plugins/backlog/tests/e2e.sh` (three occurrences in the first ten lines; confirm with `grep -n backlog-e2e plugins/backlog/tests/scenarios.md` that none remain).

- [ ] **Step 5: Run the unit suite from two working directories**

```bash
bash plugins/backlog/tests/run.sh | tail -1
(cd / && bash /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins/plugins/backlog/tests/run.sh | tail -1)
grep -rn 'backlog-e2e\|tests/hooks.sh\|backlog-scenarios' --include='*.sh' --include='*.md' --include='*.yml' . | grep -v '^./.git/' | grep -v '^./docs/superpowers/plans/'
```
Expected: both runs end with `0 failed`; the grep prints only `README.md` and `.github/workflows/validate.yml` lines (fixed next).

- [ ] **Step 6: Update the workflow and the README table**

In `.github/workflows/validate.yml`:

Old:
```yaml
      - name: Hook tests
        run: bash tests/hooks.sh
```
New:
```yaml
      - name: Hook tests
        run: bash plugins/backlog/tests/run.sh
```
(Task 2 replaces this step with `tests/unit.sh`; keeping CI green per commit is the point here.)

In `README.md` replace the Development table with:

```markdown
| Command | Purpose |
|---|---|
| `bash tests/validate.sh` | Structural tests: manifests, names, frontmatter, hooks, README, `claude plugin validate`. Runs in CI. |
| `bash plugins/backlog/tests/run.sh` | Unit tests for the backlog hook scripts. Runs in CI. |
| `plugins/backlog/tests/e2e.sh [ID ...]` | Headless behavioral scenarios against the working copy. Calls the Claude API; `MODEL` defaults to `sonnet`. |
| `plugins/backlog/tests/scenarios.md` | All scenarios, including the ones that need an interactive session. |
```

- [ ] **Step 7: Verify and commit**

```bash
bash tests/validate.sh | tail -1
find . -name '*.sh' -not -path './.git/*' -print0 | xargs -0 shellcheck && echo SHELLCHECK_OK
git add -A
git status --short
```
Expected: `14 passed, 0 failed`, `SHELLCHECK_OK`, status shows three renames (`R`) plus `M README.md` and `M .github/workflows/validate.yml`.

```bash
git commit -m "chore: move backlog tests into the plugin directory" -m "Each plugin carries its own tests/run.sh so both plugins share one layout and a single runner can execute every suite." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared unit runner and CI (ShellCheck, strict validation)

**Files:**
- Create: `tests/unit.sh`
- Modify: `tests/validate.sh` (C9 block, add `--strict`)
- Modify: `.github/workflows/validate.yml`
- Modify: `README.md` (Development table)

**Interfaces:**
- Consumes: `plugins/<name>/tests/run.sh` from Task 1.
- Produces: `bash tests/unit.sh` (exit 0 only if every suite exits 0); C9 now runs `claude plugin validate <target> --strict`.

- [ ] **Step 1: Write the failing check for the runner**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
bash tests/unit.sh; echo "exit=$?"
```
Expected: `bash: tests/unit.sh: No such file or directory`, `exit=127`.

- [ ] **Step 2: Create the runner**

`tests/unit.sh`:
```bash
#!/usr/bin/env bash
# Runs every plugin's unit suite (plugins/<name>/tests/run.sh) and exits 0 only
# if all of them pass. Suites that call the Claude API (tests/e2e.sh) are not
# run here. tests/validate.sh C14 fails for a plugin that has no tests/run.sh.
set -u

cd "$(dirname "$0")/.." || exit 2

status=0
for suite in plugins/*/tests/run.sh; do
  [ -f "$suite" ] || continue
  echo "== $suite"
  bash "$suite" || status=1
  echo
done
exit "$status"
```

- [ ] **Step 3: Prove the runner propagates a failure**

```bash
bash tests/unit.sh | tail -2; echo "exit=${PIPESTATUS[0]}"
mkdir -p "$TMPDIR/fail-plugin/tests" && printf 'exit 1\n' > "$TMPDIR/fail-plugin/tests/run.sh"
cp -R "$TMPDIR/fail-plugin" plugins/zz-fail
bash tests/unit.sh >/dev/null; echo "exit=$?"
rm -rf plugins/zz-fail
```
Expected: first `exit=0`; after the fake plugin `exit=1`; the fake plugin is removed.

- [ ] **Step 4: Make C9 strict**

In `tests/validate.sh`:

Old:
```bash
    if output=$(claude plugin validate "$target" 2>&1); then
```
New:
```bash
    if output=$(claude plugin validate "$target" --strict 2>&1); then
```
Also change the header comment line `# Set VALIDATE_SKIP_CLI=1 to skip the 'claude plugin validate' check (C9).` to `# Set VALIDATE_SKIP_CLI=1 to skip the 'claude plugin validate --strict' check (C9).`

```bash
bash tests/validate.sh | grep C9
```
Expected: `PASS C9 [.]` and `PASS C9 [plugins/backlog/]`.

- [ ] **Step 5: Rewrite the workflow**

`.github/workflows/validate.yml`:
```yaml
name: validate

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: ShellCheck
        run: |
          command -v shellcheck >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq shellcheck; }
          find . -name '*.sh' -not -path './.git/*' -print0 | xargs -0 shellcheck
      - name: Install Claude Code
        run: npm install -g @anthropic-ai/claude-code
      - name: Structural tests
        run: bash tests/validate.sh
      - name: Unit tests
        run: bash tests/unit.sh
```
The job is renamed from `structure` to `validate`. If `main` has a required status check named `structure`, update the ruleset after merge (`gh api repos/MarioAer/claude-plugins/rulesets` lists it); note this in the PR description.

- [ ] **Step 6: Update the README Development table**

Replace the table from Task 1 step 6 with:
```markdown
| Command | Purpose |
|---|---|
| `bash tests/validate.sh` | Structural tests over the marketplace and every plugin: manifests, names, frontmatter, hooks, README, licenses, `claude plugin validate --strict`. Runs in CI. |
| `bash tests/unit.sh` | Runs every `plugins/<name>/tests/run.sh`. Runs in CI, after ShellCheck over all shell scripts. |
| `plugins/<name>/tests/e2e.sh` | Headless behavioral scenarios for one plugin. Calls the Claude API; not run in CI. |
```

- [ ] **Step 7: Verify and commit**

```bash
bash tests/validate.sh | tail -1
bash tests/unit.sh | tail -2
find . -name '*.sh' -not -path './.git/*' -print0 | xargs -0 shellcheck && echo SHELLCHECK_OK
git add tests/unit.sh tests/validate.sh .github/workflows/validate.yml README.md
```
```bash
git commit -m "ci: run ShellCheck, strict plugin validation and every plugin unit suite" -m "tests/unit.sh runs plugins/*/tests/run.sh; C9 uses --strict so unknown manifest fields fail in CI." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Structural checks for the per-plugin convention (C14, C15)

**Files:**
- Modify: `tests/validate.sh` (inside the `for dir in plugins/*/` loop, after the C13 block)

**Interfaces:**
- Produces: C14 (`tests/run.sh` present), C15 (`plugin.json` `license` is `MIT` or `Apache-2.0` and the LICENSE file text matches). Task 4 must satisfy both for `plugins/skim`.

- [ ] **Step 1: Write the failing fixture runs**

`validate.sh` operates on the directory above its own, so copy the repository and break the fixture:

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
rm -rf "$TMPDIR/fx" && mkdir -p "$TMPDIR/fx" && git archive HEAD | tar -x -C "$TMPDIR/fx"
rm "$TMPDIR/fx/plugins/backlog/tests/run.sh"
printf 'Apache License Version 2.0\n' > "$TMPDIR/fx/plugins/backlog/LICENSE"
VALIDATE_SKIP_CLI=1 bash "$TMPDIR/fx/tests/validate.sh" | grep -E 'C1[45]'
```
Expected: no output (the checks do not exist yet).

- [ ] **Step 2: Add the checks**

Insert into `tests/validate.sh` directly after the C13 block (after its `fi`), before the `# C12:` comment:

```bash
  # C14: plugin ships its unit suite; tests/unit.sh and CI run every plugins/*/tests/run.sh
  if [ -f "${dir}tests/run.sh" ]; then
    pass "C14 [$plugin]"
  else
    fail "C14 [$plugin]" "tests/run.sh not found"
  fi

  # C15: plugin.json license names the license the plugin ships
  license=$(jq -r '.license // ""' "$manifest")
  case "$license" in
    MIT) license_marker="MIT License" ;;
    Apache-2.0) license_marker="Apache License" ;;
    *) license_marker="" ;;
  esac
  if [ -z "$license" ]; then
    fail "C15 [$plugin]" "plugin.json lacks license"
  elif [ -z "$license_marker" ]; then
    fail "C15 [$plugin]" "license '$license' is not MIT or Apache-2.0; extend C15 if a new license is intended"
  elif [ ! -f "${dir}LICENSE" ]; then
    skip "C15 [$plugin]" "no LICENSE file (reported by C13)"
  elif grep -Fq "$license_marker" "${dir}LICENSE"; then
    pass "C15 [$plugin]"
  else
    fail "C15 [$plugin]" "LICENSE text does not contain '$license_marker' for license '$license'"
  fi
```

- [ ] **Step 3: Run the fixture and the real tree**

```bash
rm -rf "$TMPDIR/fx" && mkdir -p "$TMPDIR/fx" && git archive HEAD | tar -x -C "$TMPDIR/fx"
cp tests/validate.sh "$TMPDIR/fx/tests/validate.sh"
rm "$TMPDIR/fx/plugins/backlog/tests/run.sh"
printf 'Apache License Version 2.0\n' > "$TMPDIR/fx/plugins/backlog/LICENSE"
VALIDATE_SKIP_CLI=1 bash "$TMPDIR/fx/tests/validate.sh" | grep -E 'C1[45]'
head -1 plugins/backlog/LICENSE
bash tests/validate.sh | grep -E 'C1[45]|passed'
```
Expected: fixture prints `FAIL C14 [backlog]: tests/run.sh not found` and `FAIL C15 [backlog]: LICENSE text does not contain 'MIT License' ...`; the real LICENSE's first line is `MIT License`; the real tree prints `PASS C14 [backlog]`, `PASS C15 [backlog]` and `16 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
shellcheck tests/validate.sh && echo SHELLCHECK_OK
git add tests/validate.sh
```
```bash
git commit -m "test: require tests/run.sh and a matching LICENSE in every plugin" -m "Plugins carry different licenses from now on, so the manifest and the shipped file must agree." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Import skim

**Files:**
- Create: `plugins/skim/.claude-plugin/plugin.json`, `plugins/skim/LICENSE`, `plugins/skim/README.md`, `plugins/skim/agents/bulk-reader.md`, `plugins/skim/hooks/hooks.json`, `plugins/skim/hooks/guard-read.sh`, `plugins/skim/skills/reading-large-files/SKILL.md`, `plugins/skim/skills/report/SKILL.md`, `plugins/skim/skills/report/report.sh`
- Create: `plugins/skim/tests/run.sh` (from `tests/run-tests.sh`), `plugins/skim/tests/report.sh` (from `tests/report-tests.sh`)
- Create: `plugins/skim/evals/{README.md,gen-corpus.sh,gen-crossfile.sh,measure.py,scenarios.md}`
- Create: `plugins/skim/docs/benchmark.md`, `plugins/skim/docs/mechanisms.md`
- Create: `docs/superpowers/specs/2026-09-22-skim-design.md`
- Modify: `.claude-plugin/marketplace.json`, `.gitignore` (create)
- Not copied from `SRC`: `.claude-plugin/marketplace.json`, `SECURITY.md`, `.github/`, `.gitignore`

**Interfaces:**
- Consumes: C14/C15 from Task 3, the unit runner from Task 2.
- Produces: marketplace entry `skim` with source `./plugins/skim`, version `0.1.1`.

- [ ] **Step 1: Write the failing structural run**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
mkdir -p plugins/skim
bash tests/validate.sh | grep -E 'skim|passed'
rmdir plugins/skim
```
Expected: `FAIL C3 [skim]: plugins/skim/.claude-plugin/plugin.json missing or not valid JSON` and a non-zero failure count.

- [ ] **Step 2: Copy the plugin, tests, evals and docs**

```bash
mkdir -p plugins/skim/.claude-plugin plugins/skim/tests plugins/skim/docs docs/superpowers/specs
cp "$SRC/.claude-plugin/plugin.json" plugins/skim/.claude-plugin/plugin.json
cp "$SRC/LICENSE" "$SRC/README.md" plugins/skim/
cp -R "$SRC/agents" "$SRC/hooks" "$SRC/skills" "$SRC/evals" plugins/skim/
cp "$SRC/tests/run-tests.sh" plugins/skim/tests/run.sh
cp "$SRC/tests/report-tests.sh" plugins/skim/tests/report.sh
cp "$SRC/docs/benchmark.md" "$SRC/docs/mechanisms.md" plugins/skim/docs/
cp "$SRC/docs/superpowers/specs/2026-09-22-skim-design.md" docs/superpowers/specs/
printf 'plugins/skim/evals/corpus/\n' > .gitignore
find plugins/skim -type f | sort
```
Expected: 17 files under `plugins/skim` (manifest, LICENSE, README, 1 agent, 2 hook files, 3 skill files, 2 tests, 5 evals, 2 docs) and no `corpus/` directory.

- [ ] **Step 3: Fix the test scripts' internal references**

`ROOT` in both scripts resolves to `plugins/skim`, which is the plugin root, so `GUARD` and `REPORT` already point at the right files. Only the chained call and the usage comments change.

`plugins/skim/tests/run.sh`:

Old:
```bash
# Usage: bash tests/run-tests.sh
```
New:
```bash
# Usage: bash plugins/skim/tests/run.sh
```
Old (last lines):
```bash
# The reporter has its own fixtures; run them here so CI needs one entry point.
echo
bash "$ROOT/tests/report-tests.sh"
```
New:
```bash
# The reporter has its own fixtures; run them here so CI needs one entry point.
echo
bash "$ROOT/tests/report.sh"
```

`plugins/skim/tests/report.sh`:

Old:
```bash
# Usage: bash tests/report-tests.sh
```
New:
```bash
# Usage: bash plugins/skim/tests/report.sh
```

- [ ] **Step 4: Fix eval and doc references**

`plugins/skim/evals/README.md`:

Old:
```markdown
This is the skill benchmark, not the guard unit tests. The guard's fixture suite
belongs at `tests/run-tests.sh`, which CI runs when it exists.
```
New:
```markdown
This is the skill benchmark, not the guard unit tests. The guard's fixture suite
is `../tests/run.sh`, which CI runs through `tests/unit.sh` at the repository root.
```
Old:
```bash
bash evals/gen-corpus.sh
```
New:
```bash
bash plugins/skim/evals/gen-corpus.sh
```
Old:
```bash
python3 evals/measure.py <transcript.jsonl> [more...]
```
New:
```bash
python3 plugins/skim/evals/measure.py <transcript.jsonl> [more...]
```
The sentence `Then dispatch subagents against `evals/corpus`` becomes `Then dispatch subagents against `plugins/skim/evals/corpus``.

`plugins/skim/evals/gen-corpus.sh` header comment:

Old:
```bash
# Usage: bash evals/gen-corpus.sh [output-dir]   (default: evals/corpus)
```
New:
```bash
# Usage: bash plugins/skim/evals/gen-corpus.sh [output-dir]   (default: evals/corpus next to this script)
```

`plugins/skim/docs/benchmark.md` and `plugins/skim/docs/mechanisms.md`: the relative links `../evals/README.md` still resolve (docs and evals are siblings under the plugin). No change.

- [ ] **Step 5: Fix the moved spec's links and repository line**

`docs/superpowers/specs/2026-09-22-skim-design.md`:

Old (lines 5-10):
```markdown
Status: partly superseded by measurement. Read
[`docs/benchmark.md`](../../benchmark.md) and
[`docs/mechanisms.md`](../../mechanisms.md) alongside this document; where they
disagree with it, they win, because they record what was observed.
Repository: https://github.com/MarioAer/claude-skim
License: Apache-2.0
```
New:
```markdown
Status: partly superseded by measurement. Read
[`docs/benchmark.md`](../../../plugins/skim/docs/benchmark.md) and
[`docs/mechanisms.md`](../../../plugins/skim/docs/mechanisms.md) alongside this document; where they
disagree with it, they win, because they record what was observed.
Repository: https://github.com/MarioAer/claude-plugins (moved 2026-10-08 from
MarioAer/claude-skim; paths in this document are relative to `plugins/skim/`)
License: Apache-2.0
```
Old (inside the section 11 revision note):
```markdown
> [`docs/benchmark.md`](../../benchmark.md) and the harness in
> [`evals/`](../../../evals/README.md). The `Explore` arm has not been run, so
```
New:
```markdown
> [`docs/benchmark.md`](../../../plugins/skim/docs/benchmark.md) and the harness in
> [`evals/`](../../../plugins/skim/evals/README.md). The `Explore` arm has not been run, so
```

- [ ] **Step 6: Update the plugin manifest**

`plugins/skim/.claude-plugin/plugin.json`:
```json
{
  "name": "skim",
  "description": "Keeps bulk file contents out of the main model's context: a read guard that teaches outlining first, and a Haiku worker for questions that still need the whole file.",
  "version": "0.1.1",
  "license": "Apache-2.0",
  "homepage": "https://github.com/MarioAer/claude-plugins/tree/main/plugins/skim",
  "repository": "https://github.com/MarioAer/claude-plugins",
  "author": {
    "name": "Mario Erazo",
    "url": "https://github.com/MarioAer"
  },
  "keywords": [
    "token-optimization",
    "context-management",
    "model-routing",
    "delegation"
  ]
}
```

- [ ] **Step 7: Update the skim README**

`plugins/skim/README.md`:

Old:
```markdown
# skim

A Claude Code plugin that keeps bulk file contents out of the main model's
context.
```
New:
```markdown
# skim

A Claude Code plugin from the [`marioaer-plugins`](https://github.com/MarioAer/claude-plugins)
marketplace. It keeps bulk file contents out of the main model's context.
```
Old:
```markdown
```
/plugin marketplace add MarioAer/claude-skim
/plugin install skim
```

Or for one session: `claude --plugin-dir /path/to/claude-skim`
```
New:
```markdown
```
/plugin marketplace add MarioAer/claude-plugins
/plugin install skim@marioaer-plugins
```

Or for one session from a checkout: `claude --plugin-dir ./plugins/skim`
```
Old:
```markdown
```bash
bash tests/run-tests.sh              # 18 guard fixtures, no Claude process needed
claude plugin validate . --strict
```
```
New:
```markdown
From the repository root:

```bash
bash plugins/skim/tests/run.sh       # guard and reporter fixtures, no Claude process needed
claude plugin validate plugins/skim --strict
```
```
Old:
```markdown
## License

Apache-2.0.
```
New:
```markdown
## License

[Apache-2.0](LICENSE). Other plugins in the marketplace carry their own license.
```
The links `docs/benchmark.md`, `docs/mechanisms.md` and `evals/README.md` in the README are relative to the plugin directory and remain valid.

- [ ] **Step 8: Register skim in the marketplace**

`.claude-plugin/marketplace.json`:
```json
{
  "name": "marioaer-plugins",
  "description": "Claude Code plugins by MarioAer",
  "owner": {
    "name": "Mario Erazo"
  },
  "plugins": [
    {
      "name": "backlog",
      "source": "./plugins/backlog",
      "description": "Capture deferred tasks mid-session into an untracked project backlog without interrupting the current task.",
      "category": "productivity"
    },
    {
      "name": "skim",
      "source": "./plugins/skim",
      "description": "Keeps bulk file contents out of the main model's context: a read guard that teaches outlining first, and a Haiku worker for what still needs the whole file.",
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 9: Run skim's suite from two working directories, then the runner**

```bash
bash plugins/skim/tests/run.sh | tail -1
(cd / && bash /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins/plugins/skim/tests/run.sh | tail -1)
bash tests/unit.sh | grep -E '^==|failed'
```
Expected: `passed: 21   failed: 0` twice; the runner lists both suites, each ending with 0 failed.

- [ ] **Step 10: Strict validation and structural suite**

```bash
claude plugin validate plugins/skim --strict
claude plugin validate . --strict
bash tests/validate.sh | grep -E 'skim|passed'
```
Expected: both validations print `Validation passed`; the structural suite prints PASS for C3, C4, C5, C6, C10, C13, C14, C15, C12 `[skim]`, C8 `[skim/reading-large-files]`, C8 `[skim/report]`, C7 `[skim]`, C9 `[plugins/skim/]`; C11 `[skim]` FAILS because the root README has no install line yet (fixed in Task 5). Final line shows exactly 1 failure.

- [ ] **Step 11: ShellCheck**

```bash
find . -name '*.sh' -not -path './.git/*' -print0 | xargs -0 shellcheck && echo SHELLCHECK_OK
```
Expected: `SHELLCHECK_OK`.

- [ ] **Step 12: Resolve every relative Markdown link under docs/ and plugins/**

```bash
python3 - <<'PY'
import pathlib, re, sys
bad = []
for md in list(pathlib.Path("docs").rglob("*.md")) + list(pathlib.Path("plugins").rglob("*.md")):
    for target in re.findall(r"\]\(([^)#\s]+)", md.read_text(encoding="utf-8")):
        if re.match(r"[a-z]+:", target):
            continue
        if not (md.parent / target).exists():
            bad.append(f"{md}: {target}")
print("\n".join(bad) or "all relative links resolve")
sys.exit(1 if bad else 0)
PY
```
Expected: `all relative links resolve`. If a line is printed, fix that link before continuing.

- [ ] **Step 13: Commit**

```bash
git add .gitignore .claude-plugin/marketplace.json plugins/skim docs/superpowers/specs
git status --short | grep -v '^A\|^M' ; echo "(nothing above means only adds and modifications)"
```
```bash
git commit -m "chore: import the skim plugin from MarioAer/claude-skim" -m "Files copied at fbb26b6 without history; the old repository is archived. Version raised to 0.1.1 because homepage and install path changed." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Root documentation for a multi-plugin marketplace

**Files:**
- Modify: `README.md` (full rewrite below)
- Modify: `SECURITY.md` (Scope section)

**Interfaces:**
- Consumes: the marketplace entries from Task 4 (C11 requires the install line for each).

- [ ] **Step 1: Confirm the failing check**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
bash tests/validate.sh | grep C11
```
Expected: `PASS C11 [backlog]`, `FAIL C11 [skim]: README.md lacks '/plugin install skim@marioaer-plugins'`.

- [ ] **Step 2: Rewrite README.md**

```markdown
# claude-plugins

A Claude Code plugin marketplace (`marioaer-plugins`) hosting several plugins. Each plugin lives under `plugins/<name>/` with its own README, license, tests and docs.

| Plugin | Description | License |
|---|---|---|
| [backlog](plugins/backlog) | Capture deferred tasks mid-session into an untracked project backlog without interrupting the current task. | MIT |
| [skim](plugins/skim) | Keep bulk file contents out of the main model's context: a read guard that teaches outlining first, and a Haiku worker for what still needs the whole file. | Apache-2.0 |

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
plugins/<name>/tests/e2e.sh       behavioral scenarios that call the Claude API; manual
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
| `plugins/<name>/tests/e2e.sh` | Headless behavioral scenarios for one plugin. Calls the Claude API; not run in CI. |

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

Repository-level files are [MIT](LICENSE). Each plugin ships its own license file: backlog is MIT, skim is Apache-2.0.
```

- [ ] **Step 3: Update SECURITY.md scope**

Old:
```markdown
In scope are the files in this repository, in particular hooks that make permission decisions, such as `plugins/backlog/hooks/allow-backlog-write.sh`. A finding is in scope if a plugin approves an action that Claude Code would otherwise prompt for, beyond what the plugin documents.
```
New:
```markdown
In scope are the files in this repository, in particular hooks that make permission decisions: `plugins/backlog/hooks/allow-backlog-write.sh` (allows writes) and `plugins/skim/hooks/guard-read.sh` (denies reads, and allows on any internal error). A finding is in scope if a plugin approves an action that Claude Code would otherwise prompt for, beyond what the plugin documents, or if the skim guard can be made to deny something its README says it never blocks.
```

- [ ] **Step 4: Verify and commit**

```bash
bash tests/validate.sh | tail -1
bash tests/unit.sh >/dev/null; echo "unit exit=$?"
git add README.md SECURITY.md
```
Expected: `30 passed, 0 failed` (C1, C2, C7 x2, C11 x2, C9 x3, per plugin C3, C4, C5, C6, C10, C13, C14, C15, C12, plus C8 x1 for backlog and x2 for skim; if the count differs, inspect the FAIL lines, zero failures is the requirement).

```bash
git commit -m "docs: describe the repository as a multi-plugin marketplace" -m "README lists both plugins, the shared layout, per-plugin licenses and the migration from claude-skim; SECURITY.md scopes both permission hooks." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Smoke test the imported plugin in a session (manual, calls the API)

**Files:**
- None.

- [ ] **Step 1: Confirm the plugin loads from the new path**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
claude plugin validate plugins/skim --strict
```
Expected: `Validation passed`.

- [ ] **Step 2: Confirm the guard fires from a session**

```bash
W=$(mktemp -d "$TMPDIR/skim-smoke.XXXXXX")
for i in $(seq 1 400); do echo "export const v$i = $i; // padding"; done > "$W/big.ts"
cd "$W" && claude -p "Use the Read tool to read big.ts in full, then tell me the value of v400." \
  --plugin-dir /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins/plugins/skim \
  --model sonnet --max-turns 4 --permission-mode default --strict-mcp-config --setting-sources project,local
```
Expected: the reply mentions that the full read was blocked by the guard (reason text from `guard-read.sh`) or shows a bounded read or grep, and gives `400`. A reply that lists hundreds of lines means the hook did not run; check `hooks/hooks.json` was copied and stop.

- [ ] **Step 3: Record the result in the PR description** (Task 7). No commit.

---

### Task 7: Pull request

**Files:**
- None.

- [ ] **Step 1: Push and open the PR**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
git log --oneline origin/main..HEAD
git push -u origin chore/import-skim
```
Expected: five commits (Tasks 1 to 5).

```bash
gh pr create --base main --title "chore: import the skim plugin and make the repository multi-plugin" --body "$(cat <<'EOF'
## Goal

Move `skim` from `MarioAer/claude-skim` into this marketplace as `plugins/skim` and give both plugins one layout, one CI workflow and one release procedure.

## Changes

- backlog tests moved into `plugins/backlog/tests/` (`run.sh`, `e2e.sh`, `scenarios.md`)
- `tests/unit.sh` runs every `plugins/*/tests/run.sh`; CI adds ShellCheck and `claude plugin validate --strict`; CI job renamed `structure` to `validate`
- `tests/validate.sh`: C14 (unit suite present), C15 (manifest license matches LICENSE text)
- `plugins/skim` imported at claude-skim `fbb26b6` without history: plugin files, tests, evals, docs; spec moved to `docs/superpowers/specs/`; version 0.1.1, homepage and repository point here
- marketplace entry for skim; README and SECURITY.md describe a multi-plugin repository with per-plugin licenses (backlog MIT, skim Apache-2.0)

## Verification

- `bash tests/validate.sh`: 30 passed, 0 failed
- `bash tests/unit.sh`: both suites pass
- ShellCheck clean; `claude plugin validate --strict` passes for `.`, `plugins/backlog`, `plugins/skim`
- Session smoke test with `--plugin-dir plugins/skim`: guard denied the full read (see Task 6)

## After merge

1. If the ruleset requires the `structure` check, rename it to `validate`.
2. Tag and release `skim-v0.1.1`.
3. Archive `MarioAer/claude-skim` with the deprecation notice.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI**

```bash
gh pr checks --watch
```
Expected: `validate` succeeds. If `npm install -g @anthropic-ai/claude-code` or `claude plugin validate` fails in CI, set `VALIDATE_SKIP_CLI=1` on the structural step as before and note the regression in the PR; do not drop ShellCheck or the unit step.

- [ ] **Step 3: Merge** is the repository owner's action (squash). Stop here and report.

---

### Task 8: Post-merge release and retirement of the old repository

**Files:**
- In `SRC` (the old repository clone): `README.md` rewritten, `.github/dependabot.yml` and `.github/workflows/dependabot-automerge.yml` deleted.

**Interfaces:**
- Consumes: the merged PR on `main`.

- [ ] **Step 1: Release skim from this repository**

```bash
cd /Users/mario.erazo/Code/GitHub/MarioAer/claude-plugins
git switch main && git pull --ff-only
jq -r .version plugins/skim/.claude-plugin/plugin.json
git tag -s skim-v0.1.1 -m "skim 0.1.1" && git push origin skim-v0.1.1
gh release create skim-v0.1.1 --generate-notes --title "skim 0.1.1"
gh repo edit MarioAer/claude-plugins --description "Claude Code plugin marketplace. backlog: capture deferred tasks mid-session. skim: keep bulk file contents out of the main model's context."
```
Expected: version prints `0.1.1`; the release page exists.

- [ ] **Step 2: Write the deprecation notice in the old repository**

Replace the entire `README.md` in `SRC` with:

```markdown
# skim has moved

**This repository is archived.** `skim` is now maintained in the
[`marioaer-plugins`](https://github.com/MarioAer/claude-plugins) marketplace at
[`plugins/skim`](https://github.com/MarioAer/claude-plugins/tree/main/plugins/skim).

Installs from this repository receive no further updates. To migrate:

```
/plugin marketplace remove claude-skim
/plugin marketplace add MarioAer/claude-plugins
/plugin install skim@marioaer-plugins
```

The design spec, benchmark and verified hook mechanisms moved with the code.
Report security issues through the new repository's
[security policy](https://github.com/MarioAer/claude-plugins/blob/main/SECURITY.md).

License: Apache-2.0, unchanged.
```

Remove the Dependabot configuration so no new PRs arrive on an archived repository:

```bash
cd "$SRC"
git switch -c chore/deprecate
git rm .github/dependabot.yml .github/workflows/dependabot-automerge.yml
git add README.md
git status --short
```
Expected: `M README.md`, `D .github/dependabot.yml`, `D .github/workflows/dependabot-automerge.yml`.

```bash
git commit -m "docs: archive this repository; skim moved to MarioAer/claude-plugins" -m "Installs from here receive no updates. The README carries the remove, add and install commands for the new marketplace." --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Merge the notice, close Dependabot, archive**

```bash
cd "$SRC"
git push -u origin chore/deprecate
gh pr create --base main --title "docs: archive this repository; skim moved to MarioAer/claude-plugins" --body "skim now lives at https://github.com/MarioAer/claude-plugins/tree/main/plugins/skim. This is the final commit before archiving.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
gh pr merge --squash --delete-branch
gh pr close 6 -R MarioAer/claude-skim --comment "Repository archived; skim moved to MarioAer/claude-plugins."
gh repo edit MarioAer/claude-skim --description "Archived: skim moved to MarioAer/claude-plugins (plugins/skim)"
gh repo archive MarioAer/claude-skim --yes
gh repo view MarioAer/claude-skim --json isArchived
```
Expected: `{"isArchived":true}`. If the old repository's ruleset blocks the merge, the owner merges in the GitHub UI.

- [ ] **Step 4: Deletion (owner's action, later)**

`gh repo delete MarioAer/claude-skim` needs the `delete_repo` token scope and is irreversible. Run it only after confirming `grep -rn claude-skim` in this repository returns only the migration notes in README.md and the spec header, and after at least one release of skim exists here. Not part of this plan's automated steps.

---

## Self-review

- **Design coverage:** history (Task 4 copies, Task 7 squash), license (Task 3 C15, Task 5 README), layout (Tasks 1, 4), version (Task 4 step 6), release (Task 8 step 1), old repository (Task 8 steps 2 to 4), CI (Task 2). Covered.
- **Placeholders:** none; every edit shows old and new text or the full file.
- **Name consistency:** `tests/unit.sh`, `plugins/<name>/tests/run.sh`, `plugins/<name>/tests/e2e.sh`, `skim-v0.1.1`, C14, C15 are used with the same names in every task.
- **Review Focus:** items 1 to 5 are each pinned to a step above.
