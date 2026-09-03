---
name: Drizzle raw SQL array parameters
description: How to bind a JavaScript array as one PostgreSQL parameter in a Drizzle raw SQL fragment.
---

Wrap a JavaScript array with `sql.param(array)` before casting it to a PostgreSQL array type inside a raw SQL fragment.

**Why:** Direct interpolation expands the array into a PostgreSQL row expression. Large lists then fail with the 1,664-entry row limit instead of being bound as one array parameter.

**How to apply:** For `ANY` or other PostgreSQL array operators, interpolate the result of `sql.param(values)` and cast that parameter to the required array type.