---
name: Postgres pool error containment
description: Placement rule for preventing managed Postgres connection rotation from terminating Node processes.
---

Attach the node-postgres Pool `error` listener immediately beside construction of the shared database pool, and keep a listener attached to each connected client for its full lifetime. Do not rely on API or worker entry points to install either listener later.

**Why:** Managed database connection termination can emit an EventEmitter `error` from an idle pooled client or directly from a checked-out client. Without listeners on the exact pool and client instances, Node treats either event as fatal; entry-point-only handling can miss other bundled or worker consumers.

**How to apply:** Keep one listener on the shared pool singleton and one persistent listener per connected client, log the unexpected connection failure, and allow node-postgres to discard the failed client. Individual query/transaction failures must still reject and be handled by their calling feature.