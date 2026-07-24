---
name: Stale @workspace/db dist types
description: Phantom "property does not exist" TS errors on schema columns come from stale lib/db/dist d.ts files
---
`lib/db` has `composite: true` + `emitDeclarationOnly` into `dist/`. TypeScript project references resolve `@workspace/db` types from `dist/*.d.ts`, not `src`.

**Why:** Schema columns added in `src/schema/*.ts` (e.g. `applyUrl`) won't exist in stale `dist` declarations, causing TS2339 errors in consumers even though runtime works.

**How to apply:** When a consumer typecheck reports a schema column "does not exist" that clearly exists in `lib/db/src/schema`, run `cd lib/db && npx tsc --build --force` and re-check before assuming consumer code is at fault.
