# Evaluation suite

A `claude plugin eval` suite that measures what the skim plugin changes. The
numbers in [`../docs/benchmark.md`](../docs/benchmark.md) were measured by hand
before this suite existed; this suite replaces that method.

It is not the guard's unit tests. Those are `../tests/run.sh`, which CI runs
through `tests/unit.sh` at the repository root.

## Unverified mechanics

The suite is checked offline only, with `bash plugins/skim/tests/evals.sh`. That
script runs each case's scaffold the way the runner does and pins the corpus
anchors the graders depend on. It does not call Claude. The suite has not yet
been run through `claude plugin eval`, so three things about the runner are
assumed rather than known. The first run settles them.

The cheapest first run:

```bash
claude plugin eval plugins/skim --case retrieval --runs 1 --scaffold --trust-plugin --no-publish --max-cost-usd 3 --allow-tools Bash
```

1. **Does the scaffold find `lib/` when the runner invokes `fixture.sh`?** Each
   `fixture.sh` calls `../lib/gen-corpus.sh` relative to itself. If the runner
   copies the script elsewhere, that path breaks. Tell: no run reports a
   scaffold error, and the answers cite `retry_policy.ts`. If not: inline the
   generators into each case's `fixture.sh`.
2. **Does a grader with `target: trace` see tool results?** The `no-bulk-*`
   graders look for a line from the middle of a large file in the trace, which
   only works if the trace holds tool results and not just tool calls. Tell: add
   a temporary grader to `retrieval/graders/` with `type: regex`,
   `target: trace` and `pattern: 'ratio: 0\.18'`, and check that it passes in a
   run whose answer is correct. If not: replace each `no-bulk-*` grader with
   `type: tool_used`, `tool: Read`, `min: 0`, `max: 0` and an `input_match` for
   unbounded reads of that file. That counts attempts, including ones the guard
   denied, so it marks the plugin down for reads whose content never arrived.
3. **Does the trace include a `bulk-reader` subagent's tool results?** If it
   does, a correct delegation trips the sentinel, because the subagent reads the
   file in full on purpose. Tell: check the first run in which `Agent` was
   called. If that run fails a `no-bulk-*` grader and its answer is correct, the
   sentinel needs to exclude subagent output.

## Running it

```bash
mise run eval:skim                # all four cases
mise run eval:skim retrieval      # one case, by name or glob
```

A full run is 40 agent runs on Sonnet (four cases, five runs each, two arms)
plus the judge calls for the graders. The mise task caps it at $25 with
`--max-cost-usd`, and passes `--scaffold`, `--trust-plugin`, `--no-publish` and
`--threshold 0.8`. It calls the Claude API, so it is never part of
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
| Bulk-read signal | `Read` calls with no `limit`/`offset`, counted from transcripts | A line from the middle of each large file appearing in the run's trace |
| Isolation | Manual copy outside the repo | The runner hides the eval directory from the agent |

Isolation matters because the generators show where each defect was planted and
the graders hold the answer keys. In the hand-run benchmark, one arm was given a
path into this directory, opened the answer key in every repetition, and the
whole comparison had to be discarded. The runner now keeps this directory out of
the agent's reach.

## Graders

Each case has three kinds of grader.

- **Correctness.** Regex and LLM-judge graders that check the answer against the
  key. The key lives only in the grader files; this README does not repeat it.
- **`no-bulk-*`.** One per large file the case touches. Each is a regex over the
  run's trace that fails if a line from the middle of that file appears. The
  signal is a sentinel and not a count of `Read` calls because the guard denies
  a first unbounded `Read` of a large file. Counting attempts would mark the
  plugin down for a read whose content never arrived. A sentinel line in the
  trace says the content did arrive, whether through `Read`, `cat`, or a second
  attempt.
- **`skill-fired`.** Passes if the `reading-large-files` skill was invoked. The
  runner leaves it out of the score in two-arm runs, so it only reports whether
  the skill triggered.

`no-bulk-*` and `skill-fired` files that share a name across cases are
identical. `tests/evals.sh` checks that.

## Changing the corpus

The graders encode answers as line numbers and file sizes, so a change to a
generator can silently flip a grader. After any change under `lib/`, run:

```bash
bash plugins/skim/tests/evals.sh
```

It scaffolds a corpus and checks every anchor, sentinel and size the graders
quote. If it fails, either the generator regressed or the graders need updating.

An answer key is a hypothesis, not an authority. In the hand-run benchmark, the
key for the cross-file case understated one verdict, and four of five
repetitions independently reported the stronger finding. They were right and the
key was wrong. When repetitions disagree with a key, check the fixture before
marking them down.

## Scoring

Record three things per repetition. Token counts alone are not sufficient.

1. **Correctness** against the answer key. A cheaper run that misses part of the
   answer is a regression, not an improvement.
2. **Bulk content in the trace.** The behaviour the skill exists to change.
3. **Variance across repetitions.** Convergence on one shape indicates the
   wording binds; several different interpretations indicate it does not, which
   is a defect in the skill even when every run happens to be correct.
