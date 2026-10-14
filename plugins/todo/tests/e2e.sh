#!/usr/bin/env bash
# End-to-end scenarios for the todo skill, run headless against the working copy.
# Calls the Claude API (costs tokens, results are model-dependent); not part of validate.sh.
# Usage: plugins/todo/tests/e2e.sh [scenario-id ...]   (default: all)
# Environment: MODEL (default: sonnet)
set -u

PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
MODEL=${MODEL:-sonnet}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/todo-e2e.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

TODAY=$(date +%F)
G=(git -c commit.gpgsign=false -c user.name=e2e -c user.email=e2e@example.invalid)

new_repo() {
  mkdir -p "$1" && cd "$1" && git init -q -b main && "${G[@]}" commit -q --allow-empty -m init
}

# Runs one headless turn with the plugin loaded and no tool grants beyond those passed as arguments.
# User-level settings, plugins and hooks are excluded so results do not depend on the developer's setup.
# Extra arguments are passed to claude (for example --allowedTools).
todo() {
  local prompt=$1
  shift
  claude -p "$prompt" --plugin-dir "$PLUGIN" --model "$MODEL" --strict-mcp-config \
    --setting-sources project,local --permission-mode default --max-turns 12 "$@" 2>&1
}

check() {
  local label=$1
  shift
  if "$@"; then echo "  ok   $label"; else echo "  FAIL $label"; fi
}

has_line() { grep -Fxq -- "$2" "$1" 2>/dev/null; }
line_count() {
  local n
  n=$(grep -c -- "$2" "$1" 2>/dev/null)
  [ "${n:-0}" -eq "$3" ]
}
contains() { grep -Fq -- "$2" <<<"$1"; }
lacks() { ! grep -Fq -- "$2" <<<"$1"; }
lacks_line() { ! has_line "$1" "$2"; }
absent() { [ ! -e "$1" ]; }
only_additions() { ! diff "$1" "$2" | grep -q '^<'; }
clean_status() { [ -z "$(git status --porcelain)" ]; }

# Tool calls made in a headless turn, one name per line, from the stream-json transcript.
tool_calls() {
  local prompt=$1
  shift
  claude -p "$prompt" --plugin-dir "$PLUGIN" --model "$MODEL" --strict-mcp-config \
    --setting-sources project,local --permission-mode default --max-turns 12 \
    --output-format stream-json --verbose "$@" 2>/dev/null |
    jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name'
}
no_output() { [ -z "$1" ]; }

# One headless run as a JSON result object; the mod answers typed commands without a turn.
todo_json() {
  local prompt=$1
  shift
  claude -p "$prompt" --plugin-dir "$PLUGIN" --model "$MODEL" --strict-mcp-config \
    --setting-sources project,local --permission-mode default --max-turns 12 --output-format json "$@" </dev/null 2>/dev/null |
    jq -c 'if type == "array" then .[] | select(.type == "result") else . end'
}
# The whole stream-json transcript of one headless run, for text that must or must not appear.
transcript() {
  local prompt=$1
  shift
  claude -p "$prompt" --plugin-dir "$PLUGIN" --model "$MODEL" --strict-mcp-config \
    --setting-sources project,local --permission-mode default --max-turns 12 \
    --output-format stream-json --verbose "$@" </dev/null 2>/dev/null
}

# --- Scenarios (IDs match tests/scenarios.md next to this script) ---

S1() {
  new_repo "$WORK/s1"
  out=$(todo "/todo add tests for parser")
  check "header created" has_line .todo/todo.md "# Todo"
  check ".gitignore contains *" has_line .todo/.gitignore "*"
  check "item line" has_line .todo/todo.md "- [ ] add tests for parser ($TODAY, branch: main)"
  check "one-line confirmation" contains "$out" "Added to todo list: add tests for parser"
}

S2() {
  new_repo "$WORK/s2"
  todo "/todo first thing" >/dev/null
  cp .todo/todo.md "$WORK/s2.before"
  todo "/todo second thing" >/dev/null
  check "existing lines unchanged (additions only)" only_additions "$WORK/s2.before" .todo/todo.md
  check "item appended" has_line .todo/todo.md "- [ ] second thing ($TODAY, branch: main)"
}

S3() {
  new_repo "$WORK/s3"
  todo "/todo x" >/dev/null
  check "git status clean" clean_status
}

S4() {
  new_repo "$WORK/s4"
  mkdir .todo && printf '# Todo\n\n- [ ] old (2026-01-01)\n' >.todo/todo.md
  todo "/todo x" >/dev/null
  check ".gitignore created" has_line .todo/.gitignore "*"
  check "old item kept" has_line .todo/todo.md "- [ ] old (2026-01-01)"
}

S5() {
  mkdir -p "$WORK/s5" && cd "$WORK/s5" || return
  todo "/todo x" >/dev/null
  check "item without branch" has_line .todo/todo.md "- [ ] x ($TODAY)"
  check ".gitignore created" has_line .todo/.gitignore "*"
}

