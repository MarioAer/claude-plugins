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
trap 'rm -rf "$WORK"' EXIT

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

echo "eval suite offline checks"

# Scaffold exactly as the runner does: empty cwd, minimal environment.
FIXTURE="$EVALS/retrieval/fixture.sh"
if [ ! -f "$FIXTURE" ]; then
  echo "  FAIL scaffold script not found at $FIXTURE"
  exit 1
fi
(cd "$WORK" && env -i PATH="$PATH" HOME="$WORK" TMPDIR="$WORK" TERM=dumb bash "$FIXTURE") >/dev/null 2>&1
ok "scaffold exits 0 in an empty workspace" test -f "$WORK/src/gateway/retry_policy.ts"

# Answer-key anchors (scenarios.md)
ok "retry_policy.ts:691 is DEFAULT_RETRY_BUDGET.ratio" line_is src/gateway/retry_policy.ts 691 "  ratio: 0.18,"
ok "retry_policy.ts:697 is the never-incremented counter" line_has src/gateway/retry_policy.ts 697 'private consumed = 0;'
ok "production.yaml:155 is the 0.05 per-route decoy" line_has config/production.yaml 155 'ratio: 0.05'
ok "circuit_breaker.ts:688 resets failures" line_has src/gateway/circuit_breaker.ts 688 'this.failures = 0;'
ok "store.ts:75 is reconcileShard" line_has src/session/store.ts 75 'function reconcileShard('
ok "store.ts:186 is promoteToken" line_has src/session/store.ts 186 'function promoteToken('
ok "store.ts:377 is expireLease" line_has src/session/store.ts 377 'function expireLease('
ok "store.ts:600 is unlinkDigest" line_has src/session/store.ts 600 'function unlinkDigest('
ok "store.ts:711 is emitShard" line_has src/session/store.ts 711 'function emitShard('

# File sizes the scenarios quote
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

echo
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
