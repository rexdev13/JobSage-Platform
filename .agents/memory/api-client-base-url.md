---
name: api-client-react base URL
description: setBaseUrl must be called at app boot in main.tsx with just the BASE_URL (no /api suffix)
---

## Rule
Call `setBaseUrl(import.meta.env.BASE_URL.replace(/\/$/, ""))` in `artifacts/jobsage-web/src/main.tsx` before `createRoot()`.

**Why:** `customFetch` only prepends `_baseUrl` to relative paths (those starting with `/`) when `setBaseUrl()` has been called. Without it, hooks fire against `/api/...` which may 404 depending on the routing environment.

**Critical detail — do NOT add `/api` to the base:** The generated hook URL functions (e.g. `getGetConsentStatusUrl()`) already return paths with `/api/` included (e.g. `/api/consent`). If you set `_baseUrl` to `${BASE_URL}/api`, the result is `/api/api/consent` — doubled prefix. The base must be just `BASE_URL` (e.g. `/jobsage`) so that `/api/consent` → `/jobsage/api/consent`.

**How to apply:** Any time main.tsx is recreated or a new web artifact is set up, ensure `setBaseUrl` is called once at boot using ONLY `import.meta.env.BASE_URL.replace(/\/$/, "")`.
