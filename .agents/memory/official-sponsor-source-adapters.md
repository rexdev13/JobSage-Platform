---
name: Official sponsor source adapters
description: Official CQC and GIAS datasets are acquired through changing public download flows and need source-specific normalization.
---

The sponsor discovery CLI must treat official-source acquisition as source-specific: CQC CSVs can contain metadata rows before the real header, while GIAS currently requires an asynchronous generation poll followed by a protected extract form and can return HTTP 429. Cache downloaded files by date, normalize headers before matching, and emit a structured warning when an upstream source is unavailable rather than presenting the gap as a matching failure.

**Why:** The live official services do not share one stable CSV contract; assuming a first-row header or direct GIAS file URL produced silent all-unmatched results, cached HTML instead of data, or a rate-limit response.

**How to apply:** Keep source adapters bounded and reviewable, preserve source evidence URLs, and allow the remaining official sources to continue when one download times out or is unavailable.