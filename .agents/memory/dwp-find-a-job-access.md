---
name: DWP Find a Job access
description: Current server-side reliability status of the official Find a Job public pages
---

The public Find a Job home, search, and advanced-search endpoints currently return GOV.UK service-error HTML or time out from this development server, even though search/detail pages appear in public web results. Do not integrate the source until a bounded server-side request returns stable search results and direct details.

**Why:** A parser built against search snippets or intermittent browser-indexed pages would create silent discovery gaps and violate the source reliability requirement.

**How to apply:** Re-test the official search endpoint from the API runtime before adding a client; keep the source blocked if the response is an error page, timeout, or non-vacancy HTML.