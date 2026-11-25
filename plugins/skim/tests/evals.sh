#!/usr/bin/env bash
# Offline checks for the eval suite under evals/.
#
# The graders encode answer keys as file:line anchors and quoted file sizes, so a change to the
# corpus generator can silently flip a grader. This suite runs the case scaffold exactly as
# `claude plugin eval --scaffold` does and pins those anchors. No Claude process, no API calls.
#
# Usage: bash plugins/skim/tests/evals.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVALS="$ROOT/evals"
MISE="$ROOT/../../mise.toml"
PASS=0
FAIL=0

WORK="$(mktemp -d "${TMPDIR:-/tmp}/skim-evals.XXXXXX")" || {
  echo "cannot create temp dir" >&2
  exit 1
}
SCAFFOLD_LOG="$WORK.log"
trap 'rm -rf "$WORK" "$SCAFFOLD_LOG"' EXIT

# ok <name> <command...> runs the command and records PASS when it succeeds.
ok() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    printf '  PASS %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s\n' "$name"
  fi
}

# line <file> <n> prints line n of a scaffolded file.
line() { sed -n "${2}p" "$WORK/$1"; }
line_is() { [ "$(line "$1" "$2")" = "$3" ]; }
line_has() { line "$1" "$2" | grep -Fq -- "$3"; }
lines_in() { [ "$(wc -l <"$WORK/$1" | tr -d ' ')" = "$2" ]; }
occurs_once() { [ "$(grep -Fc -- "$2" "$WORK/$1")" = 1 ]; }
task_has() { grep -A6 '^\[tasks."eval:skim"\]' "$MISE" | grep -q -- "$1"; }

