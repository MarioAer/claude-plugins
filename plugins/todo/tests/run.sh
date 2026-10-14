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
    echo "PASS $label"; passed=$((passed + 1))
  else
    echo "FAIL $label: expected $want, got $got (output: $out)"; failed=$((failed + 1))
  fi
}

mkdir -p "$WORK/repo/.todo" "$WORK/elsewhere" "$WORK/linked"
ln -s "$WORK/elsewhere" "$WORK/linked/.todo"
ln -s "$WORK/elsewhere/target.md" "$WORK/repo/.todo/todo.md"
mkdir -p "$WORK/plain/.todo" "$WORK/fresh"

expect "todo.md in new folder"       allow Write "$WORK/fresh/.todo/todo.md"
expect "gitignore in existing folder"   allow Write "$WORK/plain/.todo/.gitignore"
expect "Edit of todo.md"             allow Edit  "$WORK/plain/.todo/todo.md"
expect "other file in project"          none  Write "$WORK/plain/notes.txt"
expect "other file in .todo"         none  Write "$WORK/plain/.todo/evil.sh"
expect "parent traversal"               none  Write "$WORK/plain/.todo/../notes/todo.md"
expect "dot segment"                    none  Write "$WORK/plain/./.todo/todo.md"
expect "relative path"                  none  Write ".todo/todo.md"
expect "inside .claude"                 none  Write "$WORK/plain/.claude/.todo/todo.md"
expect "inside .git"                    none  Write "$WORK/plain/.git/.todo/todo.md"
expect "symlinked .todo folder"      none  Write "$WORK/linked/.todo/todo.md"
expect "symlinked todo file"         none  Write "$WORK/repo/.todo/todo.md"
expect "non-edit tool"                  none  Bash  "$WORK/plain/.todo/todo.md"
expect "escaped quote in path"          none  Write "$WORK/plain/x\\\"y/.todo/todo.md"

# Project boundary: only <git root of cwd, or cwd>/.todo/ is allowed.
mkdir -p "$WORK/gitrepo/src/sub" "$WORK/other" "$WORK/elsewhere2"
git -C "$WORK/gitrepo" init -q
ln -s "$WORK/elsewhere2" "$WORK/plain/link"
ln -s "$WORK/gitrepo" "$WORK/repolink"
expect "outside the project"            none  Write "$WORK/other/.todo/todo.md" "$WORK/plain"
expect "git root from subdirectory"     allow Write "$WORK/gitrepo/.todo/todo.md" "$WORK/gitrepo/src/sub"
expect "nested .todo below root"     none  Write "$WORK/gitrepo/src/.todo/todo.md" "$WORK/gitrepo/src/sub"
expect "symlinked parent directory"     none  Write "$WORK/plain/link/.todo/todo.md" "$WORK/plain"
expect "root reached through symlink"   allow Write "$WORK/repolink/.todo/todo.md" "$WORK/gitrepo"
expect "missing cwd"                    none  Write "$WORK/plain/.todo/todo.md" ""

# Write may only create; existing files must be changed with Edit.
mkdir -p "$WORK/full/.todo" && printf '# Todo\n' >"$WORK/full/.todo/todo.md"
expect "Write over existing todo"    none  Write "$WORK/full/.todo/todo.md"
expect "Edit of existing todo"       allow Edit  "$WORK/full/.todo/todo.md"

