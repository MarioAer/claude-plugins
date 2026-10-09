#!/usr/bin/env bash
# End-to-end scenarios for the backlog skill, run headless against the working copy.
# Calls the Claude API (costs tokens, results are model-dependent); not part of validate.sh.
# Usage: plugins/backlog/tests/e2e.sh [scenario-id ...]   (default: all)
# Environment: MODEL (default: sonnet)
set -u

PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
MODEL=${MODEL:-sonnet}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/backlog-e2e.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

TODAY=$(date +%F)
G=(git -c commit.gpgsign=false -c user.name=e2e -c user.email=e2e@example.invalid)

new_repo() {
  mkdir -p "$1" && cd "$1" && git init -q -b main && "${G[@]}" commit -q --allow-empty -m init
}

# Runs one headless turn with the plugin loaded and only the skill's own tool grants.
# User-level settings, plugins and hooks are excluded so results do not depend on the developer's setup.
# Extra arguments are passed to claude (for example --allowedTools).
backlog() {
  local prompt=$1; shift
  claude -p "$prompt" --plugin-dir "$PLUGIN" --model "$MODEL" --strict-mcp-config \
    --setting-sources project,local --permission-mode default --max-turns 12 "$@" 2>&1
}

check() {
  local label=$1; shift
  if "$@"; then echo "  ok   $label"; else echo "  FAIL $label"; fi
}

has_line() { grep -Fxq -- "$2" "$1" 2>/dev/null; }
line_count() { local n; n=$(grep -c -- "$2" "$1" 2>/dev/null); [ "${n:-0}" -eq "$3" ]; }
contains() { grep -Fq -- "$2" <<<"$1"; }
lacks() { ! grep -Fq -- "$2" <<<"$1"; }
lacks_line() { ! has_line "$1" "$2"; }
absent() { [ ! -e "$1" ]; }
only_additions() { ! diff "$1" "$2" | grep -q '^<'; }
clean_status() { [ -z "$(git status --porcelain)" ]; }

# Tool calls made in a headless turn, one name per line, from the stream-json transcript.
tool_calls() {
  local prompt=$1; shift
  claude -p "$prompt" --plugin-dir "$PLUGIN" --model "$MODEL" --strict-mcp-config \
    --setting-sources project,local --permission-mode default --max-turns 12 \
    --output-format stream-json --verbose "$@" 2>/dev/null \
    | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name'
}
no_output() { [ -z "$1" ]; }

# --- Scenarios (IDs match tests/scenarios.md next to this script) ---

S1() {
  new_repo "$WORK/s1"
  out=$(backlog "/backlog add tests for parser")
  check "header created" has_line .backlog/backlog.md "# Backlog"
  check ".gitignore contains *" has_line .backlog/.gitignore "*"
  check "item line" has_line .backlog/backlog.md "- [ ] add tests for parser ($TODAY, branch: main)"
  check "one-line confirmation" contains "$out" "Added to backlog: add tests for parser"
}

S2() {
  new_repo "$WORK/s2"
  backlog "/backlog first thing" >/dev/null
  cp .backlog/backlog.md "$WORK/s2.before"
  backlog "/backlog second thing" >/dev/null
  check "existing lines unchanged (additions only)" only_additions "$WORK/s2.before" .backlog/backlog.md
  check "item appended" has_line .backlog/backlog.md "- [ ] second thing ($TODAY, branch: main)"
}

S3() {
  new_repo "$WORK/s3"
  backlog "/backlog x" >/dev/null
  check "git status clean" clean_status
}

S4() {
  new_repo "$WORK/s4"
  mkdir .backlog && printf '# Backlog\n\n- [ ] old (2026-01-01)\n' >.backlog/backlog.md
  backlog "/backlog x" >/dev/null
  check ".gitignore created" has_line .backlog/.gitignore "*"
  check "old item kept" has_line .backlog/backlog.md "- [ ] old (2026-01-01)"
}

S5() {
  mkdir -p "$WORK/s5" && cd "$WORK/s5" || return
  backlog "/backlog x" >/dev/null
  check "item without branch" has_line .backlog/backlog.md "- [ ] x ($TODAY)"
  check ".gitignore created" has_line .backlog/.gitignore "*"
}

S8() {
  new_repo "$WORK/s8"
  backlog "/backlog survive switch" >/dev/null
  "${G[@]}" switch -q -c other
  check "item after branch switch" line_count .backlog/backlog.md "survive switch" 1
}

S10() {
  new_repo "$WORK/s10"
  # shellcheck disable=SC2016  # the literal text is the point of the test
  local text='fix "quotes" $HOME `tick` & <tag> 100% | pipe'
  backlog "/backlog $text" >/dev/null
  check "text stored literally" has_line .backlog/backlog.md "- [ ] $text ($TODAY, branch: main)"
}

S11() {
  new_repo "$WORK/s11"
  git checkout -q --detach
  backlog "/backlog x" >/dev/null
  check "item without branch" has_line .backlog/backlog.md "- [ ] x ($TODAY)"
}

S13() {
  new_repo "$WORK/s13"
  backlog "/backlog review the auth retry logic" >/dev/null
  check "added as item" has_line .backlog/backlog.md "- [ ] review the auth retry logic ($TODAY, branch: main)"
}

S14() {
  new_repo "$WORK/s14"
  mkdir .backlog && printf '# Backlog\n\n- [ ] old (2026-01-01)' >.backlog/backlog.md
  backlog "/backlog x" >/dev/null
  check "old item intact" has_line .backlog/backlog.md "- [ ] old (2026-01-01)"
  check "new item on own line" has_line .backlog/backlog.md "- [ ] x ($TODAY, branch: main)"
}

