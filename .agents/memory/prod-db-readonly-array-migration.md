---
name: Prod DB read-only; scalar→array migration blocker
description: Why the agent cannot apply the preferred_region text→text[] conversion to production, and the supported path.
---
- Agent access to the production database is READ-ONLY (executeSql environment:"production" allows SELECT only). Direct prod DDL is forbidden by platform policy.
- Replit's Publish schema diff generates `ALTER COLUMN ... SET DATA TYPE text[]` WITHOUT a `USING` clause, so scalar text → text[] conversions fail during republish when prod rows exist.
- **How to apply:** the user must run the guarded USING-cast DDL themselves (production database pane / SQL runner), then republish; the publish validator then sees the schema already aligned. The idempotent DDL lives in `lib/db/drizzle/0006_sync_live_db_drift.sql`.
- As of 2026-07-27 prod state: `preferred_region` scalar text (4 of 10 rows non-null, none empty), `languages` already `_text`.
