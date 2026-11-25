#!/usr/bin/env bash
# Unit tests for the todo hook scripts. Exit 0 on success, 1 on failure.
# Usage: bash plugins/todo/tests/run.sh   (ROOT is the plugin directory)
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/hooks/allow-todo-write.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hooks-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# expect <label> <allow|none> <tool_name> <file_path> [cwd]
# cwd defaults to the directory that contains .todo/.
expect() {
  local label=$1 want=$2 tool=$3 path=$4 cwd=${5-${4%%/.todo/*}} input out got
  input=$(printf '{"session_id":"t","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$cwd" "$tool" "$path")
  out=$(printf '%s' "$input" | bash "$HOOK" 2>/dev/null)
  if grep -q '"permissionDecision": *"allow"' <<<"$out"; then got=allow; else got=none; fi
  if [ "$got" = "$want" ]; then
    echo "PASS $label"
    passed=$((passed + 1))
  else
    echo "FAIL $label: expected $want, got $got (output: $out)"
    failed=$((failed + 1))
  fi
}

mkdir -p "$WORK/repo/.todo" "$WORK/elsewhere" "$WORK/linked"
ln -s "$WORK/elsewhere" "$WORK/linked/.todo"
ln -s "$WORK/elsewhere/target.md" "$WORK/repo/.todo/todo.md"
mkdir -p "$WORK/plain/.todo" "$WORK/fresh"

expect "todo.md in new folder" allow Write "$WORK/fresh/.todo/todo.md"
expect "gitignore in existing folder" allow Write "$WORK/plain/.todo/.gitignore"
expect "Edit of todo.md" allow Edit "$WORK/plain/.todo/todo.md"
expect "other file in project" none Write "$WORK/plain/notes.txt"
expect "other file in .todo" none Write "$WORK/plain/.todo/evil.sh"
expect "parent traversal" none Write "$WORK/plain/.todo/../notes/todo.md"
expect "dot segment" none Write "$WORK/plain/./.todo/todo.md"
expect "relative path" none Write ".todo/todo.md"
expect "inside .claude" none Write "$WORK/plain/.claude/.todo/todo.md"
expect "inside .git" none Write "$WORK/plain/.git/.todo/todo.md"
expect "symlinked .todo folder" none Write "$WORK/linked/.todo/todo.md"
expect "symlinked todo file" none Write "$WORK/repo/.todo/todo.md"
expect "non-edit tool" none Bash "$WORK/plain/.todo/todo.md"
expect "escaped quote in path" none Write "$WORK/plain/x\\\"y/.todo/todo.md"

# Project boundary: only <git root of cwd, or cwd>/.todo/ is allowed.
mkdir -p "$WORK/gitrepo/src/sub" "$WORK/other" "$WORK/elsewhere2"
git -C "$WORK/gitrepo" init -q
ln -s "$WORK/elsewhere2" "$WORK/plain/link"
ln -s "$WORK/gitrepo" "$WORK/repolink"
expect "outside the project" none Write "$WORK/other/.todo/todo.md" "$WORK/plain"
expect "git root from subdirectory" allow Write "$WORK/gitrepo/.todo/todo.md" "$WORK/gitrepo/src/sub"
expect "nested .todo below root" none Write "$WORK/gitrepo/src/.todo/todo.md" "$WORK/gitrepo/src/sub"
expect "symlinked parent directory" none Write "$WORK/plain/link/.todo/todo.md" "$WORK/plain"
expect "root reached through symlink" allow Write "$WORK/repolink/.todo/todo.md" "$WORK/gitrepo"
expect "missing cwd" none Write "$WORK/plain/.todo/todo.md" ""
mkdir -p "$WORK/wtrepo" "$WORK/nogit/.claude"
git -C "$WORK/wtrepo" init -q
git -C "$WORK/wtrepo" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m init
git -C "$WORK/wtrepo" worktree add -q -b wt "$WORK/wtrepo/.claude/worktrees/wt"
expect "main checkout todo from a worktree" allow Write "$WORK/wtrepo/.todo/todo.md" "$WORK/wtrepo/.claude/worktrees/wt"
expect "worktree-local todo" none Write "$WORK/wtrepo/.claude/worktrees/wt/.todo/todo.md"
expect "Read of the main checkout todo from a worktree" allow Read "$WORK/wtrepo/.todo/todo.md" "$WORK/wtrepo/.claude/worktrees/wt"
expect "Read of another file in .todo" none Read "$WORK/wtrepo/.todo/evil.md" "$WORK/wtrepo/.claude/worktrees/wt"
expect "non-git cwd .claude root" none Write "$WORK/nogit/.claude/.todo/todo.md"

# Write may only create; existing files must be changed with Edit.
mkdir -p "$WORK/full/.todo" && printf '# Todo\n' >"$WORK/full/.todo/todo.md"
expect "Write over existing todo" none Write "$WORK/full/.todo/todo.md"
expect "Edit of existing todo" allow Edit "$WORK/full/.todo/todo.md"

out=$(printf 'not json' | bash "$HOOK" 2>/dev/null)
rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
  echo "PASS malformed input yields no decision"
  passed=$((passed + 1))
else
  echo "FAIL malformed input: rc=$rc output=$out"
  failed=$((failed + 1))
fi

SESSION_HOOK="$ROOT/hooks/session-start.sh"
out=$(printf '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$SESSION_HOOK" 2>/dev/null)
rc=$?
if [ "$rc" -eq 0 ] &&
  grep -q '"hookEventName": *"SessionStart"' <<<"$out" &&
  grep -q 'todo:capture' <<<"$out" &&
  jq -e . >/dev/null 2>&1 <<<"$out"; then
  echo "PASS session-start emits valid JSON context naming the skill"
  passed=$((passed + 1))
else
  echo "FAIL session-start: rc=$rc output=$out"
  failed=$((failed + 1))
fi

# Reminder after compact, clear and resume: the open items of the session's view, read-only.
context_of() { jq -r '.hookSpecificOutput.additionalContext' <<<"$1"; }
session_start() { printf '{"hook_event_name":"SessionStart","source":"%s","cwd":"%s"}' "$1" "$2" | bash "$SESSION_HOOK" 2>/dev/null; }
check_reminder() {
  local label=$1 got=$2 want=$3
  if [ "$got" = "$want" ]; then
    echo "PASS $label"
    passed=$((passed + 1))
  else
    echo "FAIL $label: got [$got] want [$want]"
    failed=$((failed + 1))
  fi
}
RREPO="$WORK/remind"
mkdir -p "$RREPO"
git -C "$RREPO" init -q -b main
git -C "$RREPO" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m init
git -C "$RREPO" worktree add -q -b a "$RREPO/.claude/worktrees/a"
git -C "$RREPO" worktree add -q -b b "$RREPO/.claude/worktrees/b"
mkdir -p "$RREPO/.todo"
printf '# Todo\n\n- [ ] repo one (2026-01-01, branch: main, tags: x)\n- [ ] gone one (2026-01-01, worktree: dead)\n- [ ] mine "quoted" (2026-01-01, branch: a, worktree: a)\n- [ ] theirs (2026-01-01, worktree: b)\n- [x] closed (2026-01-01, worktree: a)\n' >"$RREPO/.todo/todo.md"
before=$(cat "$RREPO/.todo/todo.md")
out=$(session_start startup "$RREPO/.claude/worktrees/a")
check_reminder "startup adds no reminder" "$(context_of "$out" | grep -c 'Open todo items')" 0
out=$(session_start compact "$RREPO/.claude/worktrees/a")
check_reminder "compact in a worktree lists own items, then repo-wide, without removed or other worktrees" \
  "$(context_of "$out" | grep -o 'Open todo items.*')" 'Open todo items (2): 1. mine "quoted" 2. repo one'
check_reminder "reminder output is valid JSON" "$(jq -e . >/dev/null 2>&1 <<<"$out" && echo ok)" ok
out=$(session_start resume "$RREPO")
check_reminder "resume in the main checkout lists repo-wide first, then worktrees" \
  "$(context_of "$out" | grep -o 'Open todo items.*')" 'Open todo items (3): 1. repo one 2. mine "quoted" 3. theirs'
check_reminder "the reminder never writes the file" "$(cat "$RREPO/.todo/todo.md")" "$before"
{
  printf '# Todo\n\n'
  for n in 1 2 3 4 5 6 7 8 9; do printf -- '- [ ] item %s (2026-01-01)\n' "$n"; done
} >"$RREPO/.todo/todo.md"
out=$(session_start clear "$RREPO")
check_reminder "nine items list eight" "$(context_of "$out" | grep -o 'Open todo items.*')" \
  'Open todo items (9): 1. item 1 2. item 2 3. item 3 4. item 4 5. item 5 6. item 6 7. item 7 8. item 8'
out=$(session_start compact "$WORK/fresh")
check_reminder "no todo file adds no reminder" "$(context_of "$out" | grep -c 'Open todo items')" 0
# shellcheck disable=SC2016  # literal text the rule must contain
check_reminder "the rule tells Claude to close parked questions with done" "$(context_of "$out" | grep -c '#question.*done <item text>')" 1

# 0.8: no Python hook; the skill texts describe the main-checkout list, the worktree field and done.
check_text() {
  local label=$1
  shift
  if "$@"; then
    echo "PASS $label"
    passed=$((passed + 1))
  else
    echo "FAIL $label"
    failed=$((failed + 1))
  fi
}
# shellcheck disable=SC2016  # $1 expands in the child shell
check_text "no Python in hooks or skills" bash -c '! grep -rIqi python "$1/hooks" "$1/skills"' _ "$ROOT"
# shellcheck disable=SC2016  # $1 expands in the child shell
check_text "hooks.json routes Read to the allow hook" grep -q '"matcher": "Read|Edit|Write"' "$ROOT/hooks/hooks.json"
# shellcheck disable=SC2016  # $1 expands in the child shell
check_text "hooks.json registers no prompt or tool hook" bash -c '! grep -Eq "UserPromptExpansion|PostToolUse" "$1/hooks/hooks.json"' _ "$ROOT"
# shellcheck disable=SC2016  # literal text the procedures must contain
check_text "fallback.md locates the main checkout" grep -Fq 'git rev-parse --path-format=absolute --git-common-dir' "$ROOT/skills/capture/fallback.md"
check_text "fallback.md writes the worktree field" grep -Fq ', worktree: ' "$ROOT/skills/capture/fallback.md"
check_text "fallback.md has a Done section" grep -q '^## Done' "$ROOT/skills/capture/fallback.md"
check_text "SKILL.md knows TODO_DONE" grep -Fq 'TODO_DONE' "$ROOT/skills/capture/SKILL.md"
# shellcheck disable=SC2016  # $1 expands in the child shell
check_text "SKILL.md drops the hook-only markers" bash -c '! grep -Eq "TODO_(REVIEW|LIST|EMPTY)" "$1"' _ "$ROOT/skills/capture/SKILL.md"
# shellcheck disable=SC2016  # literal text the skill must contain
check_text "SKILL.md routes done to fallback.md" grep -Fq '`done <text>`' "$ROOT/skills/capture/SKILL.md"

# Skill context budget: SKILL.md is injected on every invocation, including Claude's own adds,
# so it holds only the decision logic; the fallback and review procedures live in files read on demand.
SKILL_DIR="$ROOT/skills/capture"
SKILL_MAX_BYTES=4500
DESCRIPTION_MAX_CHARS=250
skill_bytes=$(wc -c <"$SKILL_DIR/SKILL.md" | tr -d ' ')
if [ "$skill_bytes" -le "$SKILL_MAX_BYTES" ]; then
  echo "PASS SKILL.md within $SKILL_MAX_BYTES bytes"
  passed=$((passed + 1))
else
  echo "FAIL SKILL.md is $skill_bytes bytes, limit $SKILL_MAX_BYTES"
  failed=$((failed + 1))
fi
# Claude Code substitutes ${CLAUDE_SKILL_DIR} in skill text, so the files are named by absolute path.
for doc in fallback.md review.md; do
  # shellcheck disable=SC2016  # the literal placeholder is what the skill must contain
  if [ -f "$SKILL_DIR/$doc" ] && grep -Fq '${CLAUDE_SKILL_DIR}/'"$doc" "$SKILL_DIR/SKILL.md"; then
    echo "PASS SKILL.md references existing $doc via CLAUDE_SKILL_DIR"
    passed=$((passed + 1))
  else
    echo "FAIL $doc missing or not referenced as \${CLAUDE_SKILL_DIR}/$doc from SKILL.md"
    failed=$((failed + 1))
  fi
done
# The user's reply to the empty-argument question does not run the hook, so the row that handles
# it must name the add procedure explicitly.
# shellcheck disable=SC2016  # the literal placeholder is what the skill must contain
if grep -F 'What should go on the todo list?' "$SKILL_DIR/SKILL.md" | grep -Fq '${CLAUDE_SKILL_DIR}/fallback.md'; then
  echo "PASS empty-argument row names fallback.md for the follow-up add"
  passed=$((passed + 1))
else
  echo "FAIL the empty-argument row must reference \${CLAUDE_SKILL_DIR}/fallback.md for the follow-up add"
  failed=$((failed + 1))
fi
# Without the hook, review locates and reads the file itself, so the procedure must state the
# reply for a missing file or no open items, as the fallback's List section does.
for doc in fallback.md review.md; do
  # shellcheck disable=SC2016  # the backticks are literal markdown in the procedure
  if grep -Fq 'print `Todo list is empty.`' "$SKILL_DIR/$doc"; then
    echo "PASS $doc states the empty-todo reply"
    passed=$((passed + 1))
  else
    echo "FAIL $doc must tell the model to print 'Todo list is empty.' when there are no open items"
    failed=$((failed + 1))
  fi
done
# shellcheck disable=SC2016  # the backticks are literal markdown in the skill
if grep -Fq '`Todo failed: <reason>`' "$SKILL_DIR/SKILL.md" && ! grep -Fq 'Todo add failed' "$SKILL_DIR/SKILL.md"; then
  echo "PASS failure reply is mode-neutral"
  passed=$((passed + 1))
else
  echo "FAIL failure reply must be 'Todo failed: <reason>' for add, list and review"
  failed=$((failed + 1))
fi
description=$(sed -n 's/^description: *//p' "$SKILL_DIR/SKILL.md" | head -1)
if [ -n "$description" ] && [ "${#description}" -le "$DESCRIPTION_MAX_CHARS" ]; then
  echo "PASS skill description within $DESCRIPTION_MAX_CHARS characters"
  passed=$((passed + 1))
else
  echo "FAIL skill description is ${#description} characters, limit $DESCRIPTION_MAX_CHARS"
  failed=$((failed + 1))
fi
# Tags: the mode table names the filter, and the fallback stores the same field the hooks write.
# shellcheck disable=SC2016  # literal placeholders from the skill text
if grep -Fq '`list #<tag>`' "$SKILL_DIR/SKILL.md" && grep -Fq ', tags: ' "$SKILL_DIR/fallback.md" && grep -Fq 'the item has no text' "$SKILL_DIR/fallback.md"; then
  echo "PASS skill texts describe tags"
  passed=$((passed + 1))
else
  echo "FAIL SKILL.md must list the list #<tag> mode and fallback.md must store ', tags: ' and refuse 'the item has no text'"
  failed=$((failed + 1))
fi

echo "$passed passed, $failed failed"

# Bun runs the store and pure tests (its node:test support); the shell checks above do not need it.
echo
if command -v bun >/dev/null 2>&1; then
  bun test "$ROOT/tests/mod/" || failed=$((failed + 1))
else
  echo "SKIP mod tests: bun not on PATH"
fi

# The hook-driven tests run on the engine's own kit (tests/kit/*.test.ts).
echo
if command -v claude >/dev/null 2>&1 && claude plugin test --help >/dev/null 2>&1; then
  claude plugin test "$ROOT" || failed=$((failed + 1))
else
  echo "SKIP kit tests: claude plugin test not available"
fi
[ "$failed" -eq 0 ]
