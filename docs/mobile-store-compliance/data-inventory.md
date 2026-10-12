# Data ownership and erasure decisions

Status: **owner-approved retention policy recorded; ownership engineering review remains in progress. This is not a complete export manifest or completed erasure implementation.** See [approved deletion policy](approved-deletion-policy.md).

The immediate ZIP now covers explicit owned account/profile/application/message/draft/privacy allowlists, including the recipient's blocked-sender preferences, plus owned uploaded originals. Its manifest states exclusions and the 12 MiB bound. Broader provider/restricted-record access still requires privacy-team fulfilment; this does not close the schema-wide ownership/erasure review below.

The source inventory covers 66 table definitions and flags 134 columns for manual review. Only eleven definitions are connected through declared user foreign keys. The accompanying [machine-readable candidates](schema-ownership-candidates.json) contain schema metadata only, not user records.

Sender blocks are account-owned preferences. Their exact sender keys may contain an email address and are personal data, not anonymous identifiers. Shared company labels are not an ownership selector. Account export/erasure must include these preferences explicitly; deleting a sender account is not permission to delete another recipient's block list.

## Required implementation boundaries

- Resolve the requesting account from fresh authenticated server state, never from a submitted user ID or email.
- Use recent reauthentication and explicit final confirmation for destructive account removal. A newly exchanged native capability is not, by itself, proof that the person recently reauthenticated.
- Review each selector against isolated fixtures covering a candidate, employer, marketer, administrator and another unrelated account.
- Do not treat an authored, reviewed, assigned or converted-by relationship as exclusive ownership of the entire related record.
- Export only approved personal-data fields. Exclude passwords, session/proof material, verification/reset tokens, calendar OAuth credentials, internal staff notes and other people's unrelated records.
- Capture owned object/provider work before removing the database pointers. Track actual completion separately from accepting the request.
- A failed object/provider deletion must remain visibly retryable; deleting the account row or setting a foreign key to null is not complete erasure.
- Do not claim that copies already delivered to an employer's mailbox can be recalled or erased by JOBSAGE.

## Ownership review matrix

These are review groups, not executable delete predicates. Exact joins, field allowlists and multi-owner handling remain to be verified against the writers and readers.

| Data group | Source associations to inspect | Required decision or verification |
| --- | --- | --- |
| Account and authentication | `users`; `user_sessions.sess`, including ordinary snapshots and mobile grant records | Identify every session/grant ownership form and revoke it. Never export credential material. Calendar and payment-provider identifiers need separate provider handling. |
| Candidate facts and derived work | `profiles`, `career_profiles`, badges, scores/dismissals, readiness claims, remediation plans, role gap analyses, decision records, Smart Apply drafts, sponsor scores/gap analyses | Verify direct account selectors and JSON/array contents. Include derived personal data, not only the original profile. Review administrative notes independently from candidate-visible output. |
| Documents and identity evidence | `documents`, profile image pointers, `identity_verifications`, application CV/cover-letter pointers | Resolve private objects, ACLs, generated copies and sensitive passport/selfie evidence. Determine approved handling before removing pointers or declaring erasure complete. |
| Applications and outreach | `applications`, speculative applications and delivery attempts, bookmarks/favorites, alert deliveries | Verify actor ownership, delivery metadata and linked documents. Address pending outreach workers and retries so they cannot send after deletion starts. |
| Received/sent messages and references | `candidate_messages`, `recommendation_letters`, support/feedback threads and replies | Separate sender, recipient, reporter and staff-author identities. Prevent deletion/export from exposing or removing unrelated accounts' data. Scrub duplicated names/emails/text where required; `SET NULL` alone is insufficient. |
| Employer/company work | `employer_profiles`, `job_listings`, headhunt campaigns, employer feedback, employer-linked messages | Decide transfer, anonymisation or removal for shared/company records. Do not remove a public sponsor catalogue or another candidate's application through a broad employer join. |
| Marketing and scheduling | `social_leads`, `marketer_events`, account calendar connection fields | Distinguish the converted candidate from the assigned marketer and lead contact. Review external events, invitations, calendar tokens and provider deletion/revocation. A marketer's departure does not establish ownership of every lead. |
| Staff authorship, moderation and audit | `learning_videos`, rulesets, review cases, reviewed-by fields, reply author/display names, `audit_events` | Handle restrictive creator references and shared/public content without blanket deletion. Approve retention or anonymisation of audit/moderation evidence; do not export confidential staff notes. |
| Public vacancy/source catalogue | sponsor licences, source mappings, vacancy/source-state records, role contact metadata | Confirm whether a field is public/source data or a person's contact data. A name/email/type heuristic is neither ownership proof nor permission to erase an organisation's catalogue. |
| Consent and policy evidence | `consent_logs`, policy versions, pseudonymous IP metadata | Determine approved retention/erasure treatment. A hash is not automatically anonymous, and an existing terms version does not establish acceptance of a new privacy policy. |

