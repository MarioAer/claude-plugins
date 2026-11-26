---
type: llm
weight: 3
---
PASS only if all three hold. (1) Retry budget: a no-op, because `BudgetEnforcer.consumed` is never incremented. (2) Session lock: not enforced, citing that some functions skip `withLock`, or that `cache.get` runs before the lock is taken, or both. (3) Circuit breaker: a no-op, because `allow()` resets `this.failures = 0` on every check. FAIL if any verdict is missing, wrong, or has no deciding code cited.
