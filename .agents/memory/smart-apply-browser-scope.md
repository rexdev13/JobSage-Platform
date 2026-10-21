---
name: In-app Smart Apply scope
description: User's desktop-extension and mobile no-service assisted Smart Apply scope.
---

Preserve the existing Chrome extension workflow for desktop users who have it installed. In the responsive website, mobile/touch/small-viewport users and extensionless desktops use an assisted workspace with an external employer tab. On desktop, keep the return prompt silent after extension confirmation, but show it for an unconfirmed tracked application.

The native iOS/Android app has a separate requested scope: a controlled in-app Smart Apply browser alongside a hybrid workspace using the authoritative website. Public HTTP employer links should be upgraded to HTTPS and kept in-app; Smart Apply must only handle secure pages. Email/phone links stay in JOBSAGE as copyable contact details, not app handoffs. When a form is detected, automatically fill only matching blank name and JOBSAGE-alias email fields; never overwrite values, infer sensitive answers, draft free text without candidate action, or submit automatically.

**Why:** The user's clarification supersedes the original embedded-browser brief and requires a safety net for extensionless desktops and cases where the extension misses an unusual confirmation page.

**Why (native scope):** On 12 October 2026 the user explicitly requested a native hybrid app with an in-app employer browser; on 14 October they clarified that every employer link should stay in JOBSAGE, including public HTTP links, and basic prefill should happen automatically without leaking profile data over HTTP.

**How to apply:** Track the start durably before navigating to the external form and retain pending starts across sessions. On desktop return, refresh the exact outbound URL first: trusted extension confirmation suppresses the prompt; an unconfirmed start gets the same candidate-confirmation prompt. Return/focus events are not proof of submission. Only candidate confirmation or trusted extension evidence may promote an existing start to applied. In native WebViews, ensure every navigation reaches a strict safety callback: URLs excluded by React Native WebView's origin whitelist may be delegated to the OS before that callback runs. Upgrade safe public HTTP links to HTTPS before loading; only process Smart Apply messages on HTTPS, and block private/local or unsupported destinations. Keep web pages, pop-ups, and contact-link copy actions inside JOBSAGE. Auto-fill only exact blank name/JOBSAGE-alias email fields; preserve candidate review for structured/free-text answers and never submit automatically. Log only scheme/host, action, and result counts—never full URLs, query strings, profile values, question text, or answers. Do not add a cloud browser or unsafe same-origin HTML proxy.

Android bridge initialization must recover when document-start injection arrives late or is missed; a first-party page rendering correctly does not prove the native adapter initialized.

**Why:** An early-only bootstrap can leave the website usable while native application handoff and its session setup never activate. Android also blocks some asynchronous browser pop-ups unless they are explicitly routed.

**How to apply:** Keep bootstrap idempotent and origin/main-frame restricted, support after-load initialization, and let the website react to late native readiness. Keep the private verifier native-only. Route new-window intent through the existing destination policy and hand off tracked applications only after their save commits.

Android's first-party workspace message policy must tolerate same-origin SPA route changes; an exact match against the OS-reported path is not reliable there. Keep exact-URL matching as the default for other callers and platforms.

**Why:** Device logs confirmed `navigation-url-mismatch` after successful application saves: Android retained an older document URL while the website had navigated within the same origin. Rejecting that message prevented the native employer browser from opening.

**How to apply:** Opt into same-origin navigation only for the Android first-party workspace. Still require the native-reported and claimed origins to equal the configured origin, plus the native channel, fresh timestamp, strict message schema, and account/reauthentication checks. Never extend this exception to employer-page Smart Apply messages. Retain reason-only rejection diagnostics without URLs, proofs, tokens, or profile content.

Android WebView POST sources ignore custom headers; omit the source header map on Android while preserving the iOS form content type.

**Why:** The Android implementation uses `postUrl` with form-encoded data and warns on every render when a source header map is supplied. The warning can obscure unrelated employer-page errors, despite successful session exchange.

**How to apply:** Keep the exchange body form-encoded and credentials native-controlled. Do not hide all WebView warnings or change the session protocol just to remove this warning.