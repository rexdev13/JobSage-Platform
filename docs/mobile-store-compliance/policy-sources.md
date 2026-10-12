# Official policy evidence

Initial check: 12 October 2026. Final store approval is not guaranteed. Counsel and the product owner must approve legal and business facts before release.

| Requirement | Platform | Official source | Applicability and required action | Evidence/status |
|---|---|---|---|---|
| Initiate complete account deletion in app | Apple | https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion | Applies because accounts can be created; accessible settings path, identity verification, associated-data deletion and timing are needed. | Official page fetched; implementation pending. |
| In-app and public web deletion resource | Google | https://support.google.com/googleplay/android-developer/answer/13327111?hl=en | Applies; public resource cannot be a generic support form or just deactivation. | Official page fetched; implementation pending. |
| Minimum functionality, privacy and UGC safety | Apple | https://developer.apple.com/app-store/review/guidelines/ | Audit native utility, processors, messaging reports/blocking and review access. | Guidelines fetched; detailed applicability audit pending. |
| Controlled WebView and SDK data disclosures | Google | https://support.google.com/googleplay/android-developer/answer/10787469?hl=en | Include actual controlled website data processing and SDK behaviour; open employer browsing is distinct. | Official page fetched; data inventory pending. |
| AI content safeguards/reporting | Google | https://support.google.com/googleplay/android-developer/answer/16353813?hl=en | Applies to substantial AI answers and guidance; reports must be possible in app. | Page fetched but returned insufficient policy body; further official policy verification required. |
| Privacy manifest/required-reason API declarations | Apple | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files | Audit native dependencies and generated iOS manifest. | Located through official search; full documentation and generated manifest not yet verified. |
| Target API, permission, billing, audience and ratings | Both | Apple guidelines above; Google Play Developer Program Policies | Actual installed SDK, payment routes and intended audience must be audited. | Pending; no compliant target or age claim is made. |

## Owner/legal facts that must be confirmed

- Legal operator and confirmed public privacy/support contact.
- Intended audience and minimum age.
- Initial iOS bundle identifier and Android package identifier, plus store ownership.
- Applicable governing law, retained-data reasons/durations and backup erasure timing.
- Privacy processor contracts, transfers and retention settings not evidenced by code.

No production writes, publication, store form submission or real-user deletion are authorised by this work.