S8() {
  new_repo "$WORK/s8"
  todo "/todo survive switch" >/dev/null
  "${G[@]}" switch -q -c other
  check "item after branch switch" line_count .todo/todo.md "survive switch" 1
}

S10() {
  new_repo "$WORK/s10"
  # shellcheck disable=SC2016  # the literal text is the point of the test
  local text='fix "quotes" $HOME `tick` & <tag> 100% | pipe'
  todo "/todo $text" >/dev/null
  check "text stored literally" has_line .todo/todo.md "- [ ] $text ($TODAY, branch: main)"
}

S11() {
  new_repo "$WORK/s11"
  git checkout -q --detach
  todo "/todo x" >/dev/null
  check "item without branch" has_line .todo/todo.md "- [ ] x ($TODAY)"
}

S13() {
  new_repo "$WORK/s13"
  todo "/todo review the auth retry logic" >/dev/null
  check "added as item" has_line .todo/todo.md "- [ ] review the auth retry logic ($TODAY, branch: main)"
}

S14() {
  new_repo "$WORK/s14"
  mkdir .todo && printf '# Todo\n\n- [ ] old (2026-01-01)' >.todo/todo.md
  todo "/todo x" >/dev/null
  check "old item intact" has_line .todo/todo.md "- [ ] old (2026-01-01)"
  check "new item on own line" has_line .todo/todo.md "- [ ] x ($TODAY, branch: main)"
}

S15() {
  new_repo "$WORK/s15"
  printf 'node_modules/\n' >.gitignore && git add .gitignore && "${G[@]}" commit -q -m gitignore
  todo "/todo x" >/dev/null
  check "project .gitignore unchanged" git diff --quiet -- .gitignore
}

S16() {
  new_repo "$WORK/s16"
  mkdir -p src/sub && cd src/sub || return
  todo "/todo from subdir" >/dev/null
  cd "$WORK/s16" || return
  check "file at root (subdir)" has_line .todo/todo.md "- [ ] from subdir ($TODAY, branch: main)"
  check "no file in subdir" absent src/sub/.todo
  "${G[@]}" worktree add -q "$WORK/s16-wt" -b wt
  cd "$WORK/s16-wt" || return
  todo "/todo from worktree" >/dev/null
  check "file at worktree root" has_line .todo/todo.md "- [ ] from worktree ($TODAY, branch: wt)"
  check "worktree status clean" clean_status
}

S17() {
  new_repo "$WORK/s17"
  git checkout -q -b feature/x
  mkdir .todo && printf '# Todo\n\n- [ ] open one (2026-01-01, branch: main)\n- [x] done one (2026-01-01)\n- [ ] open two (2026-01-02, branch: main)\n' >.todo/todo.md
  out=$(todo "/todo list")
  check "first open item numbered with metadata" contains "$out" "1. open one (2026-01-01, branch: main)"
  check "second open item numbered with metadata" contains "$out" "2. open two (2026-01-02, branch: main)"
  check "done item hidden" lacks "$out" "done one"
}

S18() {
  new_repo "$WORK/s18"
  todo "/todo dedupe me" >/dev/null
  out=$(todo "/todo dedupe me")
  check "single line" line_count .todo/todo.md "dedupe me" 1
  check "reports duplicate" contains "$out" "Already on todo list: dedupe me"
}

S19() {
  new_repo "$WORK/s19"
  out=$(todo "/todo")
  check "no file created" absent .todo
  check "asks for the text" contains "$out" "What should go on the todo list?"
}

S20() {
  new_repo "$WORK/s20"
  out=$(todo "/todo list")
  check "reports empty" contains "$out" "Todo list is empty."
  check "no folder created" absent .todo
}

S21() {
  new_repo "$WORK/s21"
  mkdir .todo && printf '# Todo\n\n- [ ] alpha (2026-01-01)\n- [ ] beta (2026-01-01)\n' >.todo/todo.md
  cp .todo/todo.md "$WORK/s21.before"
  out=$(todo "/todo review")
  check "file unchanged" cmp -s "$WORK/s21.before" .todo/todo.md
  check "lists items instead" contains "$out" "1. alpha"
}

S22() {
  new_repo "$WORK/s22"
  mkdir .todo && printf '# Todo\n\n- [ ] alpha (2026-01-01)\n' >.todo/todo.md
  out=$(todo "/todo LIST")
  check "uppercase selects list" contains "$out" "1. alpha"
  check "LIST not added" lacks_line .todo/todo.md "- [ ] LIST ($TODAY, branch: main)"
}

S23() {
  new_repo "$WORK/s23"
  todo "/todo line one
line two" >/dev/null
  check "newline collapsed" has_line .todo/todo.md "- [ ] line one line two ($TODAY, branch: main)"
}

# Model-invoked skill use needs Skill(todo:todo) approval; granted here as a user would.
S24() {
  new_repo "$WORK/s24"
  todo "Use the todo skill to record the item 'check flaky retry test'. Afterwards, create the file notes.txt containing hi." \
    --allowedTools "Skill(todo:todo)" >/dev/null
  check "todo item recorded" line_count .todo/todo.md "check flaky retry test" 1
  check "skill grant does not cover notes.txt" absent notes.txt
}

