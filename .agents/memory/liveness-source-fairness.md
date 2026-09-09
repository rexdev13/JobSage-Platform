---
name: Liveness source fairness
description: Preventing one vacancy source backlog from starving other candidate-facing sources.
---

Deadline-limited liveness batches must reserve or rotate capacity across job-board, company-site, and other candidate-facing sources instead of relying on a strict global source ordering.

Successfully verified company-site vacancies remain candidate-visible for 48 hours, while job-board display freshness and click-time verification remain at six hours.

**Why:** When each run can verify only a small fraction of its selected batch, a large high-priority source backlog can permanently prevent lower-priority sources from being refreshed. Those lower-priority vacancies then disappear behind the six-hour freshness gate even though their own discovery scheduler is healthy.

**How to apply:** Compare stale backlog size with actual checks completed per run, then use per-source quotas or fair rotation. Verify freshness counts for every source, not just total liveness throughput. Keep the longer company-site display window source-specific so job-board trust and apply-time safety do not weaken.