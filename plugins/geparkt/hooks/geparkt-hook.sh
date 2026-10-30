#!/usr/bin/env bash
# SessionStart, UserPromptExpansion and PostToolUse(Skill) hook, via geparkt_hook.py. Without
# python3, SessionStart still adds the rule; the other events exit 0 without output, so a missing
# interpreter or a crash never shows a hook error in unrelated work.
dir=$(dirname "$0")
input=$(cat)
case "$input" in
*'"SessionStart"'* | *geparkt:geparkt*) ;;
*) exit 0 ;;
esac
if ! command -v python3 >/dev/null 2>&1; then
  case "$input" in
  *'"SessionStart"'*)
    jq -cn --rawfile rule "$dir/rule.txt" \
      '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: ($rule | rtrimstr("\n"))}}' 2>/dev/null
    ;;
  esac
  exit 0
fi
printf '%s' "$input" | python3 "$dir/geparkt_hook.py" 2>/dev/null
exit 0
