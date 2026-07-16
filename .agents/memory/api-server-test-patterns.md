---
name: api-server test patterns
description: Critical patterns for writing vitest route integration tests in artifacts/api-server
---

## Auth header format
`getSessionId()` reads `Authorization: Bearer <token>` FIRST, then falls back to `req.cookies["sid"]`. Use `.set("Authorization", "Bearer any-token")` in supertest — do NOT use `.set("Cookie", "session=...")`.

## db.execute must be mocked separately
Routes using raw SQL (e.g. `/professions` in `profiles.ts`) call `db.execute(sql`...`)`. The standard `makeChain()` mock covers `db.select/insert/update/delete` only. Add:
```ts
execute: vi.fn().mockResolvedValue({ rows: [] }),
```
to the db mock object when testing routes that use raw SQL.

## Zod schema fields (GetMyProfileResponse / UpsertMyProfileResponse)
These schemas require `createdAt: zod.date()` and `updatedAt: zod.date()`. Mock profile rows **must** include real `Date` objects for these fields or Zod parse will throw and the route returns 500.

## Employer route response shapes
- `GET /employer/jobs` → `{ jobs: [...], employerProfile }` (NOT a plain array). When employer profile not found → `{ jobs: [] }` early return.
- `GET /employer/jobs/:id/applicants` → `{ applicants: [...], job }`. Returns 404 if employer profile or job not found (checks ownership).
- `requireEmployer()` = `requireRole("employer", "admin")`.

## consentMiddleware
`requireConsent` does its own `db.select().from(consentLogsTable).where(...).orderBy(...).limit(1)` — this is one queue slot consumed before any route logic. Push `[consentRow]` first for authenticated tests that need to reach route logic.

**Why:** Bugs from mismatched cookie names and missing mock slots caused 10 test failures before these patterns were codified.

**How to apply:** For every new route test file in api-server, check whether the route uses consent middleware (most candidate routes do) and whether it uses `db.execute` (raw SQL routes).
