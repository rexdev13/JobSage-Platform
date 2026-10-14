---
name: Local Playwright route base
description: How to choose app URLs when browser tests connect directly to a Vite workflow.
---

When Playwright connects directly to a local Vite workflow for visual-only checks, use the local server's route base rather than the artifact's Replit preview prefix. In this workspace the Vite server is root-mounted. However, the local Vite port does not serve `/api`; an authenticated browser journey must use the Replit **development preview proxy**, which routes both the web app and development API. Never use the published domain for a fixture test.

**Why:** The proxy's artifact path is separate from the path Vite and Wouter receive on localhost requests, and the direct Vite port returns 404 to login API calls. JOBSAGE's development preview is root-mounted despite the `jobsage-web` artifact slug; adding `/jobsage-web` can render the SPA sign-in fallback instead of the requested route, so a 200 response alone does not prove the path is correct.

**How to apply:** For static local checks, use `BASE_URL` for the workflow port and verify `BASE_PATH` before adding the app route. For authenticated JOBSAGE browser journeys, use `BASE_URL=https://$REPLIT_DEV_DOMAIN` and leave `JOBSAGE_WEB_BASE_PATH` unset; confirm `/api/auth/user` and role endpoints return JSON before running the test. Never use the published domain or copy the artifact slug into the browser path.
