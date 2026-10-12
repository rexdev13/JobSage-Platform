# Release blockers and owner reminders

Owner decisions updated 12 October 2026. This document is not store approval.

## Confirmed

- JOBSAGE is for adults aged 18 and over.
- Registration requires an explicit age self-attestation, checked by the server. No birth date is collected for this gate, and it is not represented as identity-verified age.
- Continue implementation without inventing the legal operator or store identities.
- [Complete deletion/retention policy](approved-deletion-policy.md): 30-calendar-day active deletion, encrypted backups at most 90 days, limited restricted lawful retention, shared-organisation safeguards and no real customer deletion during implementation/testing.

## Remind the owner before release

1. **Legal operating entity and public privacy/support contact:** owner will provide later. No assumed legal name or address may be used in final store/legal declarations.
2. **iOS bundle identifier and Android package identifier:** not created or approved. Do not select identifiers silently or change existing store identities. Needed before valid store prebuild, link association files, signing or submission.
3. **Qualified legal review:** confirm operator, jurisdiction, processor/transfer contracts, implementation of the approved retention/backup/deletion rules and final legal text. Financial retention requires the actual company financial-year end.
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
- Deletion policy/disclosures available from the account sidebar and Privacy Policy, including 30/90-day periods, restricted exceptions, shared-record/recipient limits and Apple/Google subscription instructions. Request submission is deliberately disabled, not a completed deletion flow.
- Fixture-tested deletion protocol, transactional queue/quarantine/local-session revocation source, encrypted temporary resources, stale-worker fencing, restricted retention summaries, provider-confirmation checks and fail-closed tombstone replay interface. Cleanup payloads are strictly validated and bound to the initiating account before acceptance, then rechecked against the request's account hash before a persisted task can be claimed. The tombstone outbox publisher is wired but remains inactive behind the closed release gate. No destructive endpoint is active; concrete erasure/provider/restore adapters remain unfinished.
- Public `/account-deletion` disclosure and account `/privacy-settings` controls are connected in the canonical website (and therefore in the hybrid WebView). A signed-in user can persist optional preferences, clear only their own server-side Smart Apply drafts, revoke their push registrations, and submit a password-verified personal-data **request receipt**. A request receipt is not an exported file or completed access request. Weekly job-alert and employer-reply email senders now honour their relevant notification categories. The Privacy Policy and consent gate use the current policy version.
- Privacy-preference and encrypted push-token tables are present in the **development** database only. Native push registration, delivery, and device/store evidence remain unverified. No account-deletion request submission or erasure endpoint has been enabled.

Still unfinished:

- Complete session/cookie ordering and native-device account-change validation, plus killed-process temporary-file lifecycle audit.
- Complete the schema/processor/SDK data-flow and deletion audit, active-system account deletion, provider cleanup and actual backup tombstone replay. The bounded account archive is now implemented; broader processor/restricted-record access requests still need privacy-team fulfilment. Passwordless users still need a supported recent-reauthentication route. Marketing preferences have no registered-account campaign sender, optional analytics have no collector, and some notification categories lack delivery integrations. Verify consent/version acceptance and final public legal pages with the owner.
- Remaining AI/UGC experience inventory, operational moderation, objectionable-content filtering, review/escalation procedures and coverage of other content surfaces. Inbox reporting/blocking alone is not complete store-policy compliance.
- Native push and all cold/warm deep-link scenarios; permission denial, file chooser/camera, SSO/CAPTCHA, cancellation and streaming evidence on both native platforms.
- All role-by-role mobile parity checks and final store declarations, review access, licence/permission manifests, screenshots and release evidence.

Automated checks confirm source types, backend policy/exchange behavior and DOM logic. The legacy companion render tests do **not** verify the new native workspace or assistant, and none of these checks represents a signed native build or store approval. No production writes, deployment, signing or store submission has been performed.

## Data audit evidence

