# JOBSAGE payments and in-app purchase review

Status: **engineering review complete for the current code; store/legal decision and native billing are not complete.** No production checkout, live charge, provider integration, store billing, or purchase test was performed.

## Current product and code evidence

| Offer | Web copy | Product delivered | Current production transaction |
|---|---|---|---|
| Check Booster Pack | One time, £4.99 | 20 additional Readiness Checks, consumed inside JOBSAGE | None. Production `/checkout/create-session` returns 503 before changing entitlement. |
| JobSage Pro | £15.99/month | Unlimited Readiness Checks and priority AI gap analysis inside JOBSAGE | None. Production `/checkout/create-session` returns 503 before changing entitlement. |

The API has a development-only sandbox branch that directly changes the test account entitlement, returns no checkout URL, and visibly labels completion as a sandbox. It cannot handle a live payment or confirm payment from a verified webhook: `/checkout/webhook` always returns 503, and no Stripe SDK/verified-payment flow is connected. The app must not describe these development mutations as purchases.

The existing JOBSAGE WebView opens the first-party website. The web upsell was therefore reachable in a mobile session even though production checkout was unavailable. The mobile view now omits the web purchase controls whenever the authenticated native bridge is present; the same offer remains visible on ordinary web. This is UI containment, not a substitute for a server-side billing entitlement check. Regression coverage is in `GapAnalysisSheet.test.tsx`.

## Store policy application

These offers unlock digital functionality consumed in the app. Apple App Review Guideline 3.1.1 and Google Play's Payments policy generally require their respective in-app billing systems for digital goods/features sold from an app, subject to the current policy's documented exceptions, entitlements and storefront/program rules. Do not treat a web checkout, a webview, regional program or external link as an automatic exception.

**Conservative first mobile release:** keep mobile purchase controls suppressed and production checkout fail-closed. Do not add links that direct mobile users to buy on the website. Continue honoring verified entitlements already on the account only after the store-policy/legal review confirms that cross-platform access and account rules are acceptable. No IAP is implemented.

## Decision required before monetisation

1. Decide whether native purchase is in the first release. If yes, implement StoreKit and Play Billing independently, with server-side receipt/token validation, entitlement reconciliation, restore/manage flows, cancellation/refund handling, price localization, family/region rules and failure tests. Never trust a client assertion or the current development sandbox.
2. If no, keep the native purchase entry points hidden; re-audit any offer, price, upgrade call-to-action, paywall or external purchase link in every role and storefront before each release.
3. Qualified legal/store review must decide whether any account-based access or external purchase program is applicable to the final markets. Do not select a regional exception on assumption.
4. Replace the development-only sandbox grant with isolated fixture/test infrastructure before enabling any live payment work; keep webhook verification fail-closed.

## Official sources checked 12 October 2026

- [Apple App Review Guidelines, section 3.1](https://developer.apple.com/app-store/review/guidelines/) — digital features and subscriptions; external purchase mechanisms are storefront/entitlement-specific.
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en) — Google Play billing requirements for in-app digital products and subscriptions.

These are source references, not legal advice or confirmation that a particular exception applies.
