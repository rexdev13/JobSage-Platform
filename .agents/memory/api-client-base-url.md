---
name: api-client-react base URL
description: Do NOT call setBaseUrl — shared proxy handles routing. Port conflicts break routing.
---

## Rule
Do NOT call `setBaseUrl()` in the web app. Remove it if it exists.

**Why:** The pnpm-workspace shared proxy at `localhost:80` routes all traffic by path without rewriting:
- `/api/...` → API server (port 8080)
- `/...` → Vite web server (port 18286)

Generated hook URL functions already return root-relative paths like `/api/profiles/me`. These work as-is. Setting a base URL causes double-prefix bugs like `/api/api/consent`.

**Port conflict risk:** The web artifact's `localPort` is hard-coded as `18286` in `artifacts/jobsage-web/.replit-artifact/artifact.toml`. If stale processes hold this port, Vite moves to 18287/18288 and the shared proxy can no longer route web requests. Fix by freeing stale ports (`lsof -ti:18286 | xargs kill -9`) and restarting the workflow.

**How to verify routing:**
```
curl localhost:80/api/healthz        → 200 {"status":"ok"}
curl localhost:80/api/profiles/me    → 401 (correct, auth required)
curl localhost:80/                   → 200 (Vite SPA)
```

**How to apply:** Never add `setBaseUrl`, Vite proxy configs, or `VITE_API_URL` env vars for cross-artifact routing in this project.
