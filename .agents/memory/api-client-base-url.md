---
name: api-client-react base URL
description: setBaseUrl must be called at app boot in main.tsx or all hooks fire against the wrong path
---

## Rule
Call `setBaseUrl(import.meta.env.BASE_URL.replace(/\/$/, "") + "/api")` in `artifacts/jobsage-web/src/main.tsx` before `createRoot()`.

**Why:** `customFetch` only prepends `_baseUrl` to relative paths when `setBaseUrl()` has been called. Without it, every generated hook fires against `/api/...` (root domain) instead of `/jobsage/api/...`, producing 404s on every authenticated page load.

**How to apply:** Any time main.tsx is recreated or a new web artifact is set up, ensure `setBaseUrl` is called once at boot using `import.meta.env.BASE_URL`.
