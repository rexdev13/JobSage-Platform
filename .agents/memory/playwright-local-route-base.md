---
name: Local Playwright route base
description: How to choose app URLs when browser tests connect directly to a Vite workflow.
---

When Playwright connects directly to a local Vite workflow, use the local server's route base rather than the artifact's Replit preview prefix. In this workspace, `/jobsage` is applied by the preview proxy; the local server is root-mounted, so `/jobsage/profile` renders the app's not-found route while `/profile` matches.

**Why:** The proxy's artifact path is separate from the path that Vite and Wouter receive on direct localhost requests.

**How to apply:** For local browser tests, use `BASE_URL` for the workflow port and verify `BASE_PATH` before adding the app route. Do not copy a preview path into test URLs without checking the local server response.
