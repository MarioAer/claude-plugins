---
type: regex
target: trace
match: not_contains
pattern: '^(?=[\s\S]*clock\.now\(\) - 321)(?=[\s\S]*Introduced in release 5\.7;)(?=[\s\S]*tombstonedAt: stamp)'
---
