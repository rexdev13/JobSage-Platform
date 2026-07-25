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
