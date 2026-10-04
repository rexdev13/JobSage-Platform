---
name: In-app Smart Apply scope
description: User's desktop-extension and mobile no-service assisted Smart Apply scope.
---

Preserve the existing Chrome extension workflow for desktop users who have it installed. Mobile/touch/small-viewport users and extensionless desktops use an assisted workspace with an external employer tab. On desktop, keep the return prompt silent after extension confirmation, but show it for an unconfirmed tracked application.

**Why:** The user's clarification supersedes the original embedded-browser brief and requires a safety net for extensionless desktops and cases where the extension misses an unusual confirmation page.

**How to apply:** Track the start durably before navigating to the external form and retain pending starts across sessions. On desktop return, refresh the exact outbound URL first: trusted extension confirmation suppresses the prompt; an unconfirmed start gets the same candidate-confirmation prompt. Return/focus events are not proof of submission. Only candidate confirmation or trusted extension evidence may promote an existing start to applied. Do not add a cloud browser or unsafe same-origin HTML proxy.