## Non-database scope

### Implemented candidate selector partition

`artifacts/api-server/src/lib/accountDeletion/candidateData.ts` now defines 32 account-bound count selectors, including remediation/review children selected through their candidate-owned parent. These are count-only preflight selectors; neither that preflight nor the existing source relationship inventory claims complete account coverage.

Its separately gated transactional erasure helper covers 16 non-shared candidate-derived tables only. It deliberately does not remove the primary account, document/identity/profile file pointers, applications, recommendations, complaint/feedback threads, consent evidence, staff-authored cases, employer organisations or public catalogues. The helper returns `completeAccountErasure: false`; do not use it alone as the full active-data adapter. Complete legal-hold/retention manifests and additional owned/shared selectors are still required.

`objectCleanup.ts` supplies exact owned-generation preparation/erasure, while `localCredentials.ts` supplies immediate and retryable local credential revocation. Both destructive paths require the closed release gate to be opened in reviewed code; adapters additionally bind execution to an unexpired durable encrypted task, request account hash and account quarantine. These source/fixture checks are not evidence that all processor/device/storage-version cleanup has run.

| Store/processor | Remaining evidence needed |
| --- | --- |
| App Storage and native temporary files | Owned-object inventory, retryable object cleanup, killed-process cache cleanup, file-picker/share copies and explicit backup limits. |
| Native SecureStore, answer memory and WebView | Device sign-out/account-change behaviour, cookie/cache isolation, local draft/library controls and reinstall/cold-start evidence. |
| Chrome extension storage | Account-owned drafts, answer memory, application context, cached facts and confirmation of actual cleanup/control paths. |
| Email delivery and inbound processing | Provider-retained content/metadata, alias routing, pending workers, delivery records and recipient-copy limits. |
| Google Calendar and other scheduling services | Account-specific credential revocation and event/invite handling; do not revoke the shared workspace integration as a substitute. |
| AI processing | Actual transmitted facts/documents/prompts, provider/subprocessor retention and transfer terms, consent where required, and deletion capabilities. |
| Logs, analytics, payment services and backups | Approved limits: security 12 months, closed complaints 24 months, financial six years from actual company financial-year end, encrypted deleted-data backups at most 90 days. Actual exceptions, provider controls and restore replay still need verification. |

## Required approvals before release

The owner approved retention durations, lawful exceptions, shared-record safeguards and backup rules on 12 October 2026. Qualified review and evidence of actual processor/transfer terms, backup controls and final public disclosures remain required. Legal operator/contact, the relevant company financial-year end and store identifiers have not been supplied; do not invent them.

These approvals do not remove the engineering requirement to prove row selectors, field allowlists, retry behaviour and device cleanup. Conversely, a passing schema/type/unit check does not approve the legal policy.

## Data-flow and processor inventory

This is a source-level map of known flows, not a provider attestation. “Deletion status” describes current source wiring; it does not mean a provider or device was contacted. Provider retention, subprocessors, cross-border terms and backup replay must be confirmed from current contracts and operational evidence.

