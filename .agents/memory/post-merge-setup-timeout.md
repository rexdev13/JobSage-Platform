---
name: Post-merge setup timeout
description: The post-merge hook must allow time for dependency, schema, and frontend build steps.
---

Keep the post-merge timeout high enough for the complete non-interactive sequence: dependency reconciliation, schema verification, schema push, and the web bundle build. A 20-second limit can kill a healthy run after the database step succeeds but before the frontend build finishes.

**Why:** A merged task previously failed only because the hook deadline expired while the web bundle was building; the same setup completed successfully in about 20 seconds with a 120-second ceiling.

**How to apply:** When post-merge output shows the web build has started and the hook times out, preserve the existing fail-closed schema checks and raise the configured timeout to a bounded value such as 120 seconds before retrying.