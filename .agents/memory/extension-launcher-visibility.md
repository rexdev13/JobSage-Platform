---
name: Extension launcher visibility
description: Real-Chrome rule for distinguishing a missing React mount from an intentionally hidden minimal Smart Apply sidebar.
---

Do not mount the Smart Apply React UI, form scanner, or MutationObservers on first-party JOBSAGE and Replit preview pages. Keep only the lightweight trusted outbound-application event bridge and hidden installation marker there; mount the helper on the external application destination.

**Why:** The main web app already owns first-party UI. Injecting a second React root and continuous form observers there can compete with page rendering and API work; the outbound bridge is sufficient to preserve trusted destination activation.

**How to apply:** Before returning on first-party hosts, create the hidden marker used by web detection. Reject toolbar UI mounts there, skip page-warning observers, and always register the outbound handoff listener. Test the unpacked extension on both JOBSAGE and the external destination.