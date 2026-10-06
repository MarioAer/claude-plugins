#!/usr/bin/env bash
# SessionStart hook: a skill description alone does not make Claude record out-of-scope findings
# while it works on another task; this short context instruction does.
cat <<'JSON'
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "The backlog plugin is installed. When you notice a concrete defect or follow-up outside the scope of the current task, record it with the Skill tool (skill \"backlog:backlog\", args: the item text) instead of only mentioning it in your reply, then continue the current task. At most two such items per task."}}
JSON
