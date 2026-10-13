# User-content report handling

The compliance-facing implementation and its release limitations are tracked in
[`docs/mobile-store-compliance/ugc-and-messaging.md`](mobile-store-compliance/ugc-and-messaging.md).

## Current source coverage

- Authenticated users can report AI answers and received inbox messages. Employer staff can report the candidate profile shown with an application, a published job listing in their organization, and another staff member’s application feedback. A user can flag their own support request for privacy or safety review.
- API validation binds each report to its stored source. Candidate-profile, attachment, and feedback targets use the actual application ID; the server verifies employer ownership or active membership and enforces job assignment for assigned-job roles. Feedback reports are limited to employer owners, admins, and assigned hiring managers. Job reports must point to a published listing in the reporter’s organization.
- An attachment report is accepted only when the document is the candidate’s CV attached to the exact reported application and the reporter can access that application. The current employer applicant screen does not display or open CV files, so it does not show an attachment-report button.
- Reports are limited to eight per authenticated account per rolling 24 hours under a database advisory lock. Appeal requests create a separate linked report and preserve the original record.
- The moderator role has a separate, assignment-scoped queue. Queue rows omit reporter identity and report text; source evidence is fetched only after the moderator opens an assigned case. Evidence excludes contact details, document filenames/storage keys/file contents, and message sender email addresses. Report notification email contains no evidence text.
- Decisions, triage changes and escalation produce audit events. Moderators can record internal notes, choose no action with a note, or escalate to an administrator. Moderator access does not inherit administrator, billing, role-management, impersonation or export privileges.

## Remaining operational and release limits

- All AI-generated surfaces still need a route-by-route inventory and acceptance checks. The contextual controls do not prove coverage for every AI response.
- The moderation workflow does not remove or edit source content, restrict an account, or define a response-time target. Owner-approved operations and legal review are still needed before representing these controls as a complete abuse-response programme.
- Database migrations `0049_employer_staff_memberships.sql`, `0050_ugc_report_targets.sql` and `0051_ugc_report_context.sql` are source-only and have not been applied. The restarted development API workflow reported schema drift for the employer-membership tables and report context column, so those database-backed routes are not runtime-ready until an authorized migration. No production data, migration, deployment, or store submission was changed for this implementation.
- The development checks are fixture tests. They do not establish real notification delivery, production retention, moderator staffing, or physical-device accessibility.
