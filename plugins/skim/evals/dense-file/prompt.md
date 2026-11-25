---
name: dense-file
description: The answer is a property five of fifty functions share.
runs: 5
model: sonnet
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---
You are working in the gateway service checked out in the current directory.

We are chasing a data-corruption report in the session store. Every operation
in src/session/store.ts is supposed to take the per-key lock before writing to
the cache, but we suspect some do not.

Which functions in that file mutate the cache without holding the lock? List
them.
