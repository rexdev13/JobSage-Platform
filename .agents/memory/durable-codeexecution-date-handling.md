---
name: Durable CodeExecution date handling
description: Limitations of the durable CodeExecution sandbox for date and time-zone work.
---

Use the application's Node/TypeScript runtime for date parsing and time-zone conversion rather than reproducing that logic in durable CodeExecution. The durable sandbox may not provide `Intl` or `TextDecoder`, and `Date.now()` is disabled.

**Why:** A development-data repair needed UK end-of-day timestamps. Duplicating the application's time-zone parser in the sandbox was error-prone and hit missing runtime APIs.

**How to apply:** For date-sensitive backfills, use a guarded TypeScript script or another workspace runtime that imports the application's parser; use `executeSql` for parameterized database reads and writes.