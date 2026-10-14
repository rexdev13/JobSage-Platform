---
name: Sponsor vacancy role query performance
description: Preserve bounded latency for candidate feeds without serving stale vacancy visibility results.
---

The candidate sponsor-vacancy read scans thousands of rows, so precompute county/region term normalization, ordering, and boundary regexes at module load; never sort or compile these matchers per vacancy. Concurrent endpoints with identical category and query options may share an in-flight promise, but completed results must not be retained as a feed cache.

**Why:** `/api/roles` and `/api/roles/my-matches` can request the same broad feed simultaneously. Repeated per-vacancy regex construction and duplicate reads caused multi-second stalls, while a result TTL could keep newly expired or newly discovered vacancies out of sync with current visibility.

**How to apply:** Keep static location matchers precompiled, preserve their term ordering and foreign/UK boundary cases, and include every query option in the in-flight key. Remove promises after success or failure and keep current liveness/visibility checks in each request path.
