---
name: Calendly connector runtime binding
description: The Calendly connection can report healthy while the API workflow receives a connector 404.
---

The Replit Calendly connector may return “No calendly connection found for this customer” from an application workflow even after the connection is accepted and OAuth reauthorization completes.

**Why:** A healthy account-level connection is not proof that the connector is attached to the running artifact runtime. Repeating reauthorization after one fresh-credential retry is not a reliable repair.

**How to apply:** Treat one reauthorization plus one application retry as the limit for a failed operation. If the 404 persists, use a secure PAT fallback or repair the connector attachment; do not loop reconnects.