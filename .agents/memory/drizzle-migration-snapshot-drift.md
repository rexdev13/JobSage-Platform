---
name: Drizzle migration snapshot drift
description: Generation pitfalls when migration journal entries do not have complete snapshot history.
---

Treat newly generated Drizzle SQL as a proposal when the migration journal and snapshots are sparse or inconsistent. Compare the SQL with the requested schema change and keep unrelated DDL out of the migration; update the matching snapshot and journal entry consistently.

**Why:** Incomplete legacy snapshot history can make a focused schema change generate unrelated table alterations. A project config with an absolute output path can also resolve incorrectly from the package directory.

**How to apply:** Inspect the journal, snapshots, generated SQL, and output path before running migrations. If generation includes unrelated changes, narrow the migration to the intended additive DDL and verify the resulting database schema against the Drizzle definition.