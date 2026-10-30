#!/usr/bin/env bash
# Unit tests for the geparkt hook and mod. Exit 0 on success, 1 on failure.
# Usage: bash plugins/geparkt/tests/run.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOOK="$ROOT/hooks/geparkt-hook.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/geparkt-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0
check() {
  if [ "$2" = ok ]; then
    echo "PASS $1"
    passed=$((passed + 1))
  else
    echo "FAIL $1: $3"
    failed=$((failed + 1))
  fi
}
# context <json input> prints the additionalContext of the hook's answer, or nothing.
context() {
  printf '%s' "$1" | bash "$HOOK" 2>/dev/null | python3 -c 'import json,sys
t=sys.stdin.read()
print(json.loads(t)["hookSpecificOutput"]["additionalContext"] if t.strip() else "")'
}
skill_event() {
  printf '{"hook_event_name":"PostToolUse","session_id":"%s","cwd":"%s","tool_name":"Skill","tool_input":{"skill":"%s","args":"%s"}}' "$1" "$2" "$3" "$4"
}

mkdir -p "$WORK/repo" && git -C "$WORK/repo" init -q
REPO=$(cd "$WORK/repo" && pwd -P)

out=$(context "$(printf '{"hook_event_name":"SessionStart","session_id":"s1","cwd":"%s","source":"startup"}' "$REPO")")
rule=$(cat "$ROOT/hooks/rule.txt")
if [ "$out" = "$rule" ]; then check "session start without threads adds the rule alone" ok; else check "session start rule" fail "$out"; fi

out=$(context "$(skill_event s1 "$REPO" geparkt:geparkt '+q Use Postgres? | +t retry policy')")
case "$out" in "GEPARKT_OK: +1 +2 | open: #1 q Use Postgres?; #2 t retry policy"*) check "hook records a batch" ok ;; *) check "hook records a batch" fail "$out" ;; esac

out=$(context "$(skill_event s1 "$REPO" geparkt:geparkt 'r1 Postgres | +q B? | x7')")
case "$out" in "GEPARKT_FAILED: #7 is not a thread"*) check "a bad id refuses the batch" ok ;; *) check "bad id" fail "$out" ;; esac

out=$(context "$(skill_event s1 "$REPO" geparkt:geparkt 'r1 Postgres')")
case "$out" in "GEPARKT_OK: r1 | open: #2 t retry policy"*) check "hook resolves" ok ;; *) check "hook resolves" fail "$out" ;; esac

if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); t=d["threads"][0]; assert (t["status"],t["decision"],t["by"])==("resolved","Postgres","claude")' "$REPO/.geparkt/s1.json" 2>/dev/null &&
  [ "$(cat "$REPO/.geparkt/.gitignore")" = '*' ]; then
  check "file holds the decision and the folder ignores itself" ok
else check "file contents" fail "$(cat "$REPO/.geparkt/s1.json")"; fi

out=$(context "$(printf '{"hook_event_name":"SessionStart","session_id":"s1","cwd":"%s","source":"compact"}' "$REPO")")
case "$out" in "$rule"$'\n'"Open threads (geparkt): #2 t retry policy."*) check "session start re-injects open threads" ok ;; *) check "re-inject" fail "$out" ;; esac

out=$(context "$(printf '{"hook_event_name":"UserPromptExpansion","session_id":"s1","cwd":"%s","command_name":"geparkt:geparkt","command_args":""}' "$REPO")")
case "$out" in "GEPARKT_LIST:"$'\n'"#2 topic · retry policy"*) check "typed /geparkt lists" ok ;; *) check "list" fail "$out" ;; esac

out=$(context "$(skill_event s1 "$REPO" geparkt:geparkt 'r1 Postgres')")
case "$out" in "GEPARKT_OK: ~1 | open: #2 t retry policy"*) check "closing twice changes nothing" ok ;; *) check "closing twice" fail "$out" ;; esac

for bad in '[]' 'null' '{"next": 2, "threads": [{"id": 1}]}' '{"next": 2'; do
  printf '%s' "$bad" >"$REPO/.geparkt/bad.json"
  out=$(context "$(skill_event bad "$REPO" geparkt:geparkt '+q A?')")
  case "$out" in "GEPARKT_FAILED: $REPO/.geparkt/bad.json is not a geparkt file"*) ;; *) check "bad file $bad" fail "$out" ;; esac
  [ "$(cat "$REPO/.geparkt/bad.json")" = "$bad" ] || check "bad file $bad kept" fail "overwritten"
done
check "a file that does not read is refused and kept" ok

out=$(context "$(skill_event s1 "$REPO" todo:todo 'x')")
if [ -z "$out" ]; then check "other skills are ignored" ok; else check "other skills" fail "$out"; fi

out=$(context "$(skill_event '../x' "$REPO" geparkt:geparkt '+q A?')")
case "$out" in "GEPARKT_FAILED: the session id is not a plain name"*) check "odd session ids are refused" ok ;; *) check "session id" fail "$out" ;; esac

mkdir -p "$WORK/linked" "$WORK/elsewhere" && ln -s "$WORK/elsewhere" "$WORK/linked/.geparkt"
out=$(context "$(skill_event s1 "$WORK/linked" geparkt:geparkt '+q A?')")
case "$out" in "GEPARKT_FAILED:"*symlink*) check "a symlinked folder is refused" ok ;; *) check "symlink" fail "$out" ;; esac

out=$(printf 'not json' | bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then check "malformed input yields nothing" ok; else check "malformed" fail "$out"; fi

# The rule is the plugin's whole per-session cost; keep it short.
bytes=$(wc -c <"$ROOT/hooks/rule.txt" | tr -d ' ')
if [ "$bytes" -le 400 ]; then check "rule within 400 bytes" ok; else check "rule size" fail "$bytes bytes"; fi
bytes=$(wc -c <"$ROOT/skills/geparkt/SKILL.md" | tr -d ' ')
if [ "$bytes" -le 2000 ]; then check "SKILL.md within 2000 bytes" ok; else check "SKILL.md size" fail "$bytes bytes"; fi

echo "$passed passed, $failed failed"

# The mod's tests need Node 22 or later (node:test); the hook tests above do not.
echo
if command -v node >/dev/null 2>&1; then
  node --test "$ROOT/tests/mod/"*.test.mjs || failed=$((failed + 1))
else
  echo "SKIP mod tests: node not on PATH"
fi
[ "$failed" -eq 0 ]