S26() {
  new_repo "$WORK/s26"
  calls=$(tool_calls "/todo hook path item")
  check "typed add makes no tool call" no_output "$calls"
  check "item written once" line_count .todo/todo.md "hook path item" 1
}

# With hooks disabled nothing pre-approves the fallback's calls; the grants stand in for a user approving the prompts.
S27() {
  new_repo "$WORK/s27"
  todo "/todo fallback item" --settings '{"disableAllHooks": true}' \
    --allowedTools "Read" "Write" "Edit" "Bash(git rev-parse --show-toplevel)" "Bash(git branch --show-current)" "Bash(date +%F)" >/dev/null
  check "fallback adds the item with hooks disabled" has_line .todo/todo.md "- [ ] fallback item ($TODAY, branch: main)"
}

S28() {
  new_repo "$WORK/s28"
  calls=$(tool_calls "Use the todo skill to record the item 'self initiated item'. Do nothing else.")
  check "Claude's add makes only the Skill call" [ "$calls" = "Skill" ]
  check "item carries by: claude" has_line .todo/todo.md "- [ ] self initiated item ($TODAY, branch: main, by: claude)"
}

# --- Mod (Claude Code 2.1.287 or later) ---

S29() {
  new_repo "$WORK/s29"
  out=$(todo_json "/todo mod item")
  check "typed add starts no model turn" [ "$(jq -r '.num_turns' <<<"$out")" = "0" ]
  check "command output confirms" contains "$(jq -r '.result' <<<"$out")" "Added to todo list: mod item"
  check "item written once" line_count .todo/todo.md "mod item" 1
}

S30() {
  new_repo "$WORK/s30"
  log=$(transcript "Use the todo skill to record the item 'mod self item'. Do nothing else.")
  calls=$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' <<<"$log")
  check "Claude's add makes only the Skill call" [ "$calls" = "Skill" ]
  check "skill body not loaded" lacks "$log" "## 0. Hook result"
  check "item carries by: claude" has_line .todo/todo.md "- [ ] mod self item ($TODAY, branch: main, by: claude)"
}

S31() {
  new_repo "$WORK/s31"
  mkdir .todo && printf '# Todo\n\n- [ ] alpha (2026-01-01)\n' >.todo/todo.md
  out=$(todo_json "/todo list")
  check "typed list starts no model turn" [ "$(jq -r '.num_turns' <<<"$out")" = "0" ]
  check "list text" contains "$(jq -r '.result' <<<"$out")" "1. alpha (2026-01-01)"
}

# --- Tags ---

S34() {
  new_repo "$WORK/s34"
  out=$(todo_json "/todo tagged item #Auth #urgent")
  check "tagged add starts no model turn" [ "$(jq -r '.num_turns' <<<"$out")" = "0" ]
  check "text confirmed without tags" contains "$(jq -r '.result' <<<"$out")" "Added to todo list: tagged item"
  check "tags stored" has_line .todo/todo.md "- [ ] tagged item ($TODAY, branch: main, tags: auth, urgent)"
}

S35() {
  new_repo "$WORK/s35"
  mkdir .todo && printf '# Todo\n\n- [ ] a (2026-01-01, tags: auth)\n- [ ] b (2026-01-02)\n' >.todo/todo.md
  out=$(todo_json "/todo list #auth")
  check "filtered list starts no model turn" [ "$(jq -r '.num_turns' <<<"$out")" = "0" ]
  check "matching item listed" contains "$(jq -r '.result' <<<"$out")" "1. a (2026-01-01, tags: auth)"
  check "other item absent" lacks "$(jq -r '.result' <<<"$out")" "b (2026-01-02)"
}

# Hooks disabled: the skill's fallback must store the same tags field.
S36() {
  new_repo "$WORK/s36"
  todo "/todo fallback tagged #ops" --settings '{"disableAllHooks": true}' \
    --allowedTools "Read" "Write" "Edit" "Bash(git rev-parse --show-toplevel)" "Bash(git branch --show-current)" "Bash(date +%F)" >/dev/null
  check "fallback stores the tags field" has_line .todo/todo.md "- [ ] fallback tagged ($TODAY, branch: main, tags: ops)"
}

ALL=(S1 S2 S3 S4 S5 S8 S10 S11 S13 S14 S15 S16 S17 S18 S19 S20 S21 S22 S23 S24 S26 S27 S28 S29 S30 S31 S34 S35 S36)
[ $# -gt 0 ] && ALL=("$@")

echo "todo e2e: model=$MODEL, $(claude --version 2>/dev/null)"
for id in "${ALL[@]}"; do
  echo "$id"
  ("$id")
done | tee "$WORK/log"
passed=$(grep -c '^  ok ' "$WORK/log")
failed=$(grep -c '^  FAIL ' "$WORK/log")
echo "$passed checks passed, $failed failed"
[ "$failed" -eq 0 ]
