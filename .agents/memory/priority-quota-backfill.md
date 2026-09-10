---
name: Priority quota backfill
description: Keeping bounded queue completion signals correct when batches reserve capacity for priority groups.
---

Reserved capacity for a priority group must be backfilled from the remaining eligible queue whenever that group cannot fill its quota.

**Why:** An unfilled reserved slot can make an N+1 lookahead return exactly N rows despite a large backlog, causing the worker to report `done` and stop scheduled draining prematurely.

**How to apply:** Preserve the intended priority share first, then fill every unused batch slot from eligible overflow before deriving `hasMore`, `remaining`, or `done`.