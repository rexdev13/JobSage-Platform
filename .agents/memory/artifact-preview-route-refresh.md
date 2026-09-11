---
name: Artifact preview route refresh
description: Recovery for a managed artifact whose healthy local service is not forwarded by the Replit preview router.
---

When an artifact service responds correctly on its configured local port but the proxied preview returns Replit’s plain `Running` response, revalidate and replace the existing artifact manifest with unchanged content, then restart the managed artifact workflow once.

**Why:** Restarting the workflow or re-presenting the artifact may leave the external application route stale even though the service is healthy. Manifest revalidation refreshes the managed route without adding legacy port forwarding.

**How to apply:** First compare the direct local response with the proxied development domain and confirm the artifact paths and ports are correct. Use the artifact manifest validation flow, restart the exact managed workflow, and verify both the proxied HTML response and a rendered screenshot.