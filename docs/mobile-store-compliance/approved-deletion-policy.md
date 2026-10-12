# Approved JOBSAGE deletion and retention policy

Owner-approved 12 October 2026. This records requirements, not completed deployment or legal/store approval. No real customer deletion, production write, publication or submission is authorised by this document.

## Process

Require signed-in reauthentication and explicit permanent confirmation. Immediately disable access, stop marketing/notifications/automated applications, and revoke sessions, authentication/refresh/push tokens and applicable Sign in with Apple tokens. Complete active-system deletion within **30 calendar days**, send completion confirmation, and make the workflow idempotent, auditable and retryable.

## Personal data

Delete identity/contact/photo/credential information; candidate and career facts; employment, education, qualifications, skills and exams; all CVs, cover letters, passports, identity/right-to-work documents, certificates and attachments; verification submissions/raw documents unless legally required; preferences, searches, bookmarks and saved jobs; JOBSAGE-held draft/submitted applications, tracker/interview records; Smart Apply answers/mappings/drafts/browsing context; AI conversations/prompts/generated personal content; solely owned calendars/interviews; device/push/notification/non-essential analytics identifiers; personal support/feedback content except documented lawful exceptions.

Include databases, object/temp storage, search indexes and controlled processors. Dispatch provider deletion requests and track actual completion separately from dispatch. Do not keep raw CVs, identity documents, credentials/tokens or AI content as evidence of deletion.

## Shared employer/staff records

Preserve organisations and employer-owned jobs/campaigns/applications/shared records. Remove individual profiles, credentials, sessions and contact details; show “Deleted User” in shared history. Transfer shared ownership to another organisation administrator. A sole administrator requires transfer or a separate organisation-deletion process; individual deletion must never automatically delete the organisation.

Delete/anonymise candidate personal information inside JOBSAGE unless a documented legal exception applies. Preserve employer jobs and genuinely non-personal aggregates. Explain that independently received/downloaded/emailed employer/agency/ATS copies cannot be recalled; delete controlled copies and notify relevant processors.

## Restricted legal exceptions

| Category | Approved rule |
| --- | --- |
| Financial/payment/invoice/subscription/tax | Six years from the **actual relevant company financial-year end**, or longer if legally required |
| Security/fraud/access logs | 12 months, unless an active investigation requires retention |
| Support complaints/disputes | 24 months **after closure**, unless an active legal claim requires retention |
| Legal/regulatory/court hold | Until the documented obligation/hold ends |
| Deletion evidence | Request ID, hashed account identifier, request date, completion date, outcome only |
| Aggregates | Only when they cannot reasonably be linked back to a user |

Retained data is separated from normal application data, access-restricted, and prohibited from advertising, recommendations and marketing. Do not invent a financial-year end or complaint closure date.

## Backups and disclosures

Deleted information may remain in **encrypted backups for no longer than 90 days**, beyond normal operational use. Automatically replay independent deletion tombstones before restored data returns to service. Disclose both 30-day active deletion and 90-day backup expiry in the Privacy Policy and deletion screen.

Before confirmation disclose scope, limited lawful retention/reasons, both time periods, shared-record consequences, independent-recipient limitations and applicable store subscriptions. Account deletion may not cancel Apple/Google subscriptions; provide separate management instructions.

## Implementation status

Implemented: shared policy/disclosure and calendar retention calculations; fixture-tested deletion state machine; encrypted temporary cleanup tasks; transactional Postgres queue/quarantine/session-revocation implementation; exclusive leases and stale-worker fencing; restricted encrypted summary archive and expiry operation; provider dispatch/confirmation distinction; minimal tombstones and fail-closed restore replay protocol.

**Not complete or enabled:** signed-in reauthentication/confirmation submission and receipt; schema-wide active erasure and shared-ownership transfer/anonymisation integration; quarantine checks in every dispatcher; storage/provider/device adapters; independent persistent registry and automatic restore wiring; actual encrypted-backup expiry proof; production configuration and end-to-end role/device evidence.

The account screen deliberately collects no password and accepts no deletion request while these dependencies remain unverified. No worker, deletion endpoint or retention-expiry scheduler is active. Only the four new empty tables/indexes were created in development; no existing customer rows were modified by that schema addition, and production schema was not changed. Tests use isolated fixtures; they do not establish actual production erasure.