S15() {
  new_repo "$WORK/s15"
  printf 'node_modules/\n' >.gitignore && git add .gitignore && "${G[@]}" commit -q -m gitignore
  backlog "/backlog x" >/dev/null
  check "project .gitignore unchanged" git diff --quiet -- .gitignore
}

S16() {
  new_repo "$WORK/s16"
  mkdir -p src/sub && cd src/sub || return
  backlog "/backlog from subdir" >/dev/null
  cd "$WORK/s16" || return
  check "file at root (subdir)" has_line .backlog/backlog.md "- [ ] from subdir ($TODAY, branch: main)"
  check "no file in subdir" absent src/sub/.backlog
  "${G[@]}" worktree add -q "$WORK/s16-wt" -b wt
  cd "$WORK/s16-wt" || return
  backlog "/backlog from worktree" >/dev/null
  check "file at worktree root" has_line .backlog/backlog.md "- [ ] from worktree ($TODAY, branch: wt)"
  check "worktree status clean" clean_status
}

S17() {
  new_repo "$WORK/s17"
  git checkout -q -b feature/x
  mkdir .backlog && printf '# Backlog\n\n- [ ] open one (2026-01-01, branch: main)\n- [x] done one (2026-01-01)\n- [ ] open two (2026-01-02, branch: main)\n' >.backlog/backlog.md
  out=$(backlog "/backlog list")
  check "first open item numbered with metadata" contains "$out" "1. open one (2026-01-01, branch: main)"
  check "second open item numbered with metadata" contains "$out" "2. open two (2026-01-02, branch: main)"
  check "done item hidden" lacks "$out" "done one"
}

S18() {
  new_repo "$WORK/s18"
  backlog "/backlog dedupe me" >/dev/null
  out=$(backlog "/backlog dedupe me")
  check "single line" line_count .backlog/backlog.md "dedupe me" 1
  check "reports duplicate" contains "$out" "Already on backlog: dedupe me"
}

S19() {
  new_repo "$WORK/s19"
  out=$(backlog "/backlog")
  check "no file created" absent .backlog
  check "asks for the text" contains "$out" "What should go on the backlog?"
}

S20() {
  new_repo "$WORK/s20"
  out=$(backlog "/backlog list")
  check "reports empty" contains "$out" "Backlog is empty."
  check "no folder created" absent .backlog
}

S21() {
  new_repo "$WORK/s21"
  mkdir .backlog && printf '# Backlog\n\n- [ ] alpha (2026-01-01)\n- [ ] beta (2026-01-01)\n' >.backlog/backlog.md
  cp .backlog/backlog.md "$WORK/s21.before"
  out=$(backlog "/backlog review")
  check "file unchanged" cmp -s "$WORK/s21.before" .backlog/backlog.md
  check "lists items instead" contains "$out" "1. alpha"
}

S22() {
  new_repo "$WORK/s22"
  mkdir .backlog && printf '# Backlog\n\n- [ ] alpha (2026-01-01)\n' >.backlog/backlog.md
  out=$(backlog "/backlog LIST")
  check "uppercase selects list" contains "$out" "1. alpha"
  check "LIST not added" lacks_line .backlog/backlog.md "- [ ] LIST ($TODAY, branch: main)"
}

S23() {
  new_repo "$WORK/s23"
  backlog "/backlog line one
line two" >/dev/null
  check "newline collapsed" has_line .backlog/backlog.md "- [ ] line one line two ($TODAY, branch: main)"
}

# Model-invoked skill use needs Skill(backlog:backlog) approval; granted here as a user would.
S24() {
  new_repo "$WORK/s24"
  backlog "Use the backlog skill to record the item 'check flaky retry test'. Afterwards, create the file notes.txt containing hi." \
    --allowedTools "Skill(backlog:backlog)" >/dev/null
  check "backlog item recorded" line_count .backlog/backlog.md "check flaky retry test" 1
  check "skill grant does not cover notes.txt" absent notes.txt
}

S26() {
  new_repo "$WORK/s26"
  calls=$(tool_calls "/backlog hook path item")
  check "typed add makes no tool call" no_output "$calls"
  check "item written once" line_count .backlog/backlog.md "hook path item" 1
}

# With hooks disabled nothing pre-approves the fallback's calls; the grants stand in for a user approving the prompts.
S27() {
  new_repo "$WORK/s27"
  backlog "/backlog fallback item" --settings '{"disableAllHooks": true}' \
    --allowedTools "Read" "Write" "Edit" "Bash(git rev-parse --show-toplevel)" "Bash(git branch --show-current)" "Bash(date +%F)" >/dev/null
  check "fallback adds the item with hooks disabled" has_line .backlog/backlog.md "- [ ] fallback item ($TODAY, branch: main)"
}

S28() {
  new_repo "$WORK/s28"
  calls=$(tool_calls "Use the backlog skill to record the item 'self initiated item'. Do nothing else.")
  check "Claude's add makes only the Skill call" [ "$calls" = "Skill" ]
  check "item carries by: claude" has_line .backlog/backlog.md "- [ ] self initiated item ($TODAY, branch: main, by: claude)"
}

ALL=(S1 S2 S3 S4 S5 S8 S10 S11 S13 S14 S15 S16 S17 S18 S19 S20 S21 S22 S23 S24 S26 S27 S28)
[ $# -gt 0 ] && ALL=("$@")

echo "backlog e2e: model=$MODEL, $(claude --version 2>/dev/null)"
for id in "${ALL[@]}"; do
  echo "$id"
  ( "$id" )
done | tee "$WORK/log"
passed=$(grep -c '^  ok ' "$WORK/log")
failed=$(grep -c '^  FAIL ' "$WORK/log")
echo "$passed checks passed, $failed failed"
[ "$failed" -eq 0 ]
