---
name: Post-merge setup behavior
description: The post-merge hook needs a bounded deadline, and its workflow reconciliation may leave local child servers holding artifact ports.
---

Keep the post-merge timeout high enough for the complete non-interactive sequence: dependency reconciliation, schema verification, schema push, and the web bundle build. A 20-second limit can kill a healthy run after the database step succeeds but before the frontend build finishes. Treat a manual run as a full workflow operation, not a database-only command: reconciliation can leave an older child server bound to an artifact port, causing `EADDRINUSE` or Vite to move to another port on the next start.

**Why:** A merged task previously failed only because the hook deadline expired while the web bundle was building; the same setup completed successfully with a 120-second ceiling. A manual setup run also exposed duplicate local server processes that made a later API restart fail while a stale web server remained reachable.

**How to apply:** Preserve the existing fail-closed schema checks and use a bounded timeout such as 120 seconds. After manually running setup, verify each artifact's expected port and recent logs. If a restart reports a port conflict, stop only the affected workflows, inspect the listener and process tree, terminate only confirmed orphan processes for that artifact, then restart once. Do not repeatedly restart or change port configuration until stale processes have been ruled out.