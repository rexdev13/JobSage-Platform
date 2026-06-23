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

**Web app:**
- `src/pages/AdminAuditPage.tsx` — union type narrowing issue
- `src/pages/employer/EmployerJobFormPage.tsx` — missing queryKey
- `src/components/ui/button-group.tsx` — SlotProps incompatibility
- `src/components/ui/calendar.tsx` — Ref type mismatch

**Why:** These were already present when F7–F10 work began. Fixing them is out of scope and risks scope creep / unintended regressions.

**How to apply:** When running tsc --noEmit to validate new work, only flag errors in files you actually touched. Ignore errors in the files listed above.
