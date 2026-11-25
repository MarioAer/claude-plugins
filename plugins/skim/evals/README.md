# Evaluation suite

A `claude plugin eval` suite that measures what the skim plugin changes. The
numbers in [`../docs/benchmark.md`](../docs/benchmark.md) were measured by hand
before this suite existed; this suite replaces that method.

It is not the guard's unit tests. Those are `../tests/run.sh`, which CI runs
through `tests/unit.sh` at the repository root.

## Unverified mechanics

The suite is checked offline only, with `bash plugins/skim/tests/evals.sh`. That
script runs each case's scaffold the way the runner does, pins the corpus
anchors the graders depend on, and runs the `no-bulk-*` patterns against the
corpus. It does not call Claude. The suite has not yet been run through
`claude plugin eval`. The four questions below are the ones most likely to need
a change. Everything else this README says about the runner is taken from its
documentation (https://code.claude.com/docs/en/plugin-evals.md) and is likewise
unobserved until a first run.

The cheapest first run:

```bash
claude plugin eval plugins/skim --case retrieval --runs 1 --scaffold --trust-plugin --no-publish --max-cost-usd 3 --allow-tools Bash
```

1. **Does the scaffold find `lib/` when the runner invokes `fixture.sh`?** Each
   `fixture.sh` calls `../lib/gen-corpus.sh` relative to itself. If the runner
   copies the script elsewhere, that path breaks. Tell: no run reports a
   scaffold error, and the answers cite `retry_policy.ts`. In Claude Code
   2.1.331 the runner resolves `scaffold_script` by real path inside the case
   directory and runs it as `bash <path>` with the workspace as the current
   directory, so `../lib/` resolves. That was read from the runner's bundled
   code, not observed in a run, so the question stays open until a run confirms
   it. If not: inline the generators into each case's `fixture.sh`.
2. **Does a grader with `target: trace` see tool results, and can a pattern
   span lines of the trace?** The `no-bulk-*` graders look for three unrelated
   lines from the middle of a large file at once. That only works if the trace
   holds tool results and not just tool calls, and if the runner applies a regex
   to the whole trace text and not line by line. Tell: add a temporary grader to
   `retrieval/graders/` with `type: regex`, `target: trace` and
   `pattern: '"type":\s*"tool_result"[\s\S]*"type":\s*"tool_result"'`. It
   passes when the trace holds tool results and a pattern can span lines of the
   trace. One run settles both. The pattern is not a value from the corpus
   because a corpus value can also appear in the agent's final answer, so it
   would pass even if tool results were missing from the trace. If not: if the
   trace holds no tool results, replace each `no-bulk-*` grader with
   `type: tool_used`, `tool: Read`, `min: 0`, `max: 0` and an `input_match` for
   unbounded reads of that file. That counts attempts, including ones the guard
   denied, so it marks the plugin down for reads whose content never arrived. If
   tool results are present but a pattern cannot span lines, the `no-bulk-*`
   graders can never fire and must be replaced the same way.
3. **Does the trace include a `bulk-reader` subagent's tool results?** If it
   does, a correct delegation trips a `no-bulk-*` grader, because the subagent
   reads the file in full on purpose. Tell: check the first run in which `Agent` was
   called. If that run fails a `no-bulk-*` grader and its answer is correct, the
   grader needs to exclude subagent output.
4. **Does the agent reach the answer keys?** The with-plugin arm loads
   `plugins/skim`, which contains `evals/*/graders`. The runner's documentation
   says it keeps the eval directory out of the agent's reach. That is the
   documentation's statement and is unobserved. Tell: `no-key-access` fails in a
   run. If so: that run is void, as the hand-run benchmark's contaminated arm
   was. Do not use its figures.

## Running it

```bash
mise run eval:skim                # all four cases
mise run eval:skim retrieval      # one case, by name or glob
```

A full run is 40 agent runs on Sonnet (four cases, five runs each, two arms)
plus the judge calls for the graders. The mise task caps it at $25 with
`--max-cost-usd`, and passes `--scaffold`, `--trust-plugin`, `--no-publish`,
`--threshold 0.8` and `--allow-tools Bash` (the skill's recipe runs `wc` and
`grep`). It calls the Claude API, so it is never part of
`mise run check` and never runs in CI.

Results land in `plugins/skim/evals/results/<timestamp>/`, which is gitignored.
Open `report.html` there for the per-case comparison.

## Layout

| Path | Purpose |
| --- | --- |
| `<case>/prompt.md` | The prompt, with frontmatter for runs, model, turn limit and allowed tools. |
| `<case>/case.yaml` | Names the scaffold script. |
| `<case>/fixture.sh` | Scaffold: generates the corpus into the run's empty workspace. Identical in every case. |
| `<case>/graders/*.md` | One file per grader. |
| `lib/gen-corpus.sh`, `lib/gen-crossfile.sh` | The corpus generators. The corpus is generated, never committed. |

The cases are `retrieval`, `comprehension`, `dense-file` and `cross-file`. Their
prompts say nothing about reading strategy, file size, delegation, context or
tokens: naming any of those hints at the behaviour under test and contaminates
the arm without the plugin. `tests/evals.sh` checks this.

## The two arms

Each case runs twice from the same scaffold. The runner scores the two arms
against each other.

| | Hand-run benchmark | This suite |
| --- | --- | --- |
| "With" arm | Prompt preceded by "read and follow the skill" | The whole plugin loaded: skill, read guard, `bulk-reader` |
| "Without" arm | Prompt alone | Same prompt, no plugin |
| Bulk-read signal | `Read` calls with no `limit`/`offset`, counted from transcripts | Three unrelated lines from the middle of each large file appearing together in the run's trace |
| Isolation | Manual copy outside the repo | The runner is documented to hide the eval directory from the agent (unobserved); `no-key-access` checks it |

Isolation matters because the generators show where each defect was planted and
the graders hold the answer keys. In the hand-run benchmark, one arm was given a
path into this directory, opened the answer key in every repetition, and the
whole comparison had to be discarded. The runner's documentation says it keeps
this directory out of the agent's reach. That is unobserved until a run: the
with-plugin arm loads `plugins/skim`, which contains the graders, so the
`no-key-access` grader in every case fails a run whose trace names them (see
open question 4).

## Graders

Each case has four kinds of grader.

- **Correctness.** Regex and LLM-judge graders that check the answer against the
  key. The key lives only in the grader files; this README does not repeat it.
- **`no-bulk-*`.** One per large file the case touches. Each is a regex over the
  run's trace that fails if three unrelated lines from the middle of that file
  appear together: a body line, a doc-comment line and a line of another kind
  (a call or a function signature), from three different declarations, all far
  from the answer.
  One line alone is not enough. Each file is mostly generated families, so a
  single line is one of dozens of similar ones and a `grep` for the property
  (`Math.min`, `clock.now()`, `exponent`) returns it, which is the move the
  skill teaches. No single grep a reader would run returns all three, so the
  three together only appear when the file's content arrived whole, whether
  through `Read`, `cat`, or a second attempt. The signal is that and not a count
  of `Read` calls because the guard denies a first unbounded `Read` of a large
  file, and counting attempts would mark the plugin down for a read whose
  content never arrived. `tests/evals.sh` checks the three-line form against the
  corpus: it must match the whole file and must not match the output of a family
  of targeted greps or the answer region widened by 40 lines.
- **`no-key-access`.** Fails if the trace names `graders/`, `gen-corpus`,
  `gen-crossfile` or `evals/lib`, which means the agent reached the answer keys
  or the generators.
- **`skill-fired`.** Passes if the `reading-large-files` skill was invoked. The
  runner leaves it out of the score in two-arm runs, so it only reports whether
  the skill triggered.

`no-bulk-*`, `no-key-access` and `skill-fired` files that share a name across
cases are identical. `tests/evals.sh` checks that.

## Changing the corpus

The graders encode answers as line numbers and file sizes, so a change to a
generator can silently flip a grader. After any change under `lib/`, run:

```bash
bash plugins/skim/tests/evals.sh
```

It scaffolds a corpus and checks every anchor and size the graders quote, and
that each bulk-read pattern fires on the whole file only. If it fails, either
the generator regressed or the graders need updating.

An answer key is a hypothesis, not an authority. In the hand-run benchmark, the
key for the cross-file case understated one verdict, and four of five
repetitions independently reported the stronger finding. They were right and the
key was wrong. When repetitions disagree with a key, check the fixture before
marking them down.

## Scoring

First check that `no-key-access` passed in every run before reading any score. A
run that failed it is void.

Record three things per repetition. Token counts alone are not sufficient.

1. **Correctness** against the answer key. A cheaper run that misses part of the
   answer is a regression, not an improvement.
2. **Bulk content in the trace.** The behaviour the skill exists to change.
3. **Variance across repetitions.** Convergence on one shape indicates the
   wording binds; several different interpretations indicate it does not, which
   is a defect in the skill even when every run happens to be correct.
