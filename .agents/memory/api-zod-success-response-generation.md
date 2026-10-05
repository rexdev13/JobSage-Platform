---
name: api-zod success response generation
description: Orval's generated server-side Zod validators depend on which OpenAPI success status is used.
---

For this workspace's Orval setup, a `201` success response did not produce an operation-specific response validator in `@workspace/api-zod`, while changing that response to `200` did.

**Why:** Backend routes use generated Zod response schemas to validate their output, so a missing generated validator creates a contract mismatch even when the React client types exist.

**How to apply:** If a route needs a generated server-side response validator, check `lib/api-zod/src/generated/api.ts` after codegen. Prefer the established `200` convention or add an explicit local validator if `201` is required.
