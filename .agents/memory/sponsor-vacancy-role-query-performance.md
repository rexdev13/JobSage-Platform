---
name: Sponsor vacancy role query performance
description: Preserve bounded latency for candidate feeds without serving stale vacancy visibility results.
---

The candidate sponsor-vacancy read scans thousands of rows, so location phrase patterns must be compiled once rather than rebuilt for every row. Concurrent endpoints with identical category and query options may share an in-flight promise, but completed results must not be retained as a feed cache.

**Why:** `/api/roles` and `/api/roles/my-matches` can request the same broad feed simultaneously. Repeated regex construction and duplicate reads caused multi-second stalls, while a result TTL could keep newly expired or newly discovered vacancies out of sync with current visibility.

**How to apply:** Keep phrase matching precompiled and regression-test foreign/UK boundaries. Include every query option in the in-flight key, remove promises after success or failure, and keep current liveness/visibility checks in each request path.
