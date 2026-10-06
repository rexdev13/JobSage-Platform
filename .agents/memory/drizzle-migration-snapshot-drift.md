---
name: Drizzle migration snapshot drift
description: Generation pitfalls when migration journal entries do not have complete snapshot history.
---

Treat newly generated Drizzle SQL as a proposal when the migration journal and snapshots are sparse or inconsistent. Compare the SQL with the requested schema change and keep unrelated DDL out of the migration; update the matching snapshot and journal entry consistently.

**Why:** Incomplete legacy snapshot history can make a focused schema change generate unrelated table alterations. A project config with an absolute output path can also resolve incorrectly from the package directory.

**How to apply:** Inspect the journal, snapshots, generated SQL, and output path before running migrations. If generation includes unrelated changes, narrow the migration to the intended additive DDL and verify the resulting database schema against the Drizzle definition.

The development database's `drizzle-kit push --strict --verbose` preview proposed unrelated foreign-key constraint drop/recreate statements during a simple additive column change, even though the API startup schema-drift check later reported the database matched Drizzle.

**Why:** A push preview can include constraint churn that is not reproduced by the app's schema-drift check; accepting the full push would have changed more schema than requested.

**How to apply:** Do not approve a push or use `--force` when its preview includes unrelated constraints. Apply only the reviewed additive DDL to development, verify it, and leave production schema changes to Replit Publish.