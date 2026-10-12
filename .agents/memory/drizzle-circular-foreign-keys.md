---
name: Cyclic Drizzle foreign keys
description: Handling mutually referencing support-ticket and inbox-message tables without TypeScript initializer cycles.
---

For mutually referencing tables, a direct Drizzle `.references(() => otherTable.id)` can create TS7022/TS7024 inference cycles when each table's initializer points at the other. Keep the ID columns typed as scalar integer columns in the Drizzle schema, and define the real foreign keys and indexes in the SQL migration.

**Why:** Adding a reverse message reference to the existing ticket/message relationship made `tsc --build --force` infer both table declarations as `any`; migration-level constraints preserve database integrity without that compile-time cycle.

**How to apply:** Use this only for truly cyclic table references; keep the migration constraints explicit and rebuild the DB package after schema changes.
