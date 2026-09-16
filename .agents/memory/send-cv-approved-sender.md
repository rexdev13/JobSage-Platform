---
name: Send CV approved sender
description: Outbound Send CV mail must use a verified platform sender while candidate aliases remain reply-only.
---

Employer-facing Send CV messages must use the configured, Resend-verified JOBSAGE sender as `From`; the candidate's generated alias is `Reply-To` only.

**Why:** Alias domains may not be verified for outbound Resend delivery. Using an alias as `From` can make a real CV send fail even when the recipient and attachments are valid.

**How to apply:** Validate the Resend credential and sender at startup, reject production sends when configuration is unusable, and preserve the alias only as the employer's reply address.