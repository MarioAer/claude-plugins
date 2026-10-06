#!/usr/bin/env bash
# PreToolUse hook: allow Edit/Write of <root>/.backlog/backlog.md and <root>/.backlog/.gitignore,
# where <root> is the git root of the session's cwd (or cwd outside git). Write is allowed only to
# create a file. Skill allowed-tools are dropped when Claude invokes the skill itself and the Skill
# tool finishes before the response stream ends (https://github.com/anthropics/claude-code/issues/99353);
# this hook gives the same narrow grant deterministically. Remove it once that issue is fixed.
# Any other input yields no decision.
set -u

input=$(cat)

[[ "$input" =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"(Edit|Write)\" ]] || exit 0
tool=${BASH_REMATCH[1]}
# Values containing escaped characters do not match and therefore get no decision.
[[ "$input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"\\]*)\" ]] || exit 0
path=${BASH_REMATCH[1]}
[[ "$input" =~ \"cwd\"[[:space:]]*:[[:space:]]*\"([^\"\\]+)\" ]] || exit 0
cwd=${BASH_REMATCH[1]}

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

# The target must be exactly <root>/.backlog/<file>, compared with symlinks resolved.
[ -d "$cwd" ] || exit 0
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=$cwd
root=$(cd -P "$root" 2>/dev/null && pwd) || exit 0
backlog_dir=${path%/*}
[ -L "$backlog_dir" ] && exit 0
parent=$(cd -P "${backlog_dir%/*}" 2>/dev/null && pwd) || exit 0
[ "$parent" = "$root" ] || exit 0

[ -L "$path" ] && exit 0
if [ "$tool" = Write ] && [ -e "$path" ]; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "backlog plugin: write to .backlog/"}}
JSON
