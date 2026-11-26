# skim: `claude plugin eval` suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace skim's hand-run benchmark (dispatch subagents by hand, score transcripts with `measure.py`) with a `claude plugin eval` suite that one command runs with and without the plugin.

**Architecture:** The four scenarios in `plugins/skim/evals/scenarios.md` become four case directories under `plugins/skim/evals/`. Each case generates the corpus into the run's empty workspace through a scaffold script that calls the existing generators, and is scored by graders that hold the answer key. The runner's own no-plugin arm (`--ablation with-without`) replaces the hand-built baseline arm, and its hidden eval directory replaces the manual "copy the corpus somewhere without answers" step.

**Tech Stack:** `claude plugin eval` (Claude Code 2.1.331, pinned per mise task), Bash, python3 3.9 (generators), mise.

**Spec:** None written. This plan argues from the method it replaces: `plugins/skim/evals/README.md`, `plugins/skim/evals/scenarios.md`, `plugins/skim/docs/benchmark.md`, and the eval reference at https://code.claude.com/docs/en/plugin-evals.md. Executors read all four.

## Global Constraints

- `claude plugin eval` needs Claude Code 2.1.269 or later and git 2.31 or later. The mise task pins `tools.claude = "2.1.331"`, as the other tasks do.
- Eval runs call the Claude API and cost money. They never run in `mise run check` or CI. Every invocation passes `--max-cost-usd`.
- 5 runs per arm, model `sonnet`, as the 2026-09-29 benchmark used.
- Prompts are the scenario prompts verbatim except for the corpus location. They never mention reading strategy, file size, delegation, context, or tokens (`scenarios.md`, line 6).
- The corpus is generated, never committed.
- Answer keys live only in grader files under `plugins/skim/evals/<case>/graders/`.
- Every `*.sh` passes `mise run lint` (shellcheck, shfmt). Python stays 3.9-compatible.
- Work on a feature branch. Do not push to `main`.

## What the suite measures, and what changes

| | Hand-run benchmark | This suite |
| --- | --- | --- |
| "With" arm | Prompt preceded by "read and follow the skill" | The whole plugin loaded: skill, read guard, `bulk-reader` |
| "Without" arm | Prompt alone | Same prompt, no plugin |
| Bulk-read signal | `Read` calls with no `limit`/`offset`, counted from transcripts | A line from the middle of each large file appearing in the run's trace |
| Isolation | Manual copy outside the repo | The runner hides the eval directory from the agent |

The bulk-read signal changes on purpose. The guard denies a first unbounded `Read` of a large file, so counting `Read` attempts would mark the plugin down for a read whose content never arrived. A sentinel line in the trace says the content did arrive, whether through `Read`, `cat`, or a second attempt.

## File Structure

```
plugins/skim/evals/
├── README.md                    rewritten: how to run, what each grader means
├── lib/
│   ├── gen-corpus.sh            moved from evals/gen-corpus.sh, unchanged
│   └── gen-crossfile.sh         moved from evals/gen-crossfile.sh, unchanged
├── retrieval/                   scenario 1
├── comprehension/               scenario 2
├── dense-file/                  scenario 3
├── cross-file/                  scenario 4
│   each: prompt.md, case.yaml, fixture.sh, graders/*.md
└── results/                     written by runs; gitignored
plugins/skim/tests/evals.sh      offline checks: case structure, corpus anchors, prompt wording
```

Deleted: `evals/scenarios.md` (prompts move to `prompt.md`, answer keys to graders), `evals/measure.py`.

Modified: `plugins/skim/tests/run.sh`, `mise.toml`, `.gitignore`, `README.md`, `plugins/skim/README.md`, `plugins/skim/docs/benchmark.md`.

## Review Focus

1. **Suite run without `--scaffold`.** The workspace is empty and every case fails for a reason unrelated to the plugin. Expected: the documented command always scaffolds. Pinned in Task 1 (`evals.sh` asserts the mise task passes `--scaffold`).
2. **Generator drift.** A change to `gen-corpus.sh` moves the answer-key lines and the graders keep passing or failing for the wrong reason. Expected: an offline test fails first. Pinned in Task 1 (corpus anchors).
3. **Scaffold under the runner's minimal environment.** The runner gives the script only `PATH`, a temporary `HOME`, `TMPDIR` and `TERM=dumb`. Expected: the corpus still generates. Pinned in Task 1 (`env -i` run).
4. **Prompt contamination.** A later edit adds a word that hints at the behaviour under test. Expected: the offline test rejects it. Pinned in Task 2 (banned-word check).
5. **Delegation read as a bulk read.** If the trace includes a `bulk-reader` subagent's tool results, a correct delegation trips the sentinel. No offline test can show this. The reviewer checks the first run in which `Agent` was called (Task 4, step 3).

