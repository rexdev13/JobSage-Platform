# Apple App Store submission worksheet

Status: **draft facts and blockers; not submitted.** No App Store Connect listing, signature, build upload or store action is authorized.

| Field | Current draft / source | Owner or release evidence needed |
|---|---|---|
| App name | JOBSAGE | Confirm available exact App Store display name. |
| Bundle identifier | Unset by design | Owner-approved identifier, EAS project and signing team; never accept a generated identifier. |
| Version/build | `1.0.0`, initial local build number `1`; production EAS profile auto-increments locally | Confirm store history before first upload; then preserve EAS version source. |
| Primary category | Not chosen | Owner/store operator selects based on final feature distribution; do not guess Medical vs Business/Productivity. |
| Subtitle, description, keywords, promotional text | Not final | Owner-approved product claims; substantiate medical, sponsorship, AI and employment claims. |
| Privacy Policy URL | Existing route `/privacy`; production canonical public URL not verified in this session | Confirm live HTTPS URL and operator/contact content. |
| Support/marketing URL | Support route exists in app; legal public contact is owner-deferred | Provide stable, public owner-controlled URLs and a monitored contact address. |
| Privacy labels | See [working draft](apple-privacy-labels.md) | Complete native SDK/processor/linkage/tracking audit and owner/counsel approval. |
| EULA | See [decision record](apple-eula-decision.md) | Owner/counsel chooses standard or custom; do not assume web Terms substitute. |
| Age rating | Product audience is owner-confirmed as 18+; server-enforced self-attestation | Complete Apple's actual content-rating questionnaire from shipped features. |
| Purchases | No production checkout or IAP; native web purchase UI is suppressed | Keep suppression or implement/validate StoreKit and approved entitlement management. |
| App Review access | Not provisioned | Create owner-approved least-privilege candidate/employer reviewer paths and instructions; no shared admin/super-admin credentials. |
| Screenshots/previews | Not captured | Capture final signed production UI on supported iPhone/iPad targets only after layouts and tablet scope are decided. |
| Privacy manifest, permission declarations, accessibility | No generated iOS project or app `PrivacyInfo.xcprivacy` in current source | Build, inspect SDK privacy manifests and resolved Info.plist, fix permission prompts, and run the physical accessibility matrix. |

See [`eas-build-setup.md`](../jobsage-mobile-eas-build-setup.md) for prepared profiles and the explicit blockers preventing builds.
