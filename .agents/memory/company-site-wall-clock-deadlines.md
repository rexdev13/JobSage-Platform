---
name: Company-site wall-clock deadlines
description: Why company-site cron requests require absolute DNS and network deadlines in addition to socket timeouts.
---

Company-site work invoked by a short-lived HTTP cron must use an absolute wall-clock deadline that covers DNS resolution, TCP/TLS connection setup, response reads, and cleanup. A socket inactivity timeout alone is not a complete request deadline.

**Why:** A small batch still exceeded both 30 seconds and five minutes because the existing socket timeout did not reliably cover DNS and connection establishment. Bounding DNS and the entire request lifecycle made the same five-employer batch finish in about 20 seconds.

**How to apply:** Any external-site worker that must answer an HTTP scheduler should propagate one batch deadline into every per-employer request, reserve time for persistence and response serialization, and leave unfinished queue items eligible for the next locked invocation.