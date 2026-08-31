---
name: Opportunity score consistency
description: Rules for keeping Best Matches and Apply First percentages aligned.
---

All candidate-facing Opportunities feeds must derive displayed percentages and ordering from the same score basis. A role awaiting pipeline scoring uses the shared neutral pending score rather than an eligibility heuristic.

**Why:** Independent fallback calculations allowed an unscored vacancy to display 100% in Apply First while the AI-ranked strip topped out below it, making both rankings look unreliable.

**How to apply:** Keep pending-score, career-focus, and behavioural adjustments identical across the main roles and AI matches responses. When scoring finishes after the first page request, refresh the main role feed so both sections use the same persisted snapshot.