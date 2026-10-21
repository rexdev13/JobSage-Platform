---
name: Testing replaceable DOM functions
description: Avoid misleading Vitest/JSDOM spies when application code replaces a browser function.
---

When testing code that replaces `window.open`, use a directly assigned writable mock and restore the original afterward rather than spying on the property.

**Why:** A Vitest/JSDOM spy accessor hid the application's replacement and reported calls to the old opener, producing a false regression failure. Direct assignment exercised the actual replacement and cleanup successfully.

**How to apply:** Use this for browser-to-native adapters or other code that intentionally installs and later restores a DOM function. Normal tests that merely observe calls without replacing the function can still use spies.
