---
name: Owner-approved account deletion and retention
description: Business rules supplied on 2026-10-12; the last sentence was truncated, so the remaining policy must be obtained.
---

The owner explicitly approved the following JOBSAGE rules on 2026-10-12. This approves implementation, not production writes, real-account deletion, deployment or store submission.

**Why:** Retention and shared-record ownership are owner/legal decisions, not technical defaults to invent.

**How to apply:** Implement against isolated fixtures, preserve unrelated accounts and organisations, and obtain the missing policy remainder before claiming a complete policy or completed erasure. The received text ends at: “Legally retained data must be separated from normal”.

## Confirmed deletion process

- Require signed-in reauthentication and explicit confirmation of permanent deletion.
- Immediately stop marketing emails, notifications and automated job applications.
- Immediately revoke active sessions, authentication tokens, refresh tokens, push-notification tokens and Sign in with Apple tokens where applicable.
- Disable account access after the request is confirmed.
- Complete deletion from active production systems within 30 calendar days.
- Send completion confirmation.
- Make the workflow idempotent, auditable and safe to retry.

## Confirmed personal-data scope

Delete user-owned identity/contact/profile/photo data; password hashes, recovery tokens and credentials; candidate/career facts, employment/education/qualifications/skills/exams; CVs, cover letters, passports, identity/right-to-work documents, certificates and every uploaded attachment; identity-verification submissions/raw documents unless legally retained; preferences, searches, bookmarks/saved jobs; drafts and submitted applications stored by JOBSAGE, tracker history and interview preparation; Smart Apply remembered answers, mappings, drafts and browsing/application context; AI conversations/prompts/generated personal content and recommendations; solely owned calendar/interview records; device identifiers, push tokens, notification preferences and non-essential analytics identifiers; personal support attachments/feedback except lawful dispute/security exceptions.

Include database, object storage, temporary storage, search indexes and JOBSAGE-controlled processors/third parties. Dispatch provider deletion requests in the workflow. Do not keep raw CVs, identity documents, passwords, authentication tokens or AI content as deletion evidence.

## Confirmed shared-record rules

- Individual employer/staff deletion must not automatically delete an employer organisation or organisation-owned records.
- Remove the individual's profile, credentials, sessions and contact information; anonymise their shared audit/history display name as “Deleted User”.
- Preserve employer-owned jobs, campaigns, applications and organisation records; transfer shared ownership to another organisation administrator.
- If the departing user is the only administrator, require ownership transfer or a separate organisation-deletion request before deleting the organisation.
- Candidate applications/personal information inside JOBSAGE must be deleted or anonymised unless a documented legal exception applies. Preserve employer job listings and non-personal aggregate statistics.
- Explain that independent employers/agencies/ATS copies already downloaded, emailed or transferred cannot be recalled by JOBSAGE. Delete controlled copies and notify relevant processors where required.

## Confirmed lawful exceptions

- Financial/payment/invoice/subscription/tax records: 6 years from the end of the relevant company financial year, or longer where legally required. Do not guess the company financial-year boundary.
- Security/fraud/access logs: 12 months unless associated with an active investigation.
- Support complaints/disputes: 24 months after closure unless an active legal claim requires retention.
- Legal/regulatory/court holds: only until the applicable obligation/hold ends.
- Minimal pseudonymous deletion evidence: request ID, hashed account identifier, request date, completion date and outcome; no deleted profile, CV or documents.
- Fully anonymised aggregates may remain only if they cannot reasonably be linked back to the user.

Retained-data separation/access requirements and any subsequent backup/provider rules were not received. Do not infer them or invent approval.
