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
task_has() { grep -A6 '^\[tasks."eval:skim"\]' "$MISE" | grep -q -- "$1"; }

# skip <what> records a SKIP, which is a failure when CI is set: a check that did not run proves nothing.
skip() {
  if [ -n "${CI-}" ]; then
    FAIL=$((FAIL + 1))
    printf '  FAIL %s (not available in CI)\n' "$1"
  else
    printf '  SKIP %s\n' "$1"
  fi
}

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
    case "$(basename "$g")" in no-bulk-* | no-key-access.md | skill-fired.md) ;; *) return 0 ;; esac
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

# Bulk-read graders: each pattern is three unrelated lines of one file at once (a conjunction), run here
# with the runner's regex dialect (JavaScript, through Bun). It must match the whole file, and must not
# match what a targeted grep or a bounded read of the answer region puts in the trace. The regions are the
# answer key's functions (a doc comment and about 16 lines each); the helper widens them by 40 lines.
GUARDED=(
  "no-bulk-retry-policy.md src/gateway/retry_policy.ts 690-703"
  "no-bulk-store.md src/session/store.ts 71-91 182-202 373-393 596-616 707-727"
  "no-bulk-circuit-breaker.md src/gateway/circuit_breaker.ts 688-694"
)
all_guarded() {
  local g entry
  for g in "$EVALS"/*/graders/no-bulk-*.md; do
    for entry in "${GUARDED[@]}"; do
      [ "${entry%% *}" = "$(basename "$g")" ] && continue 2
    done
    return 1
  done
}
ok "every no-bulk grader is pinned below" all_guarded
if command -v bun >/dev/null 2>&1; then
  for entry in "${GUARDED[@]}"; do
    read -ra parts <<<"$entry"
    out=$(bun "$ROOT/tests/grader-check.mjs" "$EVALS/cross-file/graders/${parts[0]}" "$WORK/${parts[1]}" "${parts[@]:2}" 2>&1)
    passed_here=$(grep -c '^PASS ' <<<"$out")
    failed_here=$(grep -c '^FAIL ' <<<"$out")
    PASS=$((PASS + passed_here))
    FAIL=$((FAIL + failed_here))
    if [ "$failed_here" -eq 0 ] && [ "$passed_here" -gt 0 ]; then
      printf '  PASS %s: %s checks (whole file matches; no family grep or answer region does)\n' "${parts[0]}" "$passed_here"
    else
      if [ "$failed_here" -eq 0 ]; then
        FAIL=$((FAIL + 1))
        out="FAIL grader-check.mjs printed no results: $out"
      fi
      sed -n 's/^FAIL /  FAIL '"${parts[0]}"': /p' <<<"$out"
    fi
  done
else
  skip "no-bulk grader pins: bun not on PATH"
fi

# The documented command always scaffolds and always caps cost
ok "eval:skim passes --scaffold" task_has '--scaffold'
ok "eval:skim passes --max-cost-usd" task_has '--max-cost-usd'

# Case structure
ok "exactly four cases" test "$(case_names)" = "comprehension cross-file dense-file retrieval "
read -ra case_list <<<"$(case_names)"
for name in "${case_list[@]}"; do
  case_dir="$EVALS/$name"
  ok "$name: prompt.md and case.yaml carry the case name" names_match "$case_dir" "$name"
  ok "$name: case.yaml uses fixture.sh as scaffold" file_has_line "$case_dir/case.yaml" "  scaffold_script: fixture.sh"
  ok "$name: fixture.sh is the shared executable scaffold" fixture_shared "$case_dir"
  ok "$name: five runs per arm" file_has_line "$case_dir/prompt.md" "runs: 5"
  ok "$name: model is sonnet" file_has_line "$case_dir/prompt.md" "model: sonnet"
  ok "$name: every grader declares a type" graders_typed "$case_dir"
  ok "$name: has a correctness grader" has_correctness_grader "$case_dir"
  ok "$name: has a bulk-read grader" has_grader "$case_dir" 'no-bulk-*.md'
  ok "$name: has a skill-fired grader" has_grader "$case_dir" 'skill-fired.md'
  ok "$name: has a no-key-access grader" has_grader "$case_dir" 'no-key-access.md'
  ok "$name: prompt names none of the behaviours under test" prompt_neutral "$case_dir"
done

# Graders that share a name across cases must stay identical
for shared in skill-fired.md no-key-access.md no-bulk-retry-policy.md no-bulk-store.md; do
  ok "$shared is identical in every case that has it" graders_shared "$shared"
done

# The hand-run harness is gone and the docs describe the suite
ok "scenarios.md and measure.py are removed" test ! -e "$EVALS/scenarios.md" -a ! -e "$EVALS/measure.py"
ok "READMEs do not point at removed files" docs_clean
ok "evals README documents mise run eval:skim" grep -Fq 'mise run eval:skim' "$EVALS/README.md"

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
