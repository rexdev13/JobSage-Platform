# Release blockers and owner reminders

Owner decisions updated 12 October 2026. This document is not store approval.

## Confirmed

- JOBSAGE is for adults aged 18 and over.
- Registration requires an explicit age self-attestation, checked by the server. No birth date is collected for this gate, and it is not represented as identity-verified age.
- Continue implementation without inventing the legal operator or store identities.

## Remind the owner before release

1. **Legal operating entity and public privacy/support contact:** owner will provide later. No assumed legal name or address may be used in final store/legal declarations.
2. **iOS bundle identifier and Android package identifier:** not created or approved. Do not select identifiers silently or change existing store identities. Needed before valid store prebuild, link association files, signing or submission.
3. **Qualified legal review:** confirm operator, jurisdiction, processor/transfer contracts, retention durations, backups, deletion exceptions and the final legal text.
4. **Store ownership and signing:** no credentials or signing keys in repository; no store form submission, deployment or production writes are authorised.
5. **Device evidence:** physical iOS and Android, supported OS versions, uploads, cookies, employer SSO/CAPTCHA, deep-link associations and push-provider configuration must be validated.

## Engineering not yet complete

The hybrid workspace alone is not the definition of done. Both uploaded specifications remain the acceptance boundary.

Implemented in source, but **not physical-device verified**:

- Canonical website workspace and native session/cookie exchanges, strict first-party and employer message filtering, owned outbound application context and candidate-confirmed tracking.
- Shared extension/native DOM runtime; question detection, streamed generation, reviewed insertion, structured suggestions, protected clearing, saved drafts restored unreviewed, and opt-in allowlisted answer memory.
- Explicit current-CV attachment with an ambiguous/unsupported field fallback, an attachment-response timeout, and native document download/share. Attachment does not prove employer-side upload completion.
- 18+ registration self-attestation enforced by the server.
- Smart Apply answer reporting on the web and native assistant, saved to the existing admin/super-admin support queue. Answer excerpts are opt-in and excluded from notification emails.
- Reporting controls for AI CV Maker review, uploaded-CV enhancement, job-match explanations, vacancy readiness analyses and interview guidance. Web/native report snapshots are bound to the initiating account; output sharing remains opt-in.
- Individual inbox-message reporting, sharing excerpts only on explicit opt-in, with fresh actor-bound contact details and excerpt-free notification mail.
- Persistent, recipient-owned sender blocking/unblocking and a blocked-sender management dialog. Exact employer accounts or sender email addresses are blocked, not fuzzy company/domain matches. Existing messages are hidden and unread counts exclude them; new employer contacts, identified employer stage/profile-view updates and inbound email replies check the block before storage/notification. Platform support remains accessible. In-flight deliveries may still arrive, and other accounts/addresses are not implicitly blocked.
- Serialized native credential operations across provider remounts, immediate local sign-out invalidation, captured-token revocation, and stale startup/foreground/redemption guards. Overlapping operations are tested with deferred storage/network responses; native-device lifecycle evidence remains outstanding.
- Bearer-only logout revokes its supplied session without clearing website cookies; ordinary cookie logout is unchanged.

Still unfinished:

- Complete session/cookie ordering and native-device account-change validation, plus killed-process temporary-file lifecycle audit.
- Complete schema/processor/SDK data-flow and deletion audit, account/data deletion, export and privacy settings, policy/version acceptance and final public legal pages.
- Remaining AI/UGC experience inventory, operational moderation, objectionable-content filtering, review/escalation procedures and coverage of other content surfaces. Inbox reporting/blocking alone is not complete store-policy compliance.
- Native push and all cold/warm deep-link scenarios; permission denial, file chooser/camera, SSO/CAPTCHA, cancellation and streaming evidence on both native platforms.
- All role-by-role mobile parity checks and final store declarations, review access, licence/permission manifests, screenshots and release evidence.

Automated checks confirm source types, backend policy/exchange behavior and DOM logic. The legacy companion render tests do **not** verify the new native workspace or assistant, and none of these checks represents a signed native build or store approval. No production writes, deployment, signing or store submission has been performed.

## Data audit evidence

[Source-only relationship inventory](schema-ownership-inventory.md) covers 62 `pgTable` definitions, including declared delete actions. Only eleven definitions are associated through the declared user-FK graph; raw IDs, JSON, arrays, shared records and external processors still need explicit ownership/retention decisions. This inventory is not proof of complete erasure.

The inventory now also flags 134 source columns for manual ownership, container, credential or document-pointer review. [Data ownership decisions](data-inventory.md) separates candidate, employer, marketer and staff associations and lists unresolved object/provider/device work. These are review candidates, not executable deletion predicates or a complete export allowlist.

AI reports use `support_tickets`: the authenticated actor is checked against the expected account and fresh contact details are read from the user table. Staff can review and respond through existing support tools. Reporter-selected excerpts stay in the staff-restricted ticket; notification email contains only a review notice and contact/reference metadata. A `SET NULL` user FK does not erase the report's name, email, message or replies; include these in the deletion/export work.
