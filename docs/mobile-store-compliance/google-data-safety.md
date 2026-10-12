# Google Play Data Safety working draft

Status: **not ready for Play Console.** Google requires the developer to declare all app and SDK data collection/sharing, including data handled by the app's controlled website. The [Data safety form guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) was checked 12 October 2026.

This is an inventory to validate, not a completed declaration:

| Data-safety family to assess | Examples evidenced by product/code | Purpose candidates | Current status |
|---|---|---|---|
| Personal info | Names, email, phone, age self-attestation flag, account credentials | Account and service operation | Confirm precisely which fields are collected/shared, security controls and deletion behavior. |
| Photos and videos / Files and docs | CVs, cover letters, profile images, recommendation letters, passport/identity and selfie evidence | Candidate profiles, applications and identity checks | Inventory native picker/WebView, private storage, AI transfer, retention, and processor handling. |
| App activity | Applications, saved roles, search/preferences, Smart Apply and readiness usage, support and moderation reports | Deliver user-requested platform functions, safety and support | Check event logs, WebView interactions, caching and any analytics SDK; do not infer “no analytics.” |
| Messages | Candidate/employer messages, email alias replies, support content and selected report excerpts | Messaging, application tracking, support and moderation | Verify recipients, delivery providers, retention and cross-account visibility. |
| Health / sensitive employment details | Professional licensing and safeguarding, immigration/sponsorship, identity-verification material | Requested professional and application services | Counsel must assess Google's categories/sensitive data and eligibility/rating questions. |
| Device or other IDs | Secure session/capability identifiers, push token table and WebView/native signals | Sign-in, secure app bridge, push when implemented | Native push registration/delivery is not implemented or verified; examine actual generated APK and SDK behavior. |
| Calendar and contacts | Optional marketer-only Google Calendar connection; no phone contact import was found | JOBSAGE-managed interview scheduling | Separate workspace service and app collection; verify which role routes are exposed in mobile and actual OAuth/data transfer. |
| Financial info / purchase history | Account entitlements/offers; production checkout is disabled and no live payment provider is wired | Account access only in current production code | Reassess after a billing provider or store billing is integrated; verify financial ledger and receipt processing. |
| Diagnostics / crash logs | API and application operational/security logs | Reliability, safety and debugging | Inspect actual production log configuration, retention, SDK telemetry and access controls. |

## Current build/declaration caveats

- A native app build, SDK/manifest inventory and production network capture have not been performed.
- “Shared” must distinguish service-provider processing from user-directed disclosure to an employer, email recipient, calendar attendee or external ATS according to the current Play form definitions.
- Data is not declared optional or ephemeral solely because a feature is optional or a request is transient.
- The public privacy policy names Replit, OpenAI through Replit AI Integrations, Resend and Calendly as service providers. Processor contracts, region, retention and SDK behavior still require evidence.
- Account deletion and data-deletion web-resource disclosures must match the currently disabled destructive flow. Do not submit a claim of in-app deletion while the gate is closed.

Complete the Play Console questionnaire only after the code, release artifact, SDK disclosures, processor terms and public privacy policy have been reconciled and approved by the owner/privacy reviewer.