---

### Task 1: Generators in `lib/`, the retrieval case, and one paid probe run

**Files:**
- Move: `plugins/skim/evals/gen-corpus.sh` → `plugins/skim/evals/lib/gen-corpus.sh`
- Move: `plugins/skim/evals/gen-crossfile.sh` → `plugins/skim/evals/lib/gen-crossfile.sh`
- Create: `plugins/skim/evals/retrieval/{prompt.md,case.yaml,fixture.sh}`
- Create: `plugins/skim/evals/retrieval/graders/{value,location,override,no-bulk-retry-policy,skill-fired}.md`
- Create: `plugins/skim/tests/evals.sh`
- Modify: `plugins/skim/tests/run.sh:217` (add the call beside `tests/report.sh`)
- Modify: `mise.toml`, `.gitignore`

**Interfaces:**
- Produces: `fixture.sh` (identical in every case), the grader file conventions below, the mise task `eval:skim`, and the three probe answers recorded at the top of `evals/README.md` for Tasks 2–4.

- [ ] **Step 1: Write the failing offline test `plugins/skim/tests/evals.sh`**

Same shape as `tests/report.sh`: `set -u`, `pass`/`fail` counters, exit 1 on any failure. Checks, each one `PASS`/`FAIL` line:

```bash
EVALS="$ROOT/evals"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/skim-evals.XXXXXX")
# Scaffold exactly as the runner does: empty cwd, minimal environment.
(cd "$WORK" && env -i PATH="$PATH" HOME="$WORK" TMPDIR="$WORK" TERM=dumb bash "$EVALS/retrieval/fixture.sh")

line() { sed -n "${2}p" "$WORK/$1"; }
# Answer-key anchors (scenarios.md)
[ "$(line src/gateway/retry_policy.ts 691)" = "  ratio: 0.18," ]
line src/gateway/retry_policy.ts 697 | grep -Fq 'private consumed = 0;'
line config/production.yaml 155 | grep -Fq 'ratio: 0.05'
line src/gateway/circuit_breaker.ts 688 | grep -Fq 'this.failures = 0;'
line src/session/store.ts 75  | grep -Fq 'function reconcileShard('
line src/session/store.ts 186 | grep -Fq 'function promoteToken('
line src/session/store.ts 377 | grep -Fq 'function expireLease('
line src/session/store.ts 600 | grep -Fq 'function unlinkDigest('
line src/session/store.ts 711 | grep -Fq 'function emitShard('
# File sizes the scenarios quote
[ "$(wc -l <"$WORK/src/gateway/retry_policy.ts" | tr -d ' ')" = 1483 ]
[ "$(wc -l <"$WORK/src/session/store.ts" | tr -d ' ')" = 800 ]
[ "$(wc -l <"$WORK/src/gateway/circuit_breaker.ts" | tr -d ' ')" = 701 ]
# Sentinels: each occurs exactly once, far from the answer region
[ "$(grep -Fc 'Math.min(attempt, 60)' "$WORK/src/gateway/retry_policy.ts")" = 1 ]    # line 479
[ "$(grep -Fc 'clock.now() - 321' "$WORK/src/session/store.ts")" = 1 ]               # line 282
[ "$(grep -Fc 'scaled * 29,' "$WORK/src/gateway/circuit_breaker.ts")" = 1 ]          # line 306
# The documented command always scaffolds and always caps cost
grep -A6 '^\[tasks."eval:skim"\]' "$ROOT/../../mise.toml" | grep -q -- '--scaffold'
grep -A6 '^\[tasks."eval:skim"\]' "$ROOT/../../mise.toml" | grep -q -- '--max-cost-usd'
```

- [ ] **Step 2: Run it and see it fail**

Run: `bash plugins/skim/tests/evals.sh`
Expected: FAIL, `evals/retrieval/fixture.sh` does not exist.

- [ ] **Step 3: Move the generators and write `fixture.sh`**

`git mv` both generators into `evals/lib/`. `gen-corpus.sh` finds `gen-crossfile.sh` beside itself, so nothing inside them changes. `plugins/skim/evals/retrieval/fixture.sh`:

```bash
#!/usr/bin/env bash
# Scaffold for `claude plugin eval --scaffold`: generates the benchmark corpus into the run's
# empty workspace, which is the current directory.
set -euo pipefail
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/gen-corpus.sh" "$PWD"
```

- [ ] **Step 4: Write the case files**