[Source-only relationship inventory](schema-ownership-inventory.md) covers 66 `pgTable` definitions, including declared delete actions. Only eleven definitions are associated through the declared user-FK graph; raw IDs, JSON, arrays, shared records and external processors still need verified ownership selectors and retention handling. This inventory is not proof of complete erasure.

## Private archive and restore safety

Authenticated immediate export now delivers a real ZIP directly after password verification and explicit confirmation. It contains the named account-record allowlists and uploaded originals, including document, profile-photo and identity-file sources when present. The archive manifest states exclusions and the 12 MiB limit; inaccessible or unverified files fail the export instead of disappearing silently. Database-side byte/row preflight bounds record transfer before Node loads each section; source reads share a consistent database snapshot and owned immutable storage generations. Credentials, storage keys and internal notes are excluded. No persistent server-side export, public link or email attachment is created.

A development-proxy browser check used two disposable accounts and one private uploaded fixture. It verified the real ZIP and original bytes, CRC, account isolation, credential exclusions, wrong-password rejection, cleared confirmation/password controls, desktop/mobile layout and explicit missing-file failure. All exact fixture rows and the uploaded object were removed. Native download/share and cleanup have source/unit coverage, not physical-device evidence.

After adding byte preflight and generation pinning, a direct development postflight created one disposable account, private document and blocked-sender preference. The real database/storage archive and independent CRC/original-byte checks passed; its exact fixture rows, private object and local ZIP were removed. This was not a production operation or customer-data erasure.

An independent private-bucket tombstone implementation and read-only startup restore barrier are now present. Publication is immutable/idempotent, and untrusted or unavailable registry evidence fails closed. When erasure is eventually released, the barrier runs before HTTP listening, mail, scheduled jobs or startup backfills; it does **not** perform replay. Its strict matching rule requires affected accounts to be replayed before restarting. The owner has now configured a separate App Storage bucket through the shared `ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID` variable and supplied the dedicated key through Secrets (presence only checked). Configuration also rejects any registry bucket included in normal public-file or account-upload paths. Actual restore orchestration, schema-wide erasure selectors, processor erasure, backup-expiry evidence and production configuration/release approval remain outstanding. No customer erasure was run and the deletion release gate remains false.

### Independent storage fixture verification

A development fixture check used only a unique `system/deletion-registry-fixtures/` namespace in the new bucket, not the real tombstone namespace. It verified authenticated private reads through the registry's storage reader, generation-stable identical retries, rejection of conflicting receipt retries, rejection of anonymous GCS reads and exact marked-object cleanup. The normal registry write method was also confirmed to refuse publication while the gate is closed. No database records or real deletion-key material were used, and no real deletion tombstones were published. A subsequent read-only configuration check confirmed that the bucket is separate and outside application file paths.

The repeatable check is explicitly opt-in:

```sh
NODE_ENV=development pnpm --filter @workspace/api-server exec tsx \
  src/scripts/verifyDeletionRegistryFixture.ts --run-fixture
```

It deletes only its own uniquely marked fixtures, using generation preconditions, and verifies that no fixture objects remain. It is not a customer erasure tool or restore/backup test. Eight focused privacy/deletion suites passed 114 tests after the configuration and account-binding safeguards; API typecheck and build also passed.

The inventory now also flags 134 source columns for manual ownership, container, credential or document-pointer review. [Data ownership decisions](data-inventory.md) separates candidate, employer, marketer and staff associations and lists unresolved object/provider/device work. These are review candidates, not executable deletion predicates or a complete export allowlist.

AI reports use `support_tickets`: the authenticated actor is checked against the expected account and fresh contact details are read from the user table. Staff can review and respond through existing support tools. Reporter-selected excerpts stay in the staff-restricted ticket; notification email contains only a review notice and contact/reference metadata. A `SET NULL` user FK does not erase the report's name, email, message or replies; include these in the deletion/export work.
