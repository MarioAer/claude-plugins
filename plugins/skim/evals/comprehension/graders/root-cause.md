---
type: llm
---
PASS if the answer identifies `BudgetEnforcer` in `retry_policy.ts` (lines 696–703) and says `consumed` is never incremented, so `permit()` always allows the retry. FAIL if it does not name that mechanism, or names the `backoffStageN` or `recordAttemptOutcomeN` families as the cause.
