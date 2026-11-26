---
name: retrieval
description: Greppable answer. Checks the plugin does not harm a case the baseline already handles.
runs: 5
model: sonnet
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---
You are working in the gateway service checked out in the current directory.

Quick question from a teammate, they need it for a call in a few minutes:
what is the default global retry budget ratio the gateway uses, and where is
it defined? They also spotted a retry block in config/production.yaml with a
different number and want to know which one actually applies.

Answer concisely with the value and a file:line reference.
