---
name: Smart Apply navigation correlation
description: Safe automatic activation across asynchronous, multi-tab employer navigation.
---

Trusted Smart Apply activation must correlate a controlled first-party outbound event with the exact destination URL using short-lived session-backed collections per source tab. A public tracking parameter alone must never grant or preserve activation.

**Why:** Browser navigation events, content-script messages, service-worker restarts, `noopener` tabs, and rapid clicks can arrive in different orders. Separate source- and destination-tab queues can miss each other's events, while concurrent writes to a shared activation map can erase a valid tab.

**How to apply:** Keep each verified URL independently until it is matched and consumed, serialize reconciliation across source and destination tabs and writes to shared activation state, and preserve correlation in session storage. Trusted role metadata (canonical URL, title, employer, role ID) must travel on that same first-party record through redirects; a later ref-tagged URL still needs the normal redirect qualification unless it exactly matches the verified destination. Never infer trust from scraped destination text or a generic `ref=jobsage` click.