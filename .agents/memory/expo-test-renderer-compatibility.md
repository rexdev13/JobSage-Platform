---
name: Expo test renderer compatibility
description: React reconciler version drift can break native tests despite permissive test-library peer ranges.
---

Keep the native test renderer's reconciler aligned with the app's installed React, and keep the Expo Jest preset on the app's SDK line. Broad renderer version ranges are unsafe here.

**Why:** A compatible-looking test-library peer range admitted a renderer whose reconciler required React 19.3 while JOBSAGE shipped React 19.1. Separately, a Jest-discovered manual native mock intended for pure utilities replaced real component exports in render tests.

**How to apply:** Inspect renderer transitive dependencies before changing test dependencies. Map pure-test stubs explicitly rather than using an automatically discovered react-native manual mock. Component tests must render native components with the SDK-aligned preset, not partial utility stubs.

The installed React Native Testing Library uses async render and event APIs. Await `fireEvent` as well as `render`, and use public test-ID/accessibility queries rather than removed `UNSAFE_getByType` helpers.

**Why:** Unawaited events create overlapping act scopes and cause later tests to report missing elements even when the component rendered correctly.

**How to apply:** Await each event before assertions or another render; check the installed testing-library types before copying examples from older versions.
