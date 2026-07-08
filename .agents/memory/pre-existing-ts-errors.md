---
name: Pre-existing TypeScript errors
description: Files with known pre-existing TS errors that must not be touched
---

These files have TypeScript errors that existed before the current work and must NOT be fixed (per project instructions):

**API server:**
- `src/routes/coverLetter.ts` — `createdAt` missing from documents table type, pdf-parse ESM default export issue
- `src/routes/employer.ts` — applications update type mismatch
- `src/routes/remediation.ts` — unreachable string comparison
- `src/routes/smartApply.ts` — string | string[] param type
- `src/routes/speculativeApplications.ts` — user.email nullable vs required email.ts param types

**Web app:**
- `src/pages/AdminAuditPage.tsx` — union type narrowing issue
- `src/pages/employer/EmployerJobFormPage.tsx` — missing queryKey
- `src/components/ui/button-group.tsx` — SlotProps incompatibility
- `src/components/ui/calendar.tsx` — Ref type mismatch
- `Document.documentType` field — generated `Document` type lacks `documentType`; any page reading `d.documentType` (e.g. `DocumentsPage.tsx`, `SponsorLicencesPage.tsx`) has this pre-existing error
- Generated `@workspace/api-client-react` types are stale/drifted vs. actual API responses in several unrelated pages — `SponsorVacancyApplyModal.tsx`, `ApplicationsPage.tsx`, `IdentityVerificationPage.tsx` (missing `IdentityVerification` export), `InterviewCalendarPage.tsx` (missing `interviewDate`/`interviewNotes`), `MyProgressReportPage.tsx` (missing `topCompanies`), `RecommendationLettersPage.tsx` (missing `RecommendationLetter` export)

**Why:** These were already present before this session's work began (confirmed via `git diff <pre-task-commit> -- <file>` showing no changes). Fixing them is out of scope and risks scope creep / unintended regressions.

**How to apply:** When running tsc --noEmit to validate new work, only flag errors in files you actually touched. Ignore errors in the files listed above. If new unfamiliar TS errors appear in files you didn't touch, verify with `git diff <pre-task-commit> -- <file>` (empty diff = pre-existing, safe to ignore) before assuming it's a regression.
