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
