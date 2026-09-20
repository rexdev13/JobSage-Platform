---
name: Company-site response decoding
description: Why company-site HTTP bodies must be decoded before text persistence.
---

Decode every declared HTTP `Content-Encoding` in reverse order before parsing or storing company-site bodies, keep both compressed and decoded output bounded, and normalize NUL characters before PostgreSQL `text` parameters.

**Why:** Some employer servers return gzip even when a caller did not explicitly request compression. Node's core HTTP client does not decompress automatically; interpreting gzip bytes as UTF-8 introduced NULs and PostgreSQL rejected the parameter with SQLSTATE `22021`.

**How to apply:** Any company-site fetch path using Node `http`/`https` must pass response bytes through the shared bounded decoder. Retry only genuine connection-loss/admin-shutdown errors; invalid text and ordinary SQL failures are not transient retries.