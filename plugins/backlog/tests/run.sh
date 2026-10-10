#!/usr/bin/env bash
# Unit tests for the backlog hook scripts. Exit 0 on success, 1 on failure.
# Usage: bash plugins/backlog/tests/run.sh   (ROOT is the plugin directory)
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/hooks/allow-backlog-write.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hooks-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# expect <label> <allow|none> <tool_name> <file_path> [cwd]
# cwd defaults to the directory that contains .backlog/.
expect() {
  local label=$1 want=$2 tool=$3 path=$4 cwd=${5-${4%%/.backlog/*}} input out got
  input=$(printf '{"session_id":"t","cwd":"%s","hook_event_name":"PreToolUse","tool_name":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$cwd" "$tool" "$path")
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
mkdir -p "$WORK/plain/.backlog" "$WORK/fresh"

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

# Project boundary: only <git root of cwd, or cwd>/.backlog/ is allowed.
mkdir -p "$WORK/gitrepo/src/sub" "$WORK/other" "$WORK/elsewhere2"
git -C "$WORK/gitrepo" init -q
ln -s "$WORK/elsewhere2" "$WORK/plain/link"
ln -s "$WORK/gitrepo" "$WORK/repolink"
expect "outside the project"            none  Write "$WORK/other/.backlog/backlog.md" "$WORK/plain"
expect "git root from subdirectory"     allow Write "$WORK/gitrepo/.backlog/backlog.md" "$WORK/gitrepo/src/sub"
expect "nested .backlog below root"     none  Write "$WORK/gitrepo/src/.backlog/backlog.md" "$WORK/gitrepo/src/sub"
expect "symlinked parent directory"     none  Write "$WORK/plain/link/.backlog/backlog.md" "$WORK/plain"
expect "root reached through symlink"   allow Write "$WORK/repolink/.backlog/backlog.md" "$WORK/gitrepo"
expect "missing cwd"                    none  Write "$WORK/plain/.backlog/backlog.md" ""

# Write may only create; existing files must be changed with Edit.
mkdir -p "$WORK/full/.backlog" && printf '# Backlog\n' >"$WORK/full/.backlog/backlog.md"
expect "Write over existing backlog"    none  Write "$WORK/full/.backlog/backlog.md"
expect "Edit of existing backlog"       allow Edit  "$WORK/full/.backlog/backlog.md"

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
  && grep -q 'backlog:backlog' <<<"$out" \
  && python3 -c 'import json,sys; json.loads(sys.argv[1])' "$out" 2>/dev/null; then
  echo "PASS session-start emits valid JSON context naming the skill"; passed=$((passed + 1))
else
  echo "FAIL session-start: rc=$rc output=$out"; failed=$((failed + 1))
fi

echo "$passed passed, $failed failed"

# The add hook has its own fixtures; run them here so CI needs one entry point.
echo
bash "$ROOT/tests/add-hook.sh" || failed=$((failed + 1))
[ "$failed" -eq 0 ]
