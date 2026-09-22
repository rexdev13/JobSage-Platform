---
name: Per-marketer Google Calendar authorization
description: JOBSAGE marketers use custom app accounts, so their Google Calendar identity must be authorized and stored per marketer.
---

The Replit Google Calendar connector is workspace/runtime-scoped and cannot safely select a different Google account for each JOBSAGE marketer. Use a standard Google OAuth flow per marketer, encrypt stored refresh tokens, and route availability, Meet event creation, updates, and cancellations through that marketer's token.

**Why:** A shared connector identity makes every marketer's bookings appear on one account and violates account ownership.

**How to apply:** Keep Google OAuth client credentials and the exact callback URI configured in the environment; never fall back to the shared connector for marketer bookings.