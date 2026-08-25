---
name: Drizzle correlated subqueries
description: Prevent correlated raw SQL in Drizzle from binding to an inner table's identically named column.
---

When a Drizzle column is interpolated inside a raw `sql` subquery, check the generated SQL: it can render only the quoted column name rather than its outer-table qualifier. For a correlated ID, use an explicit, static qualified SQL fragment such as `"users"."id"`.

**Why:** Most joined or nested tables also have an `id` column. An unqualified reference can bind to the inner table's ID, return incorrect aggregates, or make the SQL fail rather than correlating to the outer user row.

**How to apply:** Inspect server logs or generated SQL whenever raw subqueries refer back to an outer table. Keep the qualifier static and developer-authored; never construct SQL identifiers from user input.