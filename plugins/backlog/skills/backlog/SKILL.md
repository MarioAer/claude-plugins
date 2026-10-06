---
name: backlog
description: Record a deferred task in the project backlog (.claude/backlog.md) without interrupting the current task, list open items, or review them. Use when the user types /backlog, or when you discover out-of-scope work during a task that should be done later - add it with /backlog and continue the current task.
argument-hint: "[<task text> | list | review]"
allowed-tools: Read, Write, Edit, Bash(git rev-parse:*), Bash(git branch --show-current), Bash(git check-ignore:*), Bash(mkdir -p:*), Bash(date:*)
---
