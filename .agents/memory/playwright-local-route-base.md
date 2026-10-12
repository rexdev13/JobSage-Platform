---
name: Local Playwright route base
description: How to choose app URLs when browser tests connect directly to a Vite workflow.
---

When Playwright connects directly to a local Vite workflow for visual-only checks, use the local server's route base rather than the artifact's Replit preview prefix. In this workspace the Vite server is root-mounted. However, the local Vite port does not serve `/api`; an authenticated browser journey must use the Replit **development preview proxy**, which routes both the web app and development API. Never use the published domain for a fixture test.

**Why:** The proxy's artifact path is separate from the path Vite and Wouter receive on localhost requests, and the direct Vite port returns 404 to login API calls.

**How to apply:** For static local checks, use `BASE_URL` for the workflow port and verify `BASE_PATH` before adding the app route. For login, preferences, or other API-backed flows, use the development preview host and verify its routing before a test; do not copy the artifact prefix blindly into localhost URLs.