`prompt.md`: scenario 1's prompt verbatim, with the first line changed to `You are working in the gateway service checked out in the current directory.` Frontmatter:

```yaml
---
name: retrieval
description: Greppable answer. Checks the plugin does not harm a case the baseline already handles.
runs: 5
model: sonnet
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---
```

`case.yaml`:

```yaml
schema_version: "1.1"
name: retrieval
context:
  scaffold_script: fixture.sh
```

Graders, one file each under `graders/`:

| File | Frontmatter | Body |
| --- | --- | --- |
| `value.md` | `type: regex`, `pattern: '\b0\.18\b'` | none |
| `location.md` | `type: regex`, `pattern: 'retry_policy\.ts:69[01]'` | none |
| `override.md` | `type: llm` | PASS if the answer says the `0.05` in `config/production.yaml` is a per-route override and the global default `0.18` still applies elsewhere. FAIL if it says `0.05` replaces the default, or does not say which value applies. |
| `no-bulk-retry-policy.md` | `type: regex`, `target: trace`, `match: not_contains`, `pattern: 'Math\.min\(attempt, 60\)'` | none |
| `skill-fired.md` | `type: tool_used`, `tool: Skill`, `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?reading-large-files"'` | none |

`skill-fired` is excluded from the score in two-arm runs by the runner; it reports whether the skill triggered.

- [ ] **Step 5: Add the mise task and the ignore rule**

`mise.toml`, after `tasks."test:e2e"`:

```toml
[tasks."eval:skim"]
description = "skim's eval suite, with and without the plugin (calls the Claude API, costs tokens)"
tools.claude = "2.1.331"
usage = 'arg "[case]" help="Case name glob (default: all cases)"'
run = 'claude plugin eval plugins/skim --scaffold --trust-plugin --no-publish --threshold 0.8 --max-cost-usd 25 --allow-tools Bash ${usage_case:+--case "$usage_case"}'
```

`Bash` is granted whole because the skill's recipe runs `wc` and `grep`, often piped. `.gitignore`: replace `plugins/skim/evals/corpus/` with `plugins/skim/evals/results/`.

- [ ] **Step 6: Wire the test in and run it**

`plugins/skim/tests/run.sh` ends with `bash "$ROOT/tests/report.sh"`, whose status is the script's. Change that line to `bash "$ROOT/tests/report.sh" || exit 1` and add `echo` and `bash "$ROOT/tests/evals.sh"` after it, so the last suite's status is still the script's.

Run: `mise run check`
Expected: PASS, including every `evals.sh` line.

- [ ] **Step 7: One paid probe run (about 2 agent runs; ask before spending)**

Add a temporary grader `graders/probe-trace.md`: `type: regex`, `target: trace`, `pattern: 'ratio: 0\.18'`. Then:

Run: `claude plugin eval plugins/skim --case retrieval --runs 1 --scaffold --trust-plugin --no-publish --max-cost-usd 3 --allow-tools Bash --keep-temp --json "$TMPDIR/probe.json"`

Read `$TMPDIR/probe.json` and settle three questions:

| Question | How to tell | If not |
| --- | --- | --- |
| Did the scaffold find `lib/`? | No run has a scaffold error and the agent's answer cites `retry_policy.ts`. | Replace each `fixture.sh` body with a copy of both generators' contents, produced by a new `evals/lib/sync-fixtures.sh`, and make `evals.sh` fail when a copy differs from `lib/`. |
| Does `target: trace` include tool results? | `probe-trace` passes in an arm whose answer is correct. | In every case, replace each `no-bulk-*` grader with `type: tool_used`, `tool: Read`, `min: 0`, `max: 0`, `input_match: '^(?!.*"(?:limit\|offset)"\s*:).*<file>\.ts'`, and state in the README that it counts attempts, guard-denied ones included. |
| Which per-arm usage figures does the result hold? | `jq '[paths \| map(tostring) \| join(".")] \| map(select(test("token\|cost\|usage\|duration"; "i"))) \| unique' "$TMPDIR/probe.json"` | Task 4 reports cost and duration only. |

Delete `probe-trace.md`. Record the three answers in a short "Verified mechanics" section at the top of `plugins/skim/evals/README.md` (Task 3 keeps it).

- [ ] **Step 8: Commit**

```bash
git add plugins/skim/evals plugins/skim/tests mise.toml .gitignore
git commit -m "test(skim): first plugin eval case and offline corpus checks"
```

---

### Task 2: The other three cases

**Files:**
- Create: `plugins/skim/evals/{comprehension,dense-file,cross-file}/{prompt.md,case.yaml,fixture.sh,graders/*.md}`
- Modify: `plugins/skim/tests/evals.sh`

