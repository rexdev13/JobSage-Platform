---
name: Marketing lead performance
description: Durable definitions for marketer ownership and performance counts.
---

Count a lead as registered for marketing performance only when it has a converted user attribution. Count contacted leads only when their current status is `contacted`. Status changes and registration must retain the assigned marketer.

**Why:** A manually selected registered status is weaker evidence than an actual linked user conversion, while contacted is an operational CRM state. Keeping ownership preserves marketer attribution through the lead lifecycle.

**How to apply:** Use these definitions consistently in super-admin marketing aggregates, exports, and future marketer reports. Treat null ownership as the Unassigned bucket.