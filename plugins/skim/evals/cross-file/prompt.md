---
name: cross-file
description: One question across three large files.
runs: 5
model: sonnet
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---
You are working in the gateway service checked out in the current directory.

Post-incident review. Three subsystems each claim to enforce a limit: the
retry budget in src/gateway/retry_policy.ts, the per-key lock in
src/session/store.ts, and the circuit breaker in
src/gateway/circuit_breaker.ts.

For each of the three, tell me whether it actually enforces its limit or is
effectively a no-op, and cite the specific code that decides it.
