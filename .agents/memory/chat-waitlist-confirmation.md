---
name: Chat waitlist confirmation
description: Rules for reliably triggering and explaining waitlist confirmation emails across form and AI chat lead capture.
---

Carry structured contact qualifiers separately from the bounded AI transcript, and merge newly extracted values into that carried state before deciding whether chat collection is complete.

**Why:** Older name and email turns can fall outside the transcript window before phone or sector collection finishes. Also, the same email can already exist as a form lead, so source-specific guards can make a completed chat end silently.

**How to apply:** Treat confirmation delivery as one email-wide state across form and chat. Send when required contact details are complete and no confirmation is recorded. If one was already accepted, do not duplicate it; tell the candidate to check their inbox and spam folder.