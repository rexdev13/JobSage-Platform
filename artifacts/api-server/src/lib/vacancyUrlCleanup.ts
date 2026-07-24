import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { isNotNull, inArray } from "drizzle-orm";
import { writeAuditEvent } from "./audit";
import { isBlockedVacancyUrl, isValidVacancyDeepLink } from "./vacancyUrlPolicy";

export const VACANCY_URL_CLEANUP_ACTION = "vacancy_url_cleanup";

export interface VacancyUrlCleanupSummary {
  scanned: number;
  aggregatorPurges: number;
  genericPurges: number;
  remainingValidDeepLinks: number;
  ranAt: string;
}

/**
 * One-off cleanup: scan sponsor_licence_vacancies rows with non-null URLs and
 * null out any that fail the shared deep-link policy (aggregator domains or
 * generic careers/homepage URLs). Logs counts and writes an audit event.
 */
export async function runVacancyUrlCleanup(
  triggeredBy = "manual",
): Promise<VacancyUrlCleanupSummary> {
  const rows = await db
    .select({ id: sponsorLicenceVacanciesTable.id, url: sponsorLicenceVacanciesTable.url })
    .from(sponsorLicenceVacanciesTable)
    .where(isNotNull(sponsorLicenceVacanciesTable.url));

  const aggregatorIds: number[] = [];
  const genericIds: number[] = [];
  let remainingValidDeepLinks = 0;

  for (const row of rows) {
    const url = row.url!;
    if (isValidVacancyDeepLink(url)) {
      remainingValidDeepLinks++;
    } else if (isBlockedVacancyUrl(url)) {
      aggregatorIds.push(row.id);
    } else {
      genericIds.push(row.id);
    }
  }

  const badIds = [...aggregatorIds, ...genericIds];
  const CHUNK = 500;
  for (let i = 0; i < badIds.length; i += CHUNK) {
    await db
      .update(sponsorLicenceVacanciesTable)
      .set({ url: null })
      .where(inArray(sponsorLicenceVacanciesTable.id, badIds.slice(i, i + CHUNK)));
  }

  const summary: VacancyUrlCleanupSummary = {
    scanned: rows.length,
    aggregatorPurges: aggregatorIds.length,
    genericPurges: genericIds.length,
    remainingValidDeepLinks,
    ranAt: new Date().toISOString(),
  };

  console.log(
    `[vacancy-url-cleanup] scanned: ${summary.scanned}, aggregator purges: ${summary.aggregatorPurges}, generic purges: ${summary.genericPurges}, remaining valid deep-links: ${summary.remainingValidDeepLinks}`,
  );

  await writeAuditEvent("system:cleanup", VACANCY_URL_CLEANUP_ACTION, "sponsor_licence_vacancies", {
    ...summary,
    triggeredBy,
  });

  return summary;
}
