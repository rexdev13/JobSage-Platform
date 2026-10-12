# Official policy evidence

Initial check: 12 October 2026. Final store approval is not guaranteed. Counsel and the product owner must approve legal and business facts before release.

| Requirement | Platform | Official source | Applicability and required action | Evidence/status |
|---|---|---|---|---|
| Initiate complete account deletion in app | Apple | https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion | Applies because accounts can be created; accessible settings path, identity verification, associated-data deletion and timing are needed. | Official page fetched; feature remains closed pending full engineering and owner/legal release gate. |
| In-app and public web deletion resource | Google | https://support.google.com/googleplay/android-developer/answer/13327111?hl=en | Applies; public resource cannot be a generic support form or just deactivation. | Official page fetched; request flow remains disabled. |
| Digital feature/subscription billing | Apple | https://developer.apple.com/app-store/review/guidelines/ | Read Guideline 3.1 and any storefront-specific entitlement requirements before showing external purchase links or monetising native access. | Guidelines fetched; no native store billing; mobile web offers and payment-price FAQ are suppressed; owner/legal choice remains open. |
| Digital feature/subscription billing | Google | https://support.google.com/googleplay/android-developer/answer/10281818?hl=en | Google Play billing generally applies to digital content, subscriptions and app functionality, subject to the policy's exact exceptions. | Official policy fetched; no Play Billing implementation; native offers are suppressed. |
| Minimum functionality, privacy and UGC safety | Apple | https://developer.apple.com/app-store/review/guidelines/ | Audit native utility, processors, messaging reports/blocking, AI content, legal pages and review access. | Guidelines fetched; see placement and moderation/release blocker records. |
| Controlled WebView and SDK data disclosures | Google | https://support.google.com/googleplay/android-developer/answer/10787469?hl=en | Include actual controlled website data processing and SDK behaviour; open employer browsing is distinct. | Official guidance fetched; working Data Safety inventory exists; release artifact/SDK audit remains open. |
| AI content reporting/flagging | Google | https://support.google.com/googleplay/android-developer/answer/13985936?hl=en | AI apps generating content must let users report or flag offensive content in-app without leaving the app. | Official page fetched; contextual report controls exist on reviewed features; full surface/operations audit remains open. |
| User-generated content and moderation | Google | https://support.google.com/googleplay/android-developer/answer/9876937?hl=en | Determine user-generated-content scope and provide enforceable terms and appropriate report/block controls. | Official policy link recorded; complete surface audit and moderation operations remain open. |
| Privacy manifest/required-reason API declarations | Apple | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files | Audit native dependencies and generated iOS manifest. | Official docs referenced; no generated manifest or signed archive verified. |
| Privacy labels and SDK data collection | Apple | https://developer.apple.com/app-store/app-privacy-details/ | Declare app and third-party partner data collection accurately. | Official docs fetched; working category inventory exists; final app/SDK evidence and owner approval pending. |
| Target API, permissions, audience and ratings | Both | https://developer.apple.com/app-store/review/guidelines/ and https://support.google.com/googleplay/android-developer/ | Review actual merged manifest, functionality, user content, minimum age and content rating. | Audience self-attestation is verified in source; no store questionnaire or native manifest is complete. |
| Apple EULA | Apple | https://www.apple.com/legal/internet-services/itunes/dev/stdeula/ | Owner/counsel chooses a standard or reviewed custom agreement. | Decision worksheet exists; no choice recorded. |

## Owner/legal facts that must be confirmed

- Legal operator and confirmed public privacy/support contact.
- Initial iOS bundle identifier and Android package identifier, plus store ownership.
- Applicable governing law, retained-data reasons/durations and backup erasure timing.
- Privacy processor contracts, transfers and retention settings not evidenced by code.
- Operating entity/contact, financial-year end, EULA, categories, final listing, policy URLs, reviewer access, purchase strategy and EAS project/signing.

No production writes, publication, store form submission or real-user deletion are authorised by this work. Drafts are not store submissions or qualified legal opinions.