# Per-case structure checks. Each takes a case directory.
case_names() { find "$EVALS" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | grep -vE '^(lib|results)$' | sort | tr '\n' ' '; }
file_has_line() { grep -Fxq -- "$2" "$1"; }
prompt_body() { awk 'f>=2{print} /^---$/{f++}' "$1/prompt.md"; }
names_match() { file_has_line "$1/prompt.md" "name: $2" && file_has_line "$1/case.yaml" "name: $2"; }
fixture_shared() { cmp -s "$1/fixture.sh" "$EVALS/retrieval/fixture.sh" && [ -x "$1/fixture.sh" ]; }
graders_typed() {
  local g
  for g in "$1"/graders/*.md; do
    sed -n 2,12p "$g" | grep -q '^type: ' || return 1
  done
}
graders_shared() {
  local f first=""
  for f in "$EVALS"/*/graders/"$1"; do
    [ -e "$f" ] || continue
    [ -n "$first" ] || first="$f"
    cmp -s "$f" "$first" || return 1
  done
  [ -n "$first" ]
}
has_grader() { compgen -G "$1/graders/$2" >/dev/null; }
has_correctness_grader() {
  local g
  for g in "$1"/graders/*.md; do
    [ -e "$g" ] || continue
    case "$(basename "$g")" in no-bulk-* | skill-fired.md) ;; *) return 0 ;; esac
  done
  return 1
}
docs_clean() { ! grep -q 'measure\.py\|scenarios\.md\|gen-corpus\.sh \[' "$ROOT/../../README.md" "$EVALS/README.md"; }
prompt_neutral() { ! prompt_body "$1" | grep -Eiq 'strateg|file size|delegat|subagent|context|token|outline|large file'; }

echo "eval suite offline checks"

# Scaffold exactly as the runner does: empty cwd, minimal environment.
FIXTURE="$EVALS/retrieval/fixture.sh"
if [ ! -f "$FIXTURE" ]; then
  echo "  FAIL scaffold script not found at $FIXTURE"
  exit 1
fi
(cd "$WORK" && env -i PATH="$PATH" HOME="$WORK" TMPDIR="$WORK" TERM=dumb bash "$FIXTURE") >"$SCAFFOLD_LOG" 2>&1
SCAFFOLD_STATUS=$?
ok "scaffold exits 0 in an empty workspace" test "$SCAFFOLD_STATUS" -eq 0
if [ "$SCAFFOLD_STATUS" -ne 0 ]; then
  echo "  scaffold exited $SCAFFOLD_STATUS; output:"
  sed 's/^/    /' "$SCAFFOLD_LOG"
fi
ok "scaffold generated the corpus" test -f "$WORK/src/gateway/retry_policy.ts"

# Answer-key anchors (the correctness graders)
ok "retry_policy.ts:691 is DEFAULT_RETRY_BUDGET.ratio" line_is src/gateway/retry_policy.ts 691 "  ratio: 0.18,"
ok "retry_policy.ts:697 is the never-incremented counter" line_has src/gateway/retry_policy.ts 697 'private consumed = 0;'
ok "production.yaml:155 is the 0.05 per-route decoy" line_has config/production.yaml 155 'ratio: 0.05'
ok "circuit_breaker.ts:688 resets failures" line_has src/gateway/circuit_breaker.ts 688 'this.failures = 0;'
ok "store.ts:75 is reconcileShard" line_has src/session/store.ts 75 'function reconcileShard('
ok "store.ts:186 is promoteToken" line_has src/session/store.ts 186 'function promoteToken('
ok "store.ts:377 is expireLease" line_has src/session/store.ts 377 'function expireLease('
ok "store.ts:600 is unlinkDigest" line_has src/session/store.ts 600 'function unlinkDigest('
ok "store.ts:711 is emitShard" line_has src/session/store.ts 711 'function emitShard('

# File sizes the graders quote
ok "retry_policy.ts is 1483 lines" lines_in src/gateway/retry_policy.ts 1483
ok "store.ts is 800 lines" lines_in src/session/store.ts 800
ok "circuit_breaker.ts is 701 lines" lines_in src/gateway/circuit_breaker.ts 701

# Sentinels: each occurs exactly once, far from the answer region
ok "retry_policy.ts sentinel occurs once (line 479)" occurs_once src/gateway/retry_policy.ts 'Math.min(attempt, 60)'
ok "store.ts sentinel occurs once (line 282)" occurs_once src/session/store.ts 'clock.now() - 321'
ok "circuit_breaker.ts sentinel occurs once (line 306)" occurs_once src/gateway/circuit_breaker.ts 'scaled * 29,'

# The documented command always scaffolds and always caps cost
ok "eval:skim passes --scaffold" task_has '--scaffold'
ok "eval:skim passes --max-cost-usd" task_has '--max-cost-usd'

# Case structure
ok "exactly four cases" test "$(case_names)" = "comprehension cross-file dense-file retrieval "
for case_dir in "$EVALS"/retrieval "$EVALS"/comprehension "$EVALS"/dense-file "$EVALS"/cross-file; do
  name=$(basename "$case_dir")
  ok "$name: prompt.md and case.yaml carry the case name" names_match "$case_dir" "$name"
  ok "$name: case.yaml uses fixture.sh as scaffold" file_has_line "$case_dir/case.yaml" "  scaffold_script: fixture.sh"
  ok "$name: fixture.sh is the shared executable scaffold" fixture_shared "$case_dir"
  ok "$name: five runs per arm" file_has_line "$case_dir/prompt.md" "runs: 5"
  ok "$name: model is sonnet" file_has_line "$case_dir/prompt.md" "model: sonnet"
  ok "$name: every grader declares a type" graders_typed "$case_dir"
  ok "$name: has a correctness grader" has_correctness_grader "$case_dir"
  ok "$name: has a bulk-read grader" has_grader "$case_dir" 'no-bulk-*.md'
  ok "$name: has a skill-fired grader" has_grader "$case_dir" 'skill-fired.md'
  ok "$name: prompt names none of the behaviours under test" prompt_neutral "$case_dir"
done

# Graders that share a name across cases must stay identical
for shared in skill-fired.md no-bulk-retry-policy.md no-bulk-store.md; do
  ok "$shared is identical in every case that has it" graders_shared "$shared"
done

# The hand-run harness is gone and the docs describe the suite
ok "scenarios.md and measure.py are removed" test ! -e "$EVALS/scenarios.md" -a ! -e "$EVALS/measure.py"
ok "READMEs do not point at removed files" docs_clean
ok "evals README documents mise run eval:skim" grep -Fq 'mise run eval:skim' "$EVALS/README.md"

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
