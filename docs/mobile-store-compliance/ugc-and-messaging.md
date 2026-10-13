# UGC and messaging moderation

Status: **reporting, review and generic outcome notices are implemented in source; this is not operationally or store-ready evidence.** This document records implemented safeguards and what still requires engineering or owner/provider evidence. A report action in source is not proof that reviewers are staffed or that an abusive item will be removed.

## Implemented source behavior

| Surface | Report action | Server-side target binding |
|---|---|---|
| AI answer and received inbox message | Existing contextual report dialog | Signed-in reporter; messages must belong to the reporter’s inbox. AI excerpts are opt-in. |
| Candidate profile in an employer applicant card | “Report candidate profile” | Candidate profile must exist; supplied application ID must connect the candidate to an employer job visible to the reporter. Restricted employer roles need a matching job assignment. |
| Published employer job listing | “Report this job listing” | Listing must be published, the context ID must equal the listing ID, and the reporter must be an active member or owner of its organization; assigned-job roles need the matching assignment. |
| Employer application feedback | “Report this feedback” on another staff member’s entry | Feedback must match the exact application context, must not be the reporter’s own entry, and the reporter must be an owner, admin, or assigned hiring manager for that employer job. |
| User’s own support request | “Flag this request for privacy or safety review” after ticket submission | Ticket reference must belong to the authenticated reporter and must be a regular support request, not another report. |
| Application CV attachment | No control in the current employer applicant screen | API accepts a report only when the document is the candidate’s CV on the exact application and the employer reporter has current relationship/assignment access. The screen does not expose a CV preview or download, so no UI control is shown there. |

All content reports require a signed-in, non-impersonated account and a fresh actor ID. The server replaces submitted contact fields with the actor’s stored account contact. Reports are rate-limited to eight per reporter in a rolling 24-hour window using a transaction advisory lock. The API and client preserve the exact report context in the report record; appeals are separate linked reports and do not overwrite the original.

## Reviewer access and evidence

- The moderator queue contains only ticket reference, category, state, severity, assignment status and creation time. It does not return reporter name, email, ID, or report body.
- A moderator can open only a report assigned to that moderator. Claiming an unassigned report is atomic; impersonated moderation access is denied.
- Source evidence is loaded on the assigned-detail request. Profile evidence is limited to profession, specialty, registration status, qualification country, years of experience, sponsorship requirement and the related job title. Job evidence contains the listing’s title, location, regulator, status, description, requirements, specialty and sponsorship flag. Feedback is shown without the author’s identity. Attachment evidence contains only type, MIME type, size and upload time—not filename, storage key, parsed contents or file bytes. Support requests and inbox messages are matched back to the original reporter before their text is returned.
- AI and free-form “other” reports rely on the reporter’s description and any excerpt they explicitly chose to include. Report evidence is not copied into notification email.
- Moderator actions are auditable. The moderator role can record triage and internal notes, decide no action with a note, or escalate to an administrator. No-action and escalation decisions send a fixed, generic email containing only the report reference and status; source evidence and internal notes are excluded. If email delivery fails, the decision is not saved. Repeating an already recorded decision does not send another notice. The moderator role does not inherit admin support, billing, role-management, impersonation or export access.

## Release blockers and unverified behavior

- Inventory every AI-generated output surface and test its contextual control, keyboard/screen-reader access, account switching, retry/timeout behavior, and duplicate-report behavior.
- Define and approve operational response targets, moderation staffing, source-content removal or account-restriction procedures, retention periods, privacy escalation, appeals handling, and abuse/rate-limit review. Source currently implements reporting, triage, no-action, escalation and linked appeals; it does not itself remove source content or restrict accounts.
- Confirm assigned-reviewer evidence access, retention and outcome-notice delivery with approved operational procedures. Unit and fixture tests are not a live-provider or staffing drill.
- Migrations `0049_employer_staff_memberships.sql`, `0050_ugc_report_targets.sql` and `0051_ugc_report_context.sql` are not applied. After the API workflow restart, its startup check reported development schema drift for the employer-membership tables and `reported_context_id`; routes touching those database objects may fail until the migrations are authorized and applied. No migration was run against any live database.
- Signed-device accessibility, production migration, production operation, deployment and store-console acceptance remain unverified and unauthorized in this work.

## Source and acceptance pointers

- Report creation and relationship checks: `artifacts/api-server/src/routes/support.ts`
- Assigned moderator detail and source evidence: `artifacts/api-server/src/routes/moderation.ts`
- Candidate/employer report controls: `artifacts/jobsage-web/src/components/ContentReportDialog.tsx`, `artifacts/jobsage-web/src/pages/employer/EmployerJobDetailPage.tsx`
- Support request report control: `artifacts/jobsage-web/src/pages/HelpSupportPage.tsx`
- Moderator evidence display: `artifacts/jobsage-web/src/pages/ModeratorReportsPage.tsx`
- Persistent target metadata: `lib/db/src/schema/supportTickets.ts`, migrations `0050` and `0051`, and `lib/api-spec/openapi.yaml`; moderator outcome replies use the existing support-ticket reply record and approved support-mail sender.
- Fixture acceptance is recorded in the API route tests and web component tests; it is not a production or device result.
