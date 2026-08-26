---
name: Extension launcher visibility
description: Real-Chrome rule for distinguishing a missing React mount from an intentionally hidden minimal Smart Apply sidebar.
---

Use the minimal sidebar state only for unrecognised, non-application pages. A first-party JOBSAGE page must retain the normal launcher even when it has no detected form or application questions, and must mount before waiting for background-worker responses.

**Why:** A real unpacked Chrome run showed a valid content-script host and React render root with no visible child. The sidebar’s deliberate minimal/no-question return—not a bundle failure—had hidden the launcher on a first-party page. Worker/storage requests can also delay indefinitely, and an old site-level suppression must not prevent JOBSAGE from appearing.

**How to apply:** First-party startup should mount an open panel synchronously after the DOM is ready, then perform background-dependent work. Restrict suppression to external, untracked sites. When changing activation or visibility conditions, test the actual unpacked extension in Chrome and inspect both the injected host and its shadow DOM before diagnosing a blank UI as a build failure.