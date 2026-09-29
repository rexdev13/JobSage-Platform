import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { hasStrictRolePageEvidence } from "./healthcareRoleEvidence";

/**
 * Shared liveness bookkeeping for AI-discovered sponsor licence vacancies.
 * Used by the background sweep (vacancyLivenessSweep.ts) and the click-time
 * checker (routes/applications.ts).
 */

// A URL verified live by the sweep within this window is not re-checked at
// click time.
export const RECENT_VERIFY_SKIP_MS = 6 * 60 * 60 * 1000;
export const VACANCY_VISIBLE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function vacancyVisibilityWindowMs(
  _sourceType: "job_board" | "company_site" | null | undefined,
): number {
  return VACANCY_VISIBLE_WINDOW_MS;
}

export type VacancyLinkStatus =
  | "none"
  | "live"
  | "dead"
  | "unverified"
  | "inconclusive"
  | "stale";

export type CandidateVacancyStatus =
  | "visible"
  | "stale"
  | "missing"
  | "dead"
  | "expired"
  | "unverified"
  | "pending_review";

/** Company-site manager vacancies require explicit occupational evidence. */
export function hasApprovedCompanyVacancyRoleEligibilityReview(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== "object") return false;
  const review = (evidence as Record<string, unknown>).roleEligibilityReview;
  if (!review || typeof review !== "object") return false;
  const value = review as Record<string, unknown>;
  const socCode = value.socCode;
  const evidenceUrl = value.evidenceUrl;
  if (value.status !== "approved" || typeof socCode !== "string" || !/^\d{4}$/.test(socCode)) return false;
  if (typeof evidenceUrl !== "string" || !evidenceUrl.trim()) return false;
  try {
    const parsed = new URL(evidenceUrl);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Candidate visibility is deliberately stricter than URL liveness.  A direct
 * feed advert must retain enough provenance to show that it came from the
 * verified ATS mapping, rather than merely being labelled as an ATS posting
 * by generic page discovery.
 */
export function hasVerifiedDirectFeedEvidence(evidence: unknown): boolean {
  if (!evidence || typeof evidence !== "object") return false;
  const value = evidence as Record<string, unknown>;
  if (value.kind !== "known_ats_posting") return false;
  if (typeof value.provider !== "string" || !value.provider.trim() || value.provider === "unknown") return false;
  if (typeof value.listingUrl !== "string" || !value.listingUrl.trim()) return false;
  try {
    const parsed = new URL(value.listingUrl);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** Explicit, time-bounded exception for reviewed rows created before feeds. */
export function hasTrustedLegacyCompanyEvidence(
  evidence: unknown,
  legacyUntil: Date | string | null | undefined,
  now = new Date(),
): boolean {
  if (!legacyUntil || now.getTime() > new Date(legacyUntil).getTime()) return false;
  if (!evidence || typeof evidence !== "object") return false;
  const value = evidence as Record<string, unknown>;
  const review = value.roleEligibilityReview;
  if (!review || typeof review !== "object") return false;
  const reviewValue = review as Record<string, unknown>;
  if (
    reviewValue.status !== "approved" ||
    value.trustedSource !== "manual_review" ||
    typeof reviewValue.evidenceUrl !== "string"
  ) return false;
  try {
    const parsed = new URL(reviewValue.evidenceUrl);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Schema.org/microdata remains opt-in.  It is intentionally not enabled by
 * default while the direct-feed rollout is being verified.
 */
export function schemaCompanyEvidenceEnabled(): boolean {
  return process.env["COMPANY_SITE_SCHEMA_IMPORT_ENABLED"] === "true";
}

function hasOptInStructuredCompanyEvidence(
  evidence: unknown,
  title: string | null | undefined,
): boolean {
  if (!schemaCompanyEvidenceEnabled() || !evidence || typeof evidence !== "object") return false;
  const value = evidence as Record<string, unknown>;
  if (value.kind !== "json_ld_job_posting" && value.kind !== "microdata_job_posting") return false;
  if (typeof value.listingUrl !== "string" || !value.listingUrl.trim()) return false;
  if (!title?.trim() || /^(?:careers?|jobs?|why work here|our benefits|benefits|skip(?:\s+to)?\s+(?:main\s+)?content)$/i.test(title.trim())) return false;
  try {
    const parsed = new URL(value.listingUrl);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function isStandaloneManagerTitle(title: string | null | undefined): boolean {
  return /\bmanagers?\b/i.test(title ?? "");
}

export function getCandidateVacancyStatus(input: {
  sourceType: "job_board" | "company_site" | null | undefined;
  liveness: string | null | undefined;
  lastVerifiedAt?: Date | string | null;
  lastDiscoveredAt?: Date | string | null;
  sourceMissingSince?: Date | string | null;
  sourceMissingObservations?: number | null;
  closesAt?: Date | string | null;
  expiresAt?: Date | string | null;
  closedReason?: string | null;
  companyVacancyEvidence?: unknown;
  title?: string | null;
  companyEvidenceLegacyUntil?: Date | string | null;
  now?: Date;
}): CandidateVacancyStatus {
  const now = input.now ?? new Date();
  if (/(closed|filled|no longer accepting|closing date has passed)/i.test(input.closedReason ?? "")) return "dead";
  if (input.liveness === "dead") return "dead";
  const pastClose = [input.closesAt, input.expiresAt]
    .filter(Boolean)
    .map((date) => new Date(date as Date | string))
    .some((date) => !Number.isNaN(date.getTime()) && now.getTime() > date.getTime());
  if (pastClose) return "expired";
  if (input.sourceMissingSince || (input.sourceMissingObservations ?? 0) > 0) return "missing";
  if (
    input.sourceType === "company_site" &&
    isStandaloneManagerTitle(input.title) &&
    !hasApprovedCompanyVacancyRoleEligibilityReview(input.companyVacancyEvidence)
  ) {
    return "pending_review";
  }
  // Legacy adapters that predate liveness fields are treated as compatible
  // records; persisted NULL values are still handled conservatively below.
  if (input.sourceType === undefined && input.liveness === undefined && input.lastVerifiedAt === undefined) return "visible";
  // Rows created before evidence tracking have a verified URL and remain visible
  // during the staged backfill; newly ingested rows always carry evidence.
  if (input.sourceType === "company_site") {
    const directFeed = hasVerifiedDirectFeedEvidence(input.companyVacancyEvidence);
    const structured = hasOptInStructuredCompanyEvidence(input.companyVacancyEvidence, input.title);
    const strictRolePage = hasStrictRolePageEvidence(
      input.companyVacancyEvidence,
      input.title,
    );
    const trustedLegacy = hasTrustedLegacyCompanyEvidence(
      input.companyVacancyEvidence,
      input.companyEvidenceLegacyUntil,
      now,
    );
    if (!directFeed && !structured && !strictRolePage && !trustedLegacy) return "unverified";
  }
  if (input.liveness !== "live") return "unverified";
  // Undefined denotes a legacy adapter/mocked row that predates the column;
  // an explicit NULL from the database remains stale and cannot be opened.
  if (input.lastVerifiedAt === undefined && input.sourceType === undefined) return "visible";
  const verified = input.lastVerifiedAt ? new Date(input.lastVerifiedAt).getTime() : Number.NaN;
  if (!Number.isFinite(verified) || now.getTime() - verified > vacancyVisibilityWindowMs(input.sourceType)) {
    return "stale";
  }
  return "visible";
}

export function getVacancyLinkStatus(
  url: string | null | undefined,
  liveness: string | null | undefined,
  lastVerifiedAt: Date | string | null | undefined,
  livenessReason?: string | null,
  freshnessWindowMs = RECENT_VERIFY_SKIP_MS,
): VacancyLinkStatus {
  if (!url?.trim()) return "none";
  if (liveness === "dead") return "dead";
  if (liveness === "live") {
    const checkedAt = lastVerifiedAt ? new Date(lastVerifiedAt).getTime() : Number.NaN;
    return Number.isFinite(checkedAt) && Date.now() - checkedAt <= freshnessWindowMs
      ? "live"
      : "stale";
  }
  if (livenessReason?.toLowerCase().includes("inconclusive")) return "inconclusive";
  return "unverified";
}

/** True if any stored sponsor vacancy with this exact URL was verified live recently. */
export async function isRecentlyVerifiedLive(url: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - RECENT_VERIFY_SKIP_MS);
  const [row] = await db
    .select({ id: sponsorLicenceVacanciesTable.id })
    .from(sponsorLicenceVacanciesTable)
    .where(
      and(
        eq(sponsorLicenceVacanciesTable.url, url),
        eq(sponsorLicenceVacanciesTable.liveness, "live"),
        gt(sponsorLicenceVacanciesTable.lastVerifiedAt, cutoff),
      ),
    )
    .limit(1);
  return !!row;
}

/** Mark all stored sponsor vacancies with this exact URL as dead, recording why. */
export async function markSponsorVacanciesDeadByUrl(url: string, reason: string): Promise<void> {
  await db
    .update(sponsorLicenceVacanciesTable)
    .set({
      liveness: "dead",
      lastVerifiedAt: new Date(),
      livenessReason: reason.slice(0, 500),
    })
    .where(eq(sponsorLicenceVacanciesTable.url, url));
}
