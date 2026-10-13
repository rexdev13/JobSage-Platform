# Account deletion release readiness

## Current state

Candidate account deletion remains disabled in every environment. The product must not imply that the API can erase a live account until the release blockers in `artifacts/api-server/src/lib/accountDeletion/releaseReadiness.ts` have evidence and an owner approves release. Do not run deletion tests or cleanup workers against production customer accounts.

The approved policy is a 30-day erasure target, a 90-day maximum for encrypted backup expiry, narrowly restricted legal retention, and safeguards for records shared with other people. The API's development tests use isolated fixtures; never substitute a real user ID or production database.

## Before enabling requests

1. Verify every user-owned table and object-storage path against a schema-wide inventory. Record how shared employer, message, application, and audit records are transferred, anonymized, or retained under a documented legal hold.
2. Verify all scheduled jobs, email senders, mobile clients, and the browser extension stop creating new work for a quarantined account.
3. Exercise reauthentication, cancellation, retry, completion, and idempotent replay with synthetic development accounts only.
4. Verify processor revocation and deletion receipts without exposing account identifiers in logs.
5. Verify tombstone replay after a database restore and prove that encrypted backups age out within the approved 90-day limit.
6. Provision the dedicated deletion pseudonym/encryption key through the approved secrets flow; do not reuse a session or unrelated encryption key.
7. Obtain owner approval, run the release suite in an isolated staging environment, and review the evidence before changing the release gate.

## Release and operations

- Keep `DELETION_REQUESTS_ENABLED` false until every release blocker is independently verified.
- Never toggle the gate to test against production. A deployment restart is not evidence that erasure works.
- For an incident, preserve the request receipt and redacted audit evidence; do not copy names, email addresses, raw request bodies, or secret values into tickets.
- A failed processor, backup-expiry check, or restore replay blocks release; it is not an instruction to silently skip that processor.