| Data flow | Source and data involved | Recipient / persistence | User control and deletion status | Unverified items |
| --- | --- | --- | --- | --- |
| Sign-in and native sessions | `artifacts/jobsage-mobile/lib/credentials.ts`; API auth/session routes. Bearer credentials are held in native SecureStore; legacy plaintext keys are migrated then removed. | JOBSAGE auth/session storage; device keychain. | Logout clears the device credential; the gated server adapter revokes local sessions and mobile grants. | Device-loss/reinstall, WebView cookie isolation, full account quarantine and remote cleanup of every signed-in device. |
| Candidate answer memory | `artifacts/jobsage-mobile/lib/smart-apply/answer-library.ts`. Candidate-authored safe free-text answers are scoped by account and stored in SecureStore. | Device keychain only; not a JOBSAGE database table. | User can remove individual answers; no server-side copy exists. | Account deletion cannot clear an offline second device until a verified device cleanup channel exists. |
| Candidate profile, applications and derived assessments | Authenticated API routes and the schema in `lib/db/src/schema`; export allowlists in `artifacts/api-server/src/lib/privacyExport/`. | JOBSAGE PostgreSQL; selected material is included in the immediate account ZIP. | Profile editing and export exist. Deletion has count-only selectors for the candidate account, but its transactional erasure helper covers derived rows only. | Complete owner/field manifest, employer and staff shared records, all account categories, retention exceptions and restore replay. |
| Uploaded CVs, identity evidence and generated files | `artifacts/api-server/src/routes/documents.ts`, storage routes and `lib/objectStorage.ts`; object ACLs identify owned objects. | JOBSAGE App Storage and database pointers; some files are exported as original bytes. | Individual document controls and bounded export exist. `accountDeletion/objectCleanup.ts` snapshots and deletes an exact owned generation only after a durable task is claimed. | Complete object inventory, generated/temp/share copies, deletion retries, native caches and provider backup expiry. |
| AI requests | `artifacts/api-server/src/routes/ai.ts` and feature-specific CV, cover-letter, Smart Apply and report routes use the JOBSAGE OpenAI integration. Payloads vary by feature and may include candidate-authored text and profile/application context. | Replit AI integration to OpenAI; selected results are persisted in JOBSAGE feature tables. | Candidate initiates AI use; stored drafts/results have account-scoped controls. | Exact field-by-field payload for every AI feature, provider/subprocessor retention and transfer terms, and provider deletion capability. No account-deletion provider adapter is wired. |
| Content reports and support | `artifacts/api-server/src/routes/support.ts`. Tagged AI/message reports store reporter contact and submitted evidence in `support_tickets`; content-report mail contains a neutral notice, not the evidence. The admin queue can filter reports, set severity, self-assign, escalate, add internal notes and inspect an audit-backed activity history. | JOBSAGE PostgreSQL and the support-mail provider; triage is limited to admin/super-admin roles. | Report submission is account-bound and capped at eight tagged reports per rolling 24 hours. Message sender blocking is a separate candidate-owned preference. Audit-write failures are logged; an activity entry appears only when its write succeeds. | Target/content identity is not yet a structured verified reference; no report-specific appeal workflow, user-visible decision notification, evidence-retention schedule or reviewer permission model. |
| Support email and inbound messages | `artifacts/api-server/src/lib/email.ts` and `routes/inboundEmail.ts`; support contact/reply text and recipient addresses are processed for delivery. | Resend and JOBSAGE ticket/message records. | Candidate inbox replies or support requests are available; content-report notifications redact evidence text. | Provider retention, inbound webhook retry/deletion behavior, queued mail cancellation and copies already delivered to recipients. |
| Marketing appointments | `artifacts/api-server/src/routes/marketerCalendar.ts`; per-marketer OAuth credentials and booking/event IDs are stored separately from the shared workspace Google Calendar connector. | Google Calendar and JOBSAGE marketer/event records. | Marketers can manage their own connection and supported booking events. | Account-erasure token revocation and event/invite cleanup are not wired into the deletion orchestrator; Google provider confirmation is absent. |
| Payments and store billing | `users` stores Stripe customer/payment identifiers; mobile store purchase is currently suppressed and billing guidance directs users to support. | JOBSAGE database and, where configured, the payment provider. | No native purchase flow is exposed by the companion at this stage. | Whether any live account has provider-side payment records, current provider retention, and supported processor deletion/financial-record retention handling. |
| Push and optional analytics | `privacy_preferences` stores notification/optional-analytics choices; `push_devices` stores device registrations. | JOBSAGE PostgreSQL. The current source audit found no optional-analytics collector; notification delivery exists only for selected categories. | Preferences are editable; the local credential adapter removes push registrations and resets stored choices. | Full push-provider/device cleanup, missing notification delivery categories, and whether new analytics collection is introduced later. |
| Logs, audit and backups | API request logs, `audit_events`, support decision events, PostgreSQL and App Storage backups. | JOBSAGE operational systems and hosting/storage providers. | Approved policy limits encrypted deleted-data backups to 90 days and distinguishes security, complaint and financial retention. | Actual per-provider retention settings, access controls, key destruction, restore-drill evidence and automatic tombstone replay remain unverified. |
| Employer/ATS delivery | Apply and Send CV flows send candidate-selected application details or files to employer-controlled email/ATS destinations. | Employer systems, email inboxes and external ATS providers; independent copies can persist outside JOBSAGE. | The candidate controls whether to start the application/outreach action. | JOBSAGE cannot recall delivered copies; recipient retention and downstream forwarding are outside JOBSAGE's deletion control. |

## Moderation triage source status

The existing support-ticket system is now used as the initial content-report queue rather than being represented as a complete trust-and-safety system. Content reports are explicitly tagged, rate-limited under a per-account PostgreSQL advisory lock, and have severity, assignment and escalation fields. API updates remain restricted to the existing admin/super-admin support policy; another moderator's assignment cannot be taken over by an admin, and unassignment is limited to the assignee or a super-admin. Structured activity events record status/severity/assignment/escalation values without copying internal note text and are visible in ticket detail when recorded.

Still absent: verified references to the reported content/subject, attachment and profile/job report entry points, reporter appeals, report outcome notifications, a reviewer role decision, operational response-time policy and approved evidence retention. Do not infer any of those controls from the report flag or support-ticket UI.
