---
name: Public ATS API robots policy
description: Safety boundary for fetching documented public employer ATS JSON feeds.
---

Documented public Ashby, Greenhouse, and Lever JSON endpoints should not be gated by the API host's HTML `robots.txt`; some API hosts return authorization errors for that file even while the public feed works.

**Why:** Applying the HTML crawler's robots check to a documented JSON API blocked a validated employer feed before the API request was attempted.

**How to apply:** Bypass only the robots lookup for exact supported public ATS API destinations. Keep HTTPS-only destination validation, public-address DNS pinning, SSRF controls, host leases, pacing, backoff, wall-clock deadlines, redirect validation, and compressed/decoded response limits.