---
name: PostgreSQL DISTINCT ON ordering
description: Avoid PostgreSQL 42P10 errors by aligning DISTINCT ON keys with the leading ORDER BY expressions.
---

When using `SELECT DISTINCT ON (a, b)`, the leading `ORDER BY` expressions must be `a, b` in the same order. Add tie-breakers only after those expressions.

**Why:** Bounded discovery and repeat-import precondition queries failed with PostgreSQL 42P10 when `ORDER BY` omitted one of the `DISTINCT ON` keys.

**How to apply:** Compare the full `DISTINCT ON` key list with the leading `ORDER BY` list before running a query. Do not use `DISTINCT ON (a, b) ORDER BY a, id`.