out=$(printf 'not json' | bash "$HOOK" 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
  echo "PASS malformed input yields no decision"; passed=$((passed + 1))
else
  echo "FAIL malformed input: rc=$rc output=$out"; failed=$((failed + 1))
fi

SESSION_HOOK="$ROOT/hooks/session-start.sh"
out=$(printf '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$SESSION_HOOK" 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ] \
  && grep -q '"hookEventName": *"SessionStart"' <<<"$out" \
  && grep -q 'todo:todo' <<<"$out" \
  && python3 -c 'import json,sys; json.loads(sys.argv[1])' "$out" 2>/dev/null; then
  echo "PASS session-start emits valid JSON context naming the skill"; passed=$((passed + 1))
else
  echo "FAIL session-start: rc=$rc output=$out"; failed=$((failed + 1))
fi

# Skill context budget: SKILL.md is injected on every invocation, including Claude's own adds,
# so it holds only the decision logic; the fallback and review procedures live in files read on demand.
SKILL_DIR="$ROOT/skills/todo"
SKILL_MAX_BYTES=4500
DESCRIPTION_MAX_CHARS=250
skill_bytes=$(wc -c <"$SKILL_DIR/SKILL.md" | tr -d ' ')
if [ "$skill_bytes" -le "$SKILL_MAX_BYTES" ]; then
  echo "PASS SKILL.md within $SKILL_MAX_BYTES bytes"; passed=$((passed + 1))
else
  echo "FAIL SKILL.md is $skill_bytes bytes, limit $SKILL_MAX_BYTES"; failed=$((failed + 1))
fi
# Claude Code substitutes ${CLAUDE_SKILL_DIR} in skill text, so the files are named by absolute path.
for doc in fallback.md review.md; do
  # shellcheck disable=SC2016  # the literal placeholder is what the skill must contain
  if [ -f "$SKILL_DIR/$doc" ] && grep -Fq '${CLAUDE_SKILL_DIR}/'"$doc" "$SKILL_DIR/SKILL.md"; then
    echo "PASS SKILL.md references existing $doc via CLAUDE_SKILL_DIR"; passed=$((passed + 1))
  else
    echo "FAIL $doc missing or not referenced as \${CLAUDE_SKILL_DIR}/$doc from SKILL.md"; failed=$((failed + 1))
  fi
done
# The user's reply to the empty-argument question does not run the hook, so the row that handles
# it must name the add procedure explicitly.
# shellcheck disable=SC2016  # the literal placeholder is what the skill must contain
if grep -F 'What should go on the todo list?' "$SKILL_DIR/SKILL.md" | grep -Fq '${CLAUDE_SKILL_DIR}/fallback.md'; then
  echo "PASS empty-argument row names fallback.md for the follow-up add"; passed=$((passed + 1))
else
  echo "FAIL the empty-argument row must reference \${CLAUDE_SKILL_DIR}/fallback.md for the follow-up add"; failed=$((failed + 1))
fi
# Without the hook, review locates and reads the file itself, so the procedure must state the
# reply for a missing file or no open items, as the fallback's List section does.
for doc in fallback.md review.md; do
  # shellcheck disable=SC2016  # the backticks are literal markdown in the procedure
  if grep -Fq 'print `Todo list is empty.`' "$SKILL_DIR/$doc"; then
    echo "PASS $doc states the empty-todo reply"; passed=$((passed + 1))
  else
    echo "FAIL $doc must tell the model to print 'Todo list is empty.' when there are no open items"; failed=$((failed + 1))
  fi
done
# shellcheck disable=SC2016  # the backticks are literal markdown in the skill
if grep -Fq '`Todo failed: <reason>`' "$SKILL_DIR/SKILL.md" && ! grep -Fq 'Todo add failed' "$SKILL_DIR/SKILL.md"; then
  echo "PASS failure reply is mode-neutral"; passed=$((passed + 1))
else
  echo "FAIL failure reply must be 'Todo failed: <reason>' for add, list and review"; failed=$((failed + 1))
fi
description=$(sed -n 's/^description: *//p' "$SKILL_DIR/SKILL.md" | head -1)
if [ -n "$description" ] && [ "${#description}" -le "$DESCRIPTION_MAX_CHARS" ]; then
  echo "PASS skill description within $DESCRIPTION_MAX_CHARS characters"; passed=$((passed + 1))
else
  echo "FAIL skill description is ${#description} characters, limit $DESCRIPTION_MAX_CHARS"; failed=$((failed + 1))
fi
# Tags: the mode table names the filter, and the fallback stores the same field the hooks write.
# shellcheck disable=SC2016  # literal placeholders from the skill text
if grep -Fq '`list #<tag>`' "$SKILL_DIR/SKILL.md" && grep -Fq ', tags: ' "$SKILL_DIR/fallback.md" && grep -Fq 'the item has no text' "$SKILL_DIR/fallback.md"; then
  echo "PASS skill texts describe tags"; passed=$((passed + 1))
else
  echo "FAIL SKILL.md must list the list #<tag> mode and fallback.md must store ', tags: ' and refuse 'the item has no text'"; failed=$((failed + 1))
fi

echo "$passed passed, $failed failed"

# The add hook has its own fixtures; run them here so CI needs one entry point.
echo
bash "$ROOT/tests/add-hook.sh" || failed=$((failed + 1))

# The mod's tests need Node 22 or later (node:test); the hook tests above do not.
echo
if command -v node >/dev/null 2>&1; then
  node --test "$ROOT/tests/mod/*.test.mjs" || failed=$((failed + 1))
else
  echo "SKIP mod tests: node not on PATH"
fi
[ "$failed" -eq 0 ]
