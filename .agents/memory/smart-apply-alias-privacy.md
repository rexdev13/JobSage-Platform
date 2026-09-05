---
name: Smart Apply alias privacy
description: Privacy boundary between a candidate's login email and the JOBSAGE alias used on external application sites.
---

Treat the user-level JOBSAGE alias as canonical and synchronize its profile mirror. Smart Apply API payloads, structured-prefill evidence, external ATS email fields, and new external-application snapshots use that alias; they must not receive the personal login email.

**Why:** External application pages and extension-visible evidence cross a privacy boundary. Login/alert delivery, CV contents, Send CV addressing, and Contact HR behavior have separate semantics and must not be changed as a side effect.

**How to apply:** Replace a different email on application forms with the alias. Preserve a different address only on a confidently identified authenticated account/settings page and show a monitoring warning. Keep non-email fields fill-only-when-empty.