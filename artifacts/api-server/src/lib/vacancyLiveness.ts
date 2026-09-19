import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";

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

export type CandidateVacancyStatus = "visible" | "stale" | "missing" | "dead" | "expired" | "unverified";

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
  // Legacy adapters that predate liveness fields are treated as compatible
  // records; persisted NULL values are still handled conservatively below.
  if (input.sourceType === undefined && input.liveness === undefined && input.lastVerifiedAt === undefined) return "visible";
  // Rows created before evidence tracking have a verified URL and remain visible
  // during the staged backfill; newly ingested rows always carry evidence.
  if (input.sourceType === "company_site" && !input.companyVacancyEvidence) {
    const legacyUntil = input.companyEvidenceLegacyUntil
      ? new Date(input.companyEvidenceLegacyUntil)
      : null;
    const boundedLegacy = legacyUntil
      ? now.getTime() <= legacyUntil.getTime()
      : input.sourceType === undefined && input.liveness === "live";
    if (!boundedLegacy) return "unverified";
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