**Interfaces:**
- Consumes: `fixture.sh`, the frontmatter block and the `no-bulk-*` grader form from Task 1 (the fallback form if the probe chose it).

- [ ] **Step 1: Extend `evals.sh` with the structural and wording checks (failing)**

```bash
# Exactly these four cases
[ "$(cd "$EVALS" && ls -d */ | tr -d / | grep -vE '^(lib|results)$' | sort | tr '\n' ' ')" = "comprehension cross-file dense-file retrieval " ]
for case_dir in "$EVALS"/retrieval "$EVALS"/comprehension "$EVALS"/dense-file "$EVALS"/cross-file; do
  name=$(basename "$case_dir")
  grep -q "^name: $name\$" "$case_dir/prompt.md" && grep -q "^name: $name\$" "$case_dir/case.yaml"
  grep -q '^  scaffold_script: fixture.sh$' "$case_dir/case.yaml"
  cmp -s "$case_dir/fixture.sh" "$EVALS/retrieval/fixture.sh"
  grep -q '^runs: 5$' "$case_dir/prompt.md" && grep -q '^model: sonnet$' "$case_dir/prompt.md"
  # every grader declares a type; each case has a correctness grader and a bulk-read grader
  for g in "$case_dir"/graders/*.md; do sed -n 2,12p "$g" | grep -q '^type: '; done
  ls "$case_dir"/graders/no-bulk-*.md >/dev/null
  # the prompt body (after the second ---) names none of the behaviours under test
  ! awk 'f>=2{print} /^---$/{f++}' "$case_dir/prompt.md" | grep -Eiq 'strateg|file size|delegat|subagent|context|token|outline|large file'
done
```

Run: `bash plugins/skim/tests/evals.sh` — Expected: FAIL on the three missing cases.

- [ ] **Step 2: Write `comprehension/` (scenario 2)**

Prompt: scenario 2 verbatim with the same first-line change. Frontmatter as Task 1 with `name: comprehension`, `description: No distinctive string to match. The shape the baseline reads whole.`

| File | Frontmatter | Body |
| --- | --- | --- |
| `root-cause.md` | `type: llm` | PASS if the answer identifies `BudgetEnforcer` in `retry_policy.ts` (lines 696–703) and says `consumed` is never incremented, so `permit()` always allows the retry. FAIL if it does not name that mechanism, or names the `backoffStageN` or `recordAttemptOutcomeN` families as the cause. |
| `no-bulk-retry-policy.md` | as Task 1 | none |
| `skill-fired.md` | as Task 1 | none |

- [ ] **Step 3: Write `dense-file/` (scenario 3)**

`name: dense-file`, `description: The answer is a property five of fifty functions share.`

| File | Frontmatter | Body |
| --- | --- | --- |
| `five-names.md` | `type: regex`, `pattern: '^(?=[\s\S]*reconcileShard)(?=[\s\S]*promoteToken)(?=[\s\S]*expireLease)(?=[\s\S]*unlinkDigest)(?=[\s\S]*emitShard)'` | none |
| `exactly-five.md` | `type: llm` | PASS if the answer lists `reconcileShard`, `promoteToken`, `expireLease`, `unlinkDigest` and `emitShard`, and no other function, as writing to the cache without holding the lock. An extra remark that other functions read `cache.get` before taking the lock is correct and does not fail the answer. FAIL if one of the five is missing or another function is listed as writing without the lock. |
| `no-bulk-store.md` | `type: regex`, `target: trace`, `match: not_contains`, `pattern: 'clock\.now\(\) - 321'` | none |
| `skill-fired.md` | as Task 1 | none |

- [ ] **Step 4: Write `cross-file/` (scenario 4)**

`name: cross-file`, `description: One question across three large files.`

| File | Frontmatter | Body |
| --- | --- | --- |
| `verdicts.md` | `type: llm`, `weight: 3` | PASS only if all three hold. (1) Retry budget: a no-op, because `BudgetEnforcer.consumed` is never incremented. (2) Session lock: not enforced, citing that some functions skip `withLock`, or that `cache.get` runs before the lock is taken, or both. (3) Circuit breaker: a no-op, because `allow()` resets `this.failures = 0` on every check. FAIL if any verdict is missing, wrong, or has no deciding code cited. |
| `no-bulk-retry-policy.md` | as Task 1 | none |
| `no-bulk-store.md` | as Step 3 | none |
| `no-bulk-circuit-breaker.md` | `type: regex`, `target: trace`, `match: not_contains`, `pattern: 'scaled \* 29,'` | none |
| `skill-fired.md` | as Task 1 | none |

