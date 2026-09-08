---
name: Postgres pool error containment
description: Placement rule for preventing managed Postgres connection rotation from terminating Node processes.
---

Attach the node-postgres Pool `error` listener immediately beside construction of the shared database pool. Do not rely on API or worker entry points to install it later.

**Why:** Managed database connection termination can emit an EventEmitter `error` from an idle pooled client. Without a listener on the exact pool instance, Node treats it as fatal; entry-point-only handling can miss other bundled or worker consumers.

**How to apply:** Keep one listener on the shared pool singleton, log the unexpected idle-client failure, and allow node-postgres to discard the failed client. Individual query/transaction failures must still reject and be handled by their calling feature.