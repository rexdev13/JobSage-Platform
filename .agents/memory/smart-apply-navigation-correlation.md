---
name: Smart Apply navigation correlation
description: Safe automatic activation across asynchronous, multi-tab employer navigation.
---

Trusted Smart Apply activation must correlate a controlled first-party outbound event with the exact destination URL using short-lived session-backed collections per source tab. A public tracking parameter alone must never grant activation.

**Why:** Browser navigation events, content-script messages, service-worker restarts, `noopener` tabs, and rapid clicks can arrive in different orders. A single in-memory record can lose a valid application or accidentally expand trust.

**How to apply:** Keep each verified URL independently until it is matched and consumed, serialize updates for one source tab, and preserve the correlation in session storage. Trusted role metadata (canonical URL, title, employer, role ID) must travel on that same first-party record through redirects; never infer trust from scraped destination text. Do not add generic click listeners that treat an external URL as trusted solely because it contains `ref=jobsage`.