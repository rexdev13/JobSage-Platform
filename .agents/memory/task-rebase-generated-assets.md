---
name: Multi-round task sync and generated assets
description: Resolve chained task-sync conflicts without recreating conflicts through generated asset metadata.
---

Task synchronization may reveal additional conflict rounds after one round reports clean. Keep the worktree stable between rounds. During conflicts, use complete generated-file versions rather than line-merging generated outputs; regenerate from a validated checkpoint after the final sync when the incoming copy is stale.

**Why:** Re-registering presented assets rewrites generated asset metadata and can reopen a conflict during task completion. Main may also contain an older generated deliverable than the task's validated output.

**How to apply:** Resolve every reported round before presenting or re-registering files. After the final sync, regenerate and validate stale outputs, then complete the task; if completion opens another round, resolve it without manually merging generated data.