import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { isNotNull, inArray } from "drizzle-orm";
import { writeAuditEvent } from "./audit";
import {
  isBlockedVacancyUrl,
  isValidVacancyDeepLink,
  getBlockedVacancyDomain,
  isShortenerUrl,
} from "./vacancyUrlPolicy";

export const VACANCY_URL_CLEANUP_ACTION = "vacancy_url_cleanup";

export interface ShortenerRow {
  id: number;
  url: string;
  organisationName: string;
}

export interface VacancyUrlCleanupSummary {
  /** Total rows with a non-null URL that were inspected. */
  scanned: number;
  /** Rows whose URL matched a blocked aggregator/board domain → URL nulled. */
  aggregatorPurges: number;
  /** Rows whose URL failed isValidVacancyDeepLink (generic path etc.) but was
   *  not on the domain blocklist → URL nulled. */
  genericPurges: number;
  /** Rows whose URL is a link-shortener — NOT purged; returned for manual review. */
  shortenerFlagged: number;
  /** Rows whose URL passed all checks and was kept. */
  remainingValidDeepLinks: number;
  /**
   * Per-blocklist-domain purge counts (keyed by the matching BLOCKED_VACANCY_DOMAINS
   * entry, e.g. "linkedin.com" covers uk.linkedin.com, www.linkedin.com, etc.).
   */
  byDomain: Record<string, number>;
  /** Rows with shortened URLs — list them for manual review. */
  shortenerRows: ShortenerRow[];
  ranAt: string;
}

/**
 * Scan every non-null URL in `sponsor_licence_vacancies` and null out any
 * that fail the shared deep-link policy (aggregator domains or generic
 * careers/homepage paths).  Rows with link-shortener URLs are flagged for
 * manual review but NOT purged.
 *
 * No AI/LLM calls are made — this is pure domain matching against the
 * in-memory blocklist.
 */
export async function runVacancyUrlCleanup(
  triggeredBy = "manual",
): Promise<VacancyUrlCleanupSummary> {
  // Fetch every row that has a URL — we process in-memory so we can give
  // accurate per-domain counts without 30,000 individual UPDATE calls.
  const rows = await db
    .select({
      id: sponsorLicenceVacanciesTable.id,
      url: sponsorLicenceVacanciesTable.url,
      organisationName: sponsorLicenceVacanciesTable.organisationName,
    })
    .from(sponsorLicenceVacanciesTable)
    .where(isNotNull(sponsorLicenceVacanciesTable.url));

  const aggregatorIds: number[] = [];
  const genericIds: number[] = [];
  const byDomain: Record<string, number> = {};
  const shortenerRows: ShortenerRow[] = [];
  let remainingValidDeepLinks = 0;

  for (const row of rows) {
    const url = row.url!;

    // Link shorteners: destination is unknown — flag for manual review, skip purge.
    if (isShortenerUrl(url)) {
      shortenerRows.push({ id: row.id, url, organisationName: row.organisationName });
      continue;
    }

    if (isBlockedVacancyUrl(url)) {
      aggregatorIds.push(row.id);
      const domain = getBlockedVacancyDomain(url) ?? "unknown";
      byDomain[domain] = (byDomain[domain] ?? 0) + 1;
    } else if (!isValidVacancyDeepLink(url)) {
      genericIds.push(row.id);
      // Group generics under a sentinel key
      byDomain["(generic-path)"] = (byDomain["(generic-path)"] ?? 0) + 1;
    } else {
      remainingValidDeepLinks++;
    }
  }

  // Apply nulls in batches of 500 to avoid enormous IN() clauses.
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
    shortenerFlagged: shortenerRows.length,
    remainingValidDeepLinks,
    byDomain,
    shortenerRows,
    ranAt: new Date().toISOString(),
  };

  // Console log — structured so it's easy to read in server logs.
  console.log(
    `[vacancy-url-cleanup] ` +
    `scanned=${summary.scanned} ` +
    `aggregator_purges=${summary.aggregatorPurges} ` +
    `generic_purges=${summary.genericPurges} ` +
    `shortener_flagged=${summary.shortenerFlagged} ` +
    `remaining_valid=${summary.remainingValidDeepLinks}`,
  );
  const domainLines = Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => `  ${d}: ${n}`)
    .join("\n");
  if (domainLines) console.log(`[vacancy-url-cleanup] by domain:\n${domainLines}`);
  if (shortenerRows.length) {
    console.log(
      `[vacancy-url-cleanup] shortener URLs flagged for manual review (${shortenerRows.length}):`,
    );
    shortenerRows.slice(0, 20).forEach((r) =>
      console.log(`  id=${r.id} org="${r.organisationName}" url=${r.url}`),
    );
  }

  await writeAuditEvent("system:cleanup", VACANCY_URL_CLEANUP_ACTION, "sponsor_licence_vacancies", {
    scanned: summary.scanned,
    aggregatorPurges: summary.aggregatorPurges,
    genericPurges: summary.genericPurges,
    shortenerFlagged: summary.shortenerFlagged,
    remainingValidDeepLinks: summary.remainingValidDeepLinks,
    byDomain: summary.byDomain,
    triggeredBy,
  });

  return summary;
}
