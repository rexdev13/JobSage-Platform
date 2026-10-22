---
name: Smart Apply alias privacy
description: Privacy boundary between a candidate's login email and the JOBSAGE alias used on external application sites.
---

Treat the user-level JOBSAGE alias as canonical and synchronize its profile mirror. Smart Apply API payloads, structured-prefill evidence, external ATS email fields, and new external-application snapshots use that alias; they must not receive the personal login email.

**Why:** External application pages and extension-visible evidence cross a privacy boundary. Login/alert delivery, CV contents, Send CV addressing, and Contact HR behavior have separate semantics and must not be changed as a side effect.

**How to apply:** Replace a different email on application forms with the alias. Preserve a different address only on a confidently identified authenticated account/settings page and show a monitoring warning. Keep non-email fields fill-only-when-empty.

The extension must follow candidate email prompts across later application steps, not just the first page. Automatic alias filling must not continuously undo a candidate's subsequent edits; an explicit profile-fill action can restore the alias. Never treat referee or employer contact addresses as the candidate's address.

**Why:** The user expects the JOBSAGE address to fill automatically wherever the application asks for the candidate's email. A supplied NHS Scotland screenshot showed that detecting an email question alone did not mean autofill handled it.

**How to apply:** Keep email-only step handling independent of broader profile/AI mapping, preserve candidate-controlled consent and passwords, and ensure visibility detection and filling agree when a hidden step becomes visible.