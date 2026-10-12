# Apple App Privacy label working draft

Status: **not ready to enter in App Store Connect.** The source code and existing Privacy Policy establish likely data categories, but the SDK/processor, retention, transmission, linkage and tracking review is incomplete. Do not submit “no data collected,” “not linked,” or “no tracking” without the evidence below.

Apple's [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) require the developer to cover collection by both the app and third-party partners. Apple defines collection in terms of access beyond real-time servicing of a request.

| Apple category to evaluate | Source-backed examples | Purpose candidates from current product | Status / evidence still needed |
|---|---|---|---|
| Contact Info | Account name/email/phone, JOBSAGE alias, employer team contact | Account, job applications, messaging, support | Confirm every native/web field, AI and mail processor handling, optionality and linkage. |
| Identifiers | Account/session identifiers, cookies, consent/audit identifiers, push token data (backend supports encrypted push registrations) | Authentication, notification delivery, security/consent records | Determine exact app-collected IDs, native registration/delivery and SDK behavior. |
| User Content | CVs, profile, career/education facts, application drafts, messages, AI prompts/outputs and uploaded identity files | Core candidate/employer service and requested AI assistance | Inventory fields, collection paths, retention and processors; distinguish user content about others. |
| Sensitive Info / other regulated professional data | Passport/selfie verification material, safeguarding/DBS and immigration/sponsorship facts where supplied | Identity and professional application features | Qualified privacy review must decide Apple taxonomy, sensitivity, optionality and access safeguards. |
| Usage Data | Application tracking, Smart Apply use, search/profile interactions and AI feature use | Core product and service operation | Confirm stored events versus transient processing; no conclusion about tracking. |
| Diagnostics | Server/application and security logs, errors, audit activity | Reliability, support and security | Map SDK-generated crash/diagnostic collection and retention. |
| Financial Info | Readiness purchase/subscription offer exists; production checkout is currently disabled | No live transaction in current code | Recheck existing account/subscription data and all future store billing SDKs/receipt processing. |
| Location, Contacts, Health & Fitness, Browsing History, Advertising Data | No current explicit mobile permission request or native data feature was identified for these categories. Employer web pages and candidate-entered regions are distinct from OS geolocation. | No purpose confirmed | Do not answer “not collected” until generated manifests, SDKs, remote website flows and logs are audited. |

## Required validation before App Store Connect

1. Build the actual signed iOS archive and inventory its linked SDKs and privacy manifests. The repository currently has no generated native project or `PrivacyInfo.xcprivacy`.
2. Review Expo/React Native SDK manifests and each vendor's current privacy documentation; classify data collected by the in-app WebView as part of the JOBSAGE app, not as an unrelated browser.
3. Confirm whether any data is linked to identity, used for tracking, shared with processors, optional, or retained after a request.
4. Reconcile the final answers with `google-data-safety.md`, the Privacy Policy, processor terms and actual production configuration.
5. Have the owner and privacy counsel approve every App Store Connect answer. No answer has been submitted.
