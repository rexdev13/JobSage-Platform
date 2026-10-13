# Account deletion runbook

## Release state and safety boundary

Account deletion requests are disabled in every environment until every blocker in
`docs/account-deletion-release-readiness.md` has been verified and the owner approves release.
The API release constant and low-level write guards must remain closed during this work.
Do not accept or process requests against a shared development database, production database,
or real account. Development checks use synthetic fixtures and isolated test adapters only.

The deletion worker is not evidence that a real account can be erased. Never bypass a release
guard, invoke a cleanup adapter directly, or use a live account to test a deletion path.

## Safe request handling

When the release gate is closed, the product must say that account deletion is unavailable and
direct the person to privacy support. Do not create a pending receipt or suggest that a request
has been accepted.

Before an approved release, the request path must:

1. Require a signed-in, non-impersonated user and an explicit account match.
2. Verify recent user authentication and explicit permanent-deletion confirmation. A privacy
   access/export proof is not deletion authorization.
3. Check sole-owner and shared-record conditions before changing credentials or account state.
   A sole organisation owner must transfer ownership or use the separately approved
   organisation-deletion process.
4. Persist a pseudonymous request receipt and the bounded cleanup outbox atomically with account
   quarantine and local credential revocation.
5. Return only a request identifier, current status, and the 30-day completion deadline. Never
   return a cleanup resource, provider response, raw account identifier, password, token, or
   document pointer.
6. Stop new notifications, marketing, scheduled application work, and other dispatches for a
   quarantined account. Existing in-flight external operations cannot be recalled.

If identity, ownership, recent authentication, selector coverage, or the durable receipt cannot
be verified, fail closed and leave the account unchanged.

## Cleanup and retry procedure

Deletion work is represented by durable, account-bound tasks. Claims must be exclusive and have
a finite lease. A worker retry may reclaim an expired lease after a crash; only the current claim
may acknowledge completion. Provider calls must be idempotent because a process may stop after a
remote operation succeeds but before the local acknowledgement is stored.

For each failed task:

- Keep the task retryable and retain only a bounded safe failure code.
- Do not mark the request complete or send a completion notice.
- Retry with backoff after confirming that the adapter's idempotency key and account scope are
  unchanged.
- Escalate repeated failures or any request nearing its 30-calendar-day deadline.
- Do not skip a failed processor or convert a timeout into a successful deletion.

The completion notice is eligible only after every required cleanup task is complete and the
independent tombstone registry has acknowledged the pseudonymous receipt. Completion removes
temporary cleanup resources; retain only the approved minimal deletion evidence.

## Provider reconciliation

Reconcile every JOBSAGE-controlled provider against the request's task ledger using a
pseudonymous request identifier. Record a provider's acknowledgement status, retryable result,
and safe error code; do not copy names, email addresses, raw request bodies, document contents,
or credentials into operator notes.

If a provider does not support a verified deletion or revocation operation, keep the release gate
closed for that provider. Do not substitute a local database delete for remote deletion. Calendar,
email, analytics, push, object-storage, search, and AI-provider work must each have a tested,
account-scoped adapter or an explicitly reviewed exclusion before release.

## Legal holds and retained records

Before active-data cleanup, evaluate documented legal holds and the approved financial, security,
complaint, and legal-retention rules. Retained records must be encrypted, access-restricted, kept
out of ordinary product selectors, and deleted when their documented retention period expires.
An unresolved hold blocks the affected request for review; it is not silently treated as a
successful exclusion.

Do not store raw CVs, identity documents, passwords, authentication tokens, AI content, or
provider payloads as deletion evidence. The only permitted long-lived receipt is the minimal
pseudonymous record approved by the deletion policy.

## Backups and restore-time replay

Encrypted backups may retain deleted data for no more than 90 days and must not be used for normal
application activity. The deletion tombstone registry must be independent of the application's
database and backup lineage.

Before restoring a backup into service:

1. Keep user access, email, schedulers, and outbound workers paused.
2. Read the complete tombstone set from the independent registry. If the registry is unavailable,
   fail the restore closed.
3. Replay each tombstone against the restored data and wait for every scoped erasure to succeed.
4. Verify that the replay is idempotent and that no restored account can send mail, receive
   notifications, or start scheduled work before replay completes.
5. Record only pseudonymous counts, request references, and outcomes; then resume services after
   an independent review.

## Monitoring and escalation

Monitor pending, blocked, overdue, and completed requests; expired worker leases; outbox entries
awaiting registry acknowledgement; provider failures; tombstone replay failures; and backup-age
evidence. Alert before a request exceeds the 30-day completion target. A blocked request is not
complete.

For a partial failure or suspected disclosure:

1. Stop the affected worker or restore process without deleting its durable task state.
2. Preserve redacted logs and pseudonymous request/task identifiers.
3. Escalate to the designated privacy/security operator and follow the incident process.
4. Do not retry a non-idempotent provider operation until its remote outcome is reconciled.
5. Resume only after the failure is understood and the retry is account-scoped.

Never place raw identifiers, email addresses, secrets, authentication material, or document
contents in an incident ticket.

## Staging restore exercise

Before requesting release approval, run an isolated staging exercise with synthetic accounts and
fixtures. It must verify:

- A request is rejected when authentication, confirmation, ownership, or release checks fail.
- A valid synthetic request is idempotent, quarantines only its fixture account, and creates a
  durable minimal receipt.
- A simulated worker crash releases its lease for a safe retry; stale acknowledgements are
  rejected.
- Provider failure remains retryable and prevents premature completion.
- The completion notice waits for all cleanup and independent registry acknowledgement.
- A restored fixture backup is replayed from an independent tombstone registry before any
  account-scoped dispatch resumes.
- The backup-expiry evidence demonstrates the approved 90-day maximum.
- Other fixture accounts and organisation-owned shared records remain intact.

Do not run this exercise against production or a shared database. Preserve the test output as
release evidence without exporting fixture secrets or personal data.

## Current implementation evidence

The source currently keeps deletion disabled, and the low-level write guards reject deletion
operations while the release gate is closed. Isolated unit tests cover the deletion engine,
retry behaviour, ownership protections, pseudonymous tombstones, and cleanup adapters. These
tests do not prove that the authenticated HTTP request path, full table/object inventory,
production processors, backup expiry, or a staging restore exercise is complete. Keep those
items as release blockers until separately verified.
