#!/usr/bin/env bash
# UserPromptExpansion and PostToolUse(Skill) hook: performs /todo add and list via todo_hook.py.
# Exits 0 without output unless the input names todo:todo and python3 is available, so a
# missing interpreter or a crash never shows a hook error in unrelated work.
input=$(cat)
case "$input" in
  *todo:todo*) ;;
  *) exit 0 ;;
esac
command -v python3 >/dev/null 2>&1 || exit 0
printf '%s' "$input" | python3 "$(dirname "$0")/todo_hook.py" 2>/dev/null
exit 0
