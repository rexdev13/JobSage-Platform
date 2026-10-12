# Google Play submission worksheet

Status: **draft facts and blockers; not submitted.** No Play Console listing, signed artifact upload, staged rollout or store action is authorized.

| Field | Current draft / source | Owner or release evidence needed |
|---|---|---|
| App name | JOBSAGE | Confirm exact Play listing name. |
| Android application ID | Unset by design | Owner-approved `applicationId`, EAS project/account and signing configuration; do not accept a generated value. |
| Version/build | `1.0.0`, initial local version code `1`; production EAS profile outputs AAB and auto-increments locally | Check Play history before upload; preserve monotonically increasing version codes. |
| Category and description | Not final | Owner/store operator selects; use only evidence-backed product and AI claims. |
| Privacy Policy URL | Existing `/privacy` route; production canonical URL not verified | Confirm live HTTPS address, accessible without sign-in and owner/contact facts. |
| Account deletion URL | Existing public `/account-deletion` disclosure; requests are deliberately disabled | Do not list as a functioning account-deletion service until the request and complete deletion workflow are actually enabled and verified. |
| Data Safety | See [working draft](google-data-safety.md) | Complete release-artifact, SDK, processor and actual data-flow review; owner approves Play form. |
| Target audience and content rating | Product audience is owner-confirmed as 18+; server age check is self-attestation | Complete the real target audience and content-rating forms, including user-generated and AI-assisted features. |
| AI-generated content / UGC | AI and user-contributed profile/message/job content exist | Confirm in-app reporting/flagging for AI content, UGC terms, report/block coverage, moderator response operations and rating disclosures. |
| Billing | No live checkout or Google Play Billing is implemented; native web purchase UI is suppressed | Keep suppression or implement and server-verify Play Billing; review account access and every external link. |
| App access/reviewer instructions | Not provisioned | Supply stable, least-privilege candidate/employer reviewer access and any gated-area instructions; never use super-admin credentials. |
| Permission declarations | No generated Android manifest or signed APK/AAB has been inspected | Review merged manifest, SDK declarations and first-use disclosure on an installed device. |

See [`eas-build-setup.md`](../jobsage-mobile-eas-build-setup.md) for prepared profiles and the explicit blockers preventing builds.
