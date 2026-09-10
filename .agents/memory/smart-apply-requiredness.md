---
name: Smart Apply requiredness
description: Required-field semantics and trust boundaries for the Chrome extension.
---

Smart Apply must preserve unknown requiredness separately from confirmed optional or required states. DOM-derived requiredness is advisory and extension-side; it must not be sent to AI as evidence or used to block submission.

**Why:** Many ATS forms omit machine-readable required metadata or change it conditionally. Treating absent evidence as optional hides mandatory gaps, while heuristic blocking risks preventing valid applications.

**How to apply:** Show indicators only for confirmed required evidence, recompute on each form scan, report required gaps separately from generic missing profile data, and keep sensitive required answers candidate-controlled.