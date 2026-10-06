#!/usr/bin/env bash
# PreToolUse hook: allow Edit/Write of <dir>/.backlog/backlog.md and <dir>/.backlog/.gitignore.
# Skill allowed-tools are not applied reliably when Claude invokes the skill itself; this hook
# gives the same narrow grant deterministically. Any other input yields no decision (normal prompt).
set -u

input=$(cat)

[[ "$input" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"(Edit|Write)\" ]] || exit 0
# Paths containing escaped characters do not match and therefore get no decision.
[[ "$input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"\\]*)\" ]] || exit 0
path=${BASH_REMATCH[1]}

case "$path" in
  /*) ;;
  *) exit 0 ;;
esac
case "/$path/" in
  */../* | */./* | */.claude/* | */.git/*) exit 0 ;;
esac
case "$path" in
  */.backlog/backlog.md | */.backlog/.gitignore) ;;
  *) exit 0 ;;
esac

dir=${path%/*}
[ -L "$dir" ] && exit 0
[ -L "$path" ] && exit 0

cat <<'JSON'
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "backlog plugin: write to .backlog/"}}
JSON
