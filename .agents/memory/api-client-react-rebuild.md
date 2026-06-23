---
name: api-client-react TypeScript project references rebuild
description: Must rebuild api-client-react declarations after any type changes in api.schemas.ts
---

`lib/api-client-react` uses TypeScript project references. The web app consumes compiled `.d.ts` declaration files from `lib/api-client-react/dist/`. If you add or modify types in `lib/api-client-react/src/generated/api.schemas.ts` (or any other source file), the web app will not see them until the declarations are rebuilt.

**Command:**
```bash
cd lib/api-client-react && npx tsc --build
```

**Why:** The monorepo uses project references (`tsconfig.json` with `references`), so the web app resolves types from `dist/*.d.ts`, not source files. Changes to `.ts` source are invisible to consumers until compiled.

**How to apply:** Run this rebuild step immediately after editing any file in `lib/api-client-react/src/`, before running tsc --noEmit on the web app or expecting new types to appear in the IDE.
