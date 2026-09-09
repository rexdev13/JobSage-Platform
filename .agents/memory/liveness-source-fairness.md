---
name: Liveness source fairness
description: Preventing one vacancy source backlog from starving other candidate-facing sources.
---

Deadline-limited liveness batches must reserve or rotate capacity across job-board, company-site, and other candidate-facing sources instead of relying on a strict global source ordering.

Successfully verified vacancies from every source remain candidate-visible for 48 hours, while click-time verification remains at six hours.

**Why:** Deadline-limited sweeps can verify only a small fraction of the backlog per run. A six-hour display gate hid otherwise live vacancies before fair rotation could revisit them, while a one-week window would expose candidates to materially stale adverts.

**How to apply:** Use 48 hours only for candidate display and related counts/scores across all sources. Keep liveness sweep cadence, discovery freshness, and the final click-time safety check at six hours. Continue fair per-source rotation.