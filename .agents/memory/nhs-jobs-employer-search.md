---
name: NHS Jobs employer search
description: Live NHS Jobs endpoint behavior relevant to HTTP vacancy discovery.
---

The legacy `search_xml` route currently responds with HTML rather than a structured XML/RSS feed. The public NHS Jobs results form has a dedicated `employer` parameter; a broad `search` query returns many unrelated employers and is not suitable for sponsor-specific vacancy discovery.

**Why:** Live dry runs for an acute trust, a mental-health trust, and a community trust only returned closely attributable advert cards when the employer field was used. Employer-name matching remains necessary because NHS results can include similar organisations.

**How to apply:** Try structured discovery first for forward compatibility, but use `candidate/search/results?employer=...` as the HTML fallback. Keep strict employer-name, direct-advert URL, and title-quality checks when changing the client.