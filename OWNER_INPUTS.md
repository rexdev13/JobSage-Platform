# JOBSAGE owner and external inputs

This file contains decisions, facts, credentials, and evidence that cannot be safely inferred from repository source. Their absence does not block independent code and fixture work. Do not enter secrets or private credentials in this document.

**Last reconciled:** 12 October 2026.

## Legal, privacy, and business facts

- Confirm the legal operating entity and any registered/legal address that must appear in public disclosures or store forms.
- Provide approved privacy and support contact channels.
- Confirm the company's financial-year end so the approved financial-record retention period can be calculated from the correct date.
- Obtain qualified legal review and final approval of the Terms, Privacy Policy, EULA choice, retention language, jurisdiction, processor/transfer disclosures, and public deletion commitments.

## Product and billing decisions

- Choose whether mobile sales are excluded from the first release or use native Apple/Google billing; no external checkout link or unreviewed subscription prompt should be enabled in the native app.
- Confirm the final user-facing subscription terms, cancellation/refund treatment, and entitlements only if mobile billing is approved.
- Confirm final store-form answers, age/content ratings, privacy labels, Data Safety answers, and the feature claims/screenshots to publish.

## App ownership, identifiers, and release access

- Supply the Apple Developer team/account identity and Google Play account identity.
- Approve the final iOS bundle identifier and Android application ID; do not invent or silently replace them.
- Configure the EAS project/account and signing credentials through the secure platform secrets flow, not in chat or this file.
- Provide approved production website/API domains and production provider configuration, including any owner-controlled domain association required for Universal Links or Android App Links.
- Create a reviewer account through the approved account workflow and deliver access through a secure channel; do not place reviewer credentials in source or documentation.

## External evidence

- Provide physical iOS and Android devices or an owner-approved device lab for release acceptance, including supported OS versions and screenshots/logs for the agreed test matrix.
- Provide store-console access when store metadata, declarations, screenshots, account settings, or submission actions are authorized. This implementation does not publish or submit builds.
- Confirm production provider behavior and contractual retention/deletion controls with the applicable storage, email, AI, calendar, payment, analytics, identity, and backup providers. Repository code alone cannot prove provider-side retention or deletion.
- Complete a dated staging backup-restore and tombstone-replay drill using an isolated staging environment; no production/customer data is to be used for this test.

## Explicitly not requested here

- No passwords, API keys, signing keys, OAuth tokens, session credentials, or store login credentials belong in this file or a chat message.
- No production deletion, deployment, store submission, paid-service purchase, or use of real customer data is authorized by the source-engineering task.
