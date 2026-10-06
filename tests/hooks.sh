#!/usr/bin/env bash
# Unit tests for plugin hook scripts. Exit 0 on success, 1 on failure.
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/plugins/backlog/hooks/allow-backlog-write.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hooks-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# expect <label> <allow|none> <tool_name> <file_path>
expect() {
  local label=$1 want=$2 tool=$3 path=$4 input out got
  input=$(printf '{"session_id":"t","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$tool" "$path")
  out=$(printf '%s' "$input" | bash "$HOOK" 2>/dev/null)
  if grep -q '"permissionDecision": *"allow"' <<<"$out"; then got=allow; else got=none; fi
  if [ "$got" = "$want" ]; then
    echo "PASS $label"; passed=$((passed + 1))
  else
    echo "FAIL $label: expected $want, got $got (output: $out)"; failed=$((failed + 1))
  fi
}

mkdir -p "$WORK/repo/.backlog" "$WORK/elsewhere" "$WORK/linked"
ln -s "$WORK/elsewhere" "$WORK/linked/.backlog"
ln -s "$WORK/elsewhere/target.md" "$WORK/repo/.backlog/backlog.md"
mkdir -p "$WORK/plain/.backlog"

expect "backlog.md in new folder"       allow Write "$WORK/fresh/.backlog/backlog.md"
expect "gitignore in existing folder"   allow Write "$WORK/plain/.backlog/.gitignore"
expect "Edit of backlog.md"             allow Edit  "$WORK/plain/.backlog/backlog.md"
expect "other file in project"          none  Write "$WORK/plain/notes.txt"
expect "other file in .backlog"         none  Write "$WORK/plain/.backlog/evil.sh"
expect "parent traversal"               none  Write "$WORK/plain/.backlog/../notes/backlog.md"
expect "dot segment"                    none  Write "$WORK/plain/./.backlog/backlog.md"
expect "relative path"                  none  Write ".backlog/backlog.md"
expect "inside .claude"                 none  Write "$WORK/plain/.claude/.backlog/backlog.md"
expect "inside .git"                    none  Write "$WORK/plain/.git/.backlog/backlog.md"
expect "symlinked .backlog folder"      none  Write "$WORK/linked/.backlog/backlog.md"
expect "symlinked backlog file"         none  Write "$WORK/repo/.backlog/backlog.md"
expect "non-edit tool"                  none  Bash  "$WORK/plain/.backlog/backlog.md"
expect "escaped quote in path"          none  Write "$WORK/plain/x\\\"y/.backlog/backlog.md"

out=$(printf 'not json' | bash "$HOOK" 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
  echo "PASS malformed input yields no decision"; passed=$((passed + 1))
else
  echo "FAIL malformed input: rc=$rc output=$out"; failed=$((failed + 1))
fi

SESSION_HOOK="$ROOT/plugins/backlog/hooks/session-start.sh"
out=$(printf '{"hook_event_name":"SessionStart","source":"startup"}' | bash "$SESSION_HOOK" 2>/dev/null); rc=$?
if [ "$rc" -eq 0 ] \
  && grep -q '"hookEventName": *"SessionStart"' <<<"$out" \
  && grep -q 'backlog:backlog' <<<"$out" \
  && python3 -c 'import json,sys; json.loads(sys.argv[1])' "$out" 2>/dev/null; then
  echo "PASS session-start emits valid JSON context naming the skill"; passed=$((passed + 1))
else
  echo "FAIL session-start: rc=$rc output=$out"; failed=$((failed + 1))
fi

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