The weight makes a missed verdict score 3 of 6, below the 0.8 threshold, matching "two of three is a partial, not a pass" in `scenarios.md`.

- [ ] **Step 5: Run the checks**

Run: `mise run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/skim/evals plugins/skim/tests/evals.sh
git commit -m "test(skim): comprehension, dense-file and cross-file eval cases"
```

---

### Task 3: Remove the hand-run harness and rewrite the docs

**Files:**
- Delete: `plugins/skim/evals/scenarios.md`, `plugins/skim/evals/measure.py`
- Modify: `plugins/skim/evals/README.md`, `plugins/skim/README.md`, `README.md:41-62`, `plugins/skim/docs/benchmark.md:3`

- [ ] **Step 1: Add the failing check to `evals.sh`**

```bash
[ ! -e "$EVALS/scenarios.md" ] && [ ! -e "$EVALS/measure.py" ]
! grep -rq 'measure\.py\|scenarios\.md\|gen-corpus\.sh \[' "$ROOT/README.md" "$EVALS/README.md"
grep -Fq 'mise run eval:skim' "$EVALS/README.md"
```

Run: `bash plugins/skim/tests/evals.sh` — Expected: FAIL.

- [ ] **Step 2: Delete the two files and rewrite `evals/README.md`**

Sections, in order: "Verified mechanics" (kept from Task 1); "Running it" (`mise run eval:skim`, `mise run eval:skim retrieval`, that it costs up to $25 and is never run in CI, where `results/<timestamp>/report.html` lands); "The two arms" (the table from this plan's "What the suite measures"); "Graders" (one line per grader kind: correctness, `no-bulk-*` and why it is a sentinel, `skill-fired`); "Changing the corpus" (run `bash plugins/skim/tests/evals.sh`; an answer key is a hypothesis, as the scenario 4 note in the old `scenarios.md` said — keep that paragraph); "Scoring" (the three things to record, from the current README, with "unbounded reads" reworded to "bulk content in the trace").

- [ ] **Step 3: Update the other docs**

- `README.md:43`: `plugins/<name>/evals/` is "the plugin's `claude plugin eval` suite (where present)". Add a row to the task table at line 62: `mise run eval:skim [case]` — "skim's eval suite, with and without the plugin. Calls the Claude API; not run in CI."
- `plugins/skim/README.md`: where it points at the benchmark, name `mise run eval:skim`.
- `plugins/skim/docs/benchmark.md:3`: the "Reproduce with" line becomes "Measured by hand on 2026-09-29, before the eval suite existed; the method is in this file's history. Current method: `../evals/README.md`."

- [ ] **Step 4: Run the checks**

Run: `mise run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A plugins/skim README.md
git commit -m "docs(skim): the benchmark is the plugin eval suite"
```

---

### Task 4: Full measurement and the benchmark record

**Files:**
- Modify: `plugins/skim/docs/benchmark.md`

- [ ] **Step 1: Ask for the go-ahead, then run the suite**

This step spends up to $25 (40 agent runs on Sonnet plus Haiku judges). Do not start it without a yes.

Run: `mise run eval:skim`
Expected: exit 0, every case's with-arm score at or above 0.8. Exit 2 means the cost ceiling stopped it: report the partial result, do not raise the ceiling unasked.

- [ ] **Step 2: Check the run is valid before reading the scores**

From `plugins/skim/evals/results/<timestamp>/aggregate-result.json`: no run has `error` or `aborted`; `partial` is false; every case has 5 runs in each arm. A run that failed to scaffold voids its case.

- [ ] **Step 3: Check delegation is not read as a bulk read**

For each with-arm run whose trace shows an `Agent` call (open `report.html`), confirm its `no-bulk-*` graders passed. If a delegating run failed one only because of the subagent's reads, record it in `evals/README.md` under "Verified mechanics" and exclude delegating runs from the bulk-read figure in the table.

- [ ] **Step 4: Add a dated section to `benchmark.md`**

Above "## Results", add "## Results, eval suite (<date>)": one table per case with columns Baseline and With plugin, and rows Correct (n / 5), Bulk content in trace (n / 5), and the usage rows the probe found (tokens if present, else cost and duration). One paragraph on how the arms differ from the 2026-09-29 run, so the two sets of figures are not compared as like for like. Keep every existing section.

- [ ] **Step 5: Commit**

```bash
git add plugins/skim/docs/benchmark.md plugins/skim/evals/README.md
git commit -m "docs(skim): record the first eval suite measurement"
```
