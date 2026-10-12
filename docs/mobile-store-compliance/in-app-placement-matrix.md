# Privacy, legal, reporting and purchase placement matrix

Status: **source-grounded placement inventory; visual/accessibility and role/device acceptance remain open.** This tracks the canonical web app hosted in the native WebView; it does not claim every route has been tested on a phone.

| User action / audience | Current location and access | Evidence | Remaining check |
|---|---|---|---|
| Candidate registration and age, Terms and Privacy links | `/register`; age attestation and separate Terms/Privacy links are in the form. Server requires the age flag. | `RegisterPage.tsx`, `routes/auth.ts` | Test candidate registration at native phone sizes, keyboard and screen reader; establish policy-version acceptance/renewal semantics. |
| Employer registration and age, Terms and Privacy links | Employer registration form has the same age confirmation and legal links. | `employer/EmployerRegisterPage.tsx`, `routes/auth.ts` | Test employer route in native app and confirm employer consent/version behavior. |
| Sign in | `/login`; local email/password. No social sign-in button was found. | `LoginPage.tsx`, `routes/auth.ts` | Test sign-in, verification/reset/error states and role-specific redirects on iOS/Android. |
| Privacy policy | Public first-party route `/privacy`; also linked from registration. | `App.tsx`, `PrivacyPolicyPage.tsx` | Verify production URL, current effective date, owner contact and legal text. |
| Terms of Service | Public first-party route `/terms`; linked from registration. | `App.tsx`, `TermsOfServicePage.tsx` | Decide whether an Apple standard/custom EULA is additionally required; obtain legal review. |
| Privacy choices and account controls | Signed-in first-party `/privacy-settings`, linked from the account sidebar. Preferences, draft clearing, push-token revocation and a password-verified data-request receipt are present. | `App.tsx`, `AppSidebar.tsx`, `PrivacySettingsPage.tsx` | Verify every role and native accessibility; deletion is not enabled and a request receipt is not a completed data export. |
| Account deletion disclosure | Public `/account-deletion` route and account navigation; actual request is deliberately disabled. | `AccountDeletionPage.tsx`, `App.tsx` | Do not release until recent reauthentication, confirmation, durable active deletion, receipt and complete retry/provider/backup gates pass. |
| AI output/content report | Contextual controls exist on reviewed AI features; reports enter the restricted support/moderation queue. | `release-blockers.md` §§30–32, 88 | Audit all AI-output surfaces, ensure a visible in-app flag without navigating away, and test each one. |
| User/content report and block | Inbox offers report and sender block; user-generated employer/candidate/job surfaces still need a full report/block inventory and moderation operations. | `release-blockers.md` §§32–33, 45 | Complete surface-by-surface coverage, triage, response, escalation, appeal and abuse testing. |
| Paid Readiness offers | Web shows two offer cards; authenticated native WebView now omits their purchase controls. Production checkout remains fail-closed. | `ReadinessUpgradeOptions.tsx`, `GapAnalysisSheet.tsx`, checkout route and regression test | Check all app routes/roles and approved storefronts. Implement native billing or retain suppression; do not add website purchase links without policy approval. |
| OS permissions / native share and file flow | No explicit camera, location, contacts, calendar-event or push permission request is implemented in the mobile app. Unused location and image-picker native packages were removed. Document picker/share remain available through current native/browser flows. | Expo config, mobile dependency inventory | Native generated manifests, first-use disclosure, file chooser, camera intent and permission denial have not been validated on devices. |

## Required placement tests before release

1. Open each public legal link before and after sign-in in both candidate and employer account flows.
2. Verify keyboard focus, target sizes, text scaling and screen-reader labels for registration, privacy settings and deletion disclosure on physical iOS and Android devices.
3. Confirm users can report AI output and report/block relevant users/content without leaving the app.
4. Confirm no native paywall, price, web-purchase CTA or external purchase link appears in any route or role unless counsel/store policy approves the exact design and market.
5. Validate contextual disclosure appears before any eventual camera, location, calendar or notification request. None is authorized merely by the package being installed.
