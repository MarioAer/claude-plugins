---
type: llm
---
PASS if the answer lists `reconcileShard`, `promoteToken`, `expireLease`, `unlinkDigest` and `emitShard`, and no other function, as writing to the cache without holding the lock. An extra remark that other functions read `cache.get` before taking the lock is correct and does not fail the answer. FAIL if one of the five is missing or another function is listed as writing without the lock.
