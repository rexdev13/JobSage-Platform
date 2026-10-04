---
name: In-app Smart Apply scope
description: User's desktop-extension and mobile no-service assisted Smart Apply scope.
---

Preserve the existing Chrome extension workflow for desktop users who have it installed. Mobile/touch/small-viewport users, and browsers without the extension, use an assisted workspace with an external employer tab. The user explicitly chose zero external cloud browser services or additional browser-service running costs over an embedded remote browser.

**Why:** The user's detailed clarification supersedes the original embedded-browser brief: desktop extension behavior should remain intact, while mobile must not encounter an extension-installation wall.

**How to apply:** Track the start durably before navigating to the external form, retain pending starts across sessions, and ask the candidate to confirm submission on return. Return/focus events are prompts, not proof of employer submission. Only candidate confirmation or trusted extension evidence may promote an existing start to applied. Do not add a cloud browser or unsafe same-origin HTML proxy.