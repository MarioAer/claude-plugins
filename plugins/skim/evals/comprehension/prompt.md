---
name: comprehension
description: No distinctive string to match. The shape the baseline reads whole.
runs: 5
model: sonnet
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---
You are working in the gateway service checked out in the current directory.

Production incident: a customer reports that retries keep firing against an
upstream that should have exhausted its budget already. Nobody has looked at
src/gateway/retry_policy.ts in a while.

Review that file and tell me which parts of the retry path could plausibly
let retries continue past the budget. Give me your assessment of the code and
the specific places to look.
