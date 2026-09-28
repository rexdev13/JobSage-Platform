---
name: Durable CodeExecution file budget
description: Shared callback-data budget for large workspace file transfers in the durable execution sandbox.
---

Treat the CodeExecution block's 3,000,000-byte callback budget as shared across file reads, callback results, and writes. A read/modify/write of a large snapshot can exceed the budget even when each individual file is smaller than 1 MB.

**Why:** a production-state snapshot round trip exceeded the combined budget after carrying database query output and rewriting the snapshot.

**How to apply:** use regular workspace tools for bulk file reads and local edits. Keep CodeExecution focused on integrations or small derived results, and avoid passing full snapshots through it when counts or targeted rows are enough.