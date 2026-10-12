/** Owner-approved policy. Targets are not claims that deployment/provider controls are verified. */
export const ACCOUNT_DELETION_POLICY = {
  version: "2026-10-12",
  activeSystemDays: 30,
  encryptedBackupDays: 90,
  securityLogMonths: 12,
  closedComplaintMonths: 24,
  financialYearsFromCompanyYearEnd: 6,
  deletedData: [
    "Identity, contact details, profile photos, credentials and recovery tokens",
    "Candidate/career profiles, employment, education, skills, qualifications and exams",
    "CVs, cover letters, passports, identity/right-to-work documents, certificates and attachments",
    "Preferences, searches, bookmarks, saved jobs, applications and tracker history",
    "Interview preparation, AI conversations, prompts and generated personal content",
    "Smart Apply answers, mappings, drafts and browsing/application context",
    "Solely owned calendar/interview records, device IDs, push tokens and analytics identifiers",
    "Personal support/feedback content and JOBSAGE-controlled files and processor copies",
  ],
  disclosures: [
    "Reauthenticate and confirm permanent deletion. Once confirmed, account access is disabled and sessions and authentication tokens are revoked. Marketing, notifications and automated applications are stopped.",
    "Deletion from active systems is due within 30 calendar days. Provider failures must be retried; accepting a request is not confirmation of completed deletion.",
    "Limited financial/tax records may be retained for six years from the relevant company financial-year end, or longer when legally required. Security/fraud/access logs may be retained for 12 months; closed complaints/disputes for 24 months. Documented legal holds last only until their obligation ends.",
    "Legally retained records are separated, access-restricted and cannot be used for advertising, recommendations or marketing. Minimal pseudonymous deletion evidence and genuinely anonymous statistics may remain.",
    "Deleted information may remain in encrypted backups for up to 90 days, beyond normal operational use. Deletion tombstones must be replayed before a restored backup returns to service.",
    "Employer-owned organisations, job listings, campaigns and shared records are preserved. Individual employer/staff identities are removed or displayed as Deleted User. Sole-owner organisations require ownership transfer or a separate organisation-deletion process.",
    "JOBSAGE deletes controlled copies but cannot recall material already independently downloaded, emailed or transferred to an employer, agency or external ATS.",
    "Deleting an account may not cancel an Apple App Store or Google Play subscription. If you subscribed there, manage or cancel it separately in your store account.",
  ],
} as const;

export function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Calendar arithmetic, clamped at month end (rather than overflowing February). */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

export type RetentionBasis = {
  kind: "financial"; companyFinancialYearEnd: Date; reason: string;
} | {
  kind: "security"; recordedAt: Date; reason: string;
} | {
  kind: "complaint"; closedAt: Date; reason: string;
} | {
  kind: "legal_hold"; obligationEndsAt: Date | null; reason: string;
};

export function retentionExpiry(basis: RetentionBasis): Date | null {
  if (!basis.reason.trim()) throw new Error("A documented lawful reason is required");
  let expiry: Date | null;
  switch (basis.kind) {
    case "financial": expiry = addCalendarMonths(basis.companyFinancialYearEnd, 72); break;
    case "security": expiry = addCalendarMonths(basis.recordedAt, 12); break;
    case "complaint": expiry = addCalendarMonths(basis.closedAt, 24); break;
    case "legal_hold": expiry = basis.obligationEndsAt && new Date(basis.obligationEndsAt); break;
  }
  if (expiry && !Number.isFinite(expiry.getTime())) throw new Error("A valid retention date is required");
  return expiry;
}
