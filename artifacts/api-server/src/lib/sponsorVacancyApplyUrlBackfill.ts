import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { isNull, and, ne } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { findApplyUrlWithAI, BackfillRunSummary, BackfillOptions } from "./applyUrlBackfill";
import { writeAuditEvent } from "./audit";
import { queueLinkVerification } from "./linkVerification";

export const SPONSOR_VACANCY_BACKFILL_ACTION = "sponsor_vacancy_apply_url_backfill";

let _lastRunSummary: BackfillRunSummary | null = null;

export function getLastSponsorVacancyBackfillSummary(): BackfillRunSummary | null {
  return _lastRunSummary;
}

/**
 * Run a batch of AI-assisted apply URL backfills for sponsor-licence vacancies
 * that have no URL and are not dead. Reuses the same AI search, URL policy,
 * link-verification, and audit-logging patterns as the roles backfill.
 */
export async function runSponsorVacancyApplyUrlBackfill(
  options: BackfillOptions = {},
): Promise<BackfillRunSummary> {
  const {
    batchSize = 20,
    triggeredBy = "scheduler",
    rateDelayMs = 1500,
  } = options;

  const startMs = Date.now();
  let found = 0;
  let skipped = 0;
  let failed = 0;

  // Select non-dead vacancies with no apply URL
  const vacancies = await db
    .select({
      id: sponsorLicenceVacanciesTable.id,
      title: sponsorLicenceVacanciesTable.title,
      organisationName: sponsorLicenceVacanciesTable.organisationName,
      location: sponsorLicenceVacanciesTable.location,
    })
    .from(sponsorLicenceVacanciesTable)
    .where(
      and(
        isNull(sponsorLicenceVacanciesTable.url),
        ne(sponsorLicenceVacanciesTable.liveness, "dead"),
      ),
    )
    .limit(batchSize);

  console.log(
    `[sponsor-vacancy-backfill] Starting — ${vacancies.length} vacancies to process (triggered by: ${triggeredBy})`,
  );

  for (const vac of vacancies) {
    const location = vac.location?.trim() || "United Kingdom";
    try {
      const url = await findApplyUrlWithAI(vac.title, vac.organisationName, location);

      if (url) {
        // Save URL; reset liveness so the verifier re-checks it fresh.
        await db
          .update(sponsorLicenceVacanciesTable)
          .set({ url, liveness: "unverified", lastVerifiedAt: null, livenessReason: null })
          .where(eq(sponsorLicenceVacanciesTable.id, vac.id));

        // Queue immediate link verification so the badge updates without waiting for the sweep.
        queueLinkVerification("sponsor_vacancy", vac.id, url);

        await writeAuditEvent(
          "system:backfill",
          SPONSOR_VACANCY_BACKFILL_ACTION,
          `sponsor_vacancy:${vac.id}`,
          {
            vacancyId: vac.id,
            title: vac.title,
            organisationName: vac.organisationName,
            location,
            applyUrl: url,
            outcome: "url_set",
            triggeredBy,
          },
        );

        found++;
        console.log(
          `[sponsor-vacancy-backfill] ✓ vacancy ${vac.id} "${vac.title}" @ ${vac.organisationName} — set ${url}`,
        );
      } else {
        await writeAuditEvent(
          "system:backfill",
          SPONSOR_VACANCY_BACKFILL_ACTION,
          `sponsor_vacancy:${vac.id}`,
          {
            vacancyId: vac.id,
            title: vac.title,
            organisationName: vac.organisationName,
            location,
            applyUrl: null,
            outcome: "skipped_no_url_found",
            triggeredBy,
          },
        );

        skipped++;
        console.log(
          `[sponsor-vacancy-backfill] – vacancy ${vac.id} "${vac.title}" — no valid URL found, skipped`,
        );
      }
    } catch (err) {
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[sponsor-vacancy-backfill] ✗ vacancy ${vac.id} "${vac.title}" — error: ${errorMsg}`,
      );

      await writeAuditEvent(
        "system:backfill",
        SPONSOR_VACANCY_BACKFILL_ACTION,
        `sponsor_vacancy:${vac.id}`,
        {
          vacancyId: vac.id,
          title: vac.title,
          organisationName: vac.organisationName,
          location,
          applyUrl: null,
          outcome: "failed",
          error: errorMsg.slice(0, 500),
          triggeredBy,
        },
      );
    }

    // Rate-limit between AI calls
    if (rateDelayMs > 0 && vacancies.indexOf(vac) < vacancies.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, rateDelayMs));
    }
  }

  const durationMs = Date.now() - startMs;
  const summary: BackfillRunSummary = {
    found,
    skipped,
    failed,
    total: vacancies.length,
    ranAt: new Date().toISOString(),
    triggeredBy,
    durationMs,
  };

  _lastRunSummary = summary;

  console.log(
    `[sponsor-vacancy-backfill] Complete — found: ${found}, skipped: ${skipped}, failed: ${failed}, ${durationMs}ms`,
  );

  return summary;
}
