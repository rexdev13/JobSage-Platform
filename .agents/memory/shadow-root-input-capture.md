---
name: Shadow-root input capture
description: Real-Chromium interaction between document capture listeners and controlled text fields in the extension's shadow-root panel.
---

Input events inside the extension's shadow-root panel cross the employer document. A document-capture listener that causes a React render can reset a controlled extension textarea to its previous value before its own input handler reads the newly typed text. Filter extension-origin events using the event's composed path before scheduling external-field status renders.

**Why:** Typing and pasted text disappeared instantly only when a detectable employer form was present. DOM-only tests did not reproduce the browser event ordering, but an unpacked Chromium install did.

**How to apply:** When adding document-level capture listeners for ATS fields, explicitly exclude events from the extension panel. Verify both manual typing and paste in a real Chromium install with a detectable employer form, and confirm employer-field status updates still work.