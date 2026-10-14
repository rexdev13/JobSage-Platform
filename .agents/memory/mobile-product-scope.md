---
name: Mobile product release facts
description: Confirmed audience, Google Play account type, production host, and remaining owner-dependent identity facts.
---

JOBSAGE's intended audience is 18+. Do not choose an alternative minimum age or collect a birth date just to implement an age attestation.

**Why:** The owner explicitly confirmed “18+” on 12 October 2026.

**How to apply:** Registration, consent, legal disclosures and store audience declarations must agree. A checkbox is self-attestation, not verified age.

The owner deferred the legal operating entity/public contacts and iOS/Android store identifiers, asked implementation to proceed, and asked to be reminded later.

**Why:** Those facts had not been approved, so inventing them would produce inaccurate legal/store declarations.

**How to apply:** Keep legal/public identity as an owner decision, and verify the proposed Android package is available in the organization's Play Console before first release. Do not silently invent legal identity or claim release readiness while these facts are unresolved.

The owner confirmed on 14 October 2026 that JOBSAGE has an organization Play developer account and that the production mobile API uses the same public host, `jobsage.co.uk`.

**Why:** These facts determine which Play testing gate applies and which canonical production origin the Android build should use.

**How to apply:** Do not ask the owner to reconfirm the account type or production hostname. The new-personal-account 12-testers/14-days gate does not apply to this organization account.

Completion means both uploaded specifications: the full canonical-site hybrid app with controlled native Smart Apply, and actual privacy, deletion, reporting/moderation and store-compliance features and evidence. A hybrid-workspace milestone is not completion of the request.

**Why:** The owner requested both specifications, not a reduced companion app or a store checklist without working features, and corrected premature stopping at an intermediate milestone.

**How to apply:** Continue until both specifications are complete or an actual blocker needs owner input; do not stop at an intermediate milestone. Preserve canonical roles/navigation and shared extension logic. Separate source, automated checks, native-device evidence and owner-dependent release blockers in status reports.
