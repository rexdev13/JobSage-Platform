import { db } from "@workspace/db";
import {
  sponsorLicenceVacancyChecksTable,
  sponsorLicenceVacanciesTable,
  sponsorLicencesTable,
} from "@workspace/db";
import { eq, and, gt, desc, sql } from "drizzle-orm";

import {
  BLOCKED_VACANCY_DOMAINS,
  isBlockedVacancyUrl,
  isValidVacancyDeepLink,
} from "./vacancyUrlPolicy";
import {
  discoverEmployerBoardVacancies,
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
} from "./boardVacancyPipeline";
import {
  type VacancySourceType,
} from "./vacancySource";

export const VACANCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_QUALITY_VACANCIES_PER_EMPLOYER = 12;

// Re-export shared URL policy so existing imports keep working.
export { BLOCKED_VACANCY_DOMAINS, isBlockedVacancyUrl, isValidVacancyDeepLink };

export type VacancyListItem = {
  title: string;
  location: string | null;
  salary: string | null;
  url: string | null;
  description: string | null;
  postedDate: string | null;
  /** Explicitly stated, normalized regions; null/empty means unknown or unrestricted. */
  targetRegions: string[] | null;
  sourceType: VacancySourceType | null;
  boardName: string | null;
  externalListingId: string | null;
};

export type VacancyCheckResult = {
  vacanciesFound: boolean;
  vacancyCount: number | null;
  sourceUrl: string | null;
  summary: string;
  checkedAt: Date;
  fromCache: boolean;
  vacancyList: VacancyListItem[] | null;
  discoveredContactEmail: string | null;
  discoveredContactPhone: string | null;
  discoveredWebsite: string | null;
  upsertedCount: number;
};

export interface VacancyCheckOptions {
  /**
   * When true, skip the 24h cache and always run a fresh AI check.
   * Use only for contact-backfill passes where existing checks predate contact extraction.
   */
  bypassCache?: boolean;
}

function unavailableResult(
  sourceUrl: string | null,
  retryAt?: Date,
): VacancyCheckResult {
  return {
    vacanciesFound: false,
    vacancyCount: null,
    sourceUrl,
    summary: retryAt
      ? `NHS Jobs HTTP search is temporarily unavailable; retry after ${retryAt.toISOString()}.`
      : "NHS Jobs HTTP search was unavailable; no vacancies found.",
    checkedAt: new Date(),
    fromCache: false,
    vacancyList: null,
    discoveredContactEmail: null,
    discoveredContactPhone: null,
    discoveredWebsite: null,
    upsertedCount: 0,
  };
}

/**
 * Run a vacancy check for a named sponsor licence company.
 * Returns a cached result (within 24h TTL) if one exists, otherwise
 * uses NHS Jobs and Reed HTTP discovery only,
 * persists the result, and returns it.
 * Safe to call from both HTTP handlers and background schedulers.
 *
 * Pass { bypassCache: true } only for the existing, separately gated contact
 * backfill path. It forces a fresh HTTP-first discovery regardless of cache age.
 */
export async function runVacancyCheck(
  organisationName: string,
  opts: VacancyCheckOptions = {},
): Promise<VacancyCheckResult> {
  if (!opts.bypassCache) {
    const cutoff = new Date(Date.now() - VACANCY_CACHE_TTL_MS);
    const [cached] = await db
      .select()
      .from(sponsorLicenceVacancyChecksTable)
      .where(
        and(
          eq(sponsorLicenceVacancyChecksTable.organisationName, organisationName),
          gt(sponsorLicenceVacancyChecksTable.checkedAt, cutoff),
        ),
      )
      .orderBy(desc(sponsorLicenceVacancyChecksTable.checkedAt))
      .limit(1);

    if (cached) {
      return {
        vacanciesFound: cached.vacanciesFound,
        vacancyCount: cached.vacancyCount,
        sourceUrl: cached.sourceUrl,
        summary: cached.summary ?? "No active vacancies found.",
        checkedAt: cached.checkedAt,
        fromCache: true,
        vacancyList: (cached.vacancyList as VacancyListItem[] | null) ?? null,
        // Contact details are not stored on the check record; callers can read
        // them from the sponsor licence row if needed.
        discoveredContactEmail: null,
        discoveredContactPhone: null,
        discoveredWebsite: null,
        upsertedCount: 0,
      };
    }
  }

  let vacanciesFound = false;
  let vacancyCount: number | null = null;
  let sourceUrl: string | null = null;
  let summary = "No active vacancies found.";
  let vacancyList: VacancyListItem[] | null = null;
  let discoveredContactEmail: string | null = null;
  let discoveredContactPhone: string | null = null;
  let discoveredWebsite: string | null = null;
  let upsertedCount = 0;
  const discovery = await discoverEmployerBoardVacancies(organisationName);
  sourceUrl = discovery.sourceUrl;
  const normalized = normaliseAndDedupeBoardAdverts(discovery.adverts);
  vacancyList = normalized.slice(0, MAX_QUALITY_VACANCIES_PER_EMPLOYER).map((advert) => ({
    title: advert.title,
    location: advert.location,
    salary: advert.salary,
    url: advert.url,
    description: advert.description,
    postedDate: advert.postedDate,
    targetRegions: advert.targetRegions,
    sourceType: "job_board",
    boardName: advert.boardName,
    externalListingId: advert.externalId,
  }));
  console.info(
    `[vacancy-check] used_board_pipeline organisation="${organisationName}" nhs=${discovery.boardCounts.nhs ?? 0} reed=${discovery.boardCounts.reed_html ?? 0}`,
  );
  vacanciesFound = vacancyList.length > 0;
  vacancyCount = vacancyList.length || null;
  summary = vacanciesFound
    ? `${vacancyList.length} matching ${vacancyList.length === 1 ? "vacancy" : "vacancies"} found across supported job boards.`
    : "No closely matched current vacancies found on supported job boards.";

  // Never cache a cross-board empty snapshot when a board was unavailable.
  if (!vacanciesFound && discovery.transientFailure) {
    return unavailableResult(sourceUrl, discovery.retryAt ?? new Date(Date.now() + 45 * 60 * 1000));
  }

  const [saved] = await db
    .insert(sponsorLicenceVacancyChecksTable)
    .values({ organisationName, vacanciesFound, vacancyCount, sourceUrl, summary, vacancyList })
    .returning();

  if (normalized.length > 0) {
    const persisted = await upsertSharedBoardVacancies(
      normalized.slice(0, MAX_QUALITY_VACANCIES_PER_EMPLOYER),
      { organisationName },
    );
    upsertedCount = persisted.inserted + persisted.revived;
    console.info(
      `[vacancy-check] persisted_http organisation="${organisationName}" nhs=${vacancyList.filter((v) => v.boardName === "NHS Jobs").length} reed=${vacancyList.filter((v) => v.boardName === "Reed").length} inserted=${persisted.inserted}`,
    );
  }

  // Persist discovered contact details to the sponsor licence record.
  // Only fill empty fields — never overwrite admin-set or previously enriched values.
  // Uses COALESCE so existing non-null values are preserved unconditionally.
  if (discoveredContactEmail || discoveredContactPhone || discoveredWebsite) {
    try {
      const updateResult = await db
        .update(sponsorLicencesTable)
        .set({
          contactEmail: sql`COALESCE(${sponsorLicencesTable.contactEmail}, ${discoveredContactEmail})`,
          contactPhone: sql`COALESCE(${sponsorLicencesTable.contactPhone}, ${discoveredContactPhone})`,
          website: sql`COALESCE(${sponsorLicencesTable.website}, ${discoveredWebsite})`,
        })
        .where(eq(sponsorLicencesTable.organisationName, organisationName))
        .returning({
          id: sponsorLicencesTable.id,
          contactEmail: sponsorLicencesTable.contactEmail,
          contactPhone: sponsorLicencesTable.contactPhone,
          website: sponsorLicencesTable.website,
        });

      if (updateResult.length > 0) {
        console.info(
          `[vacancy-check] Contact details populated for "${organisationName}":`,
          {
            contactEmail: discoveredContactEmail ?? "(none)",
            contactPhone: discoveredContactPhone ?? "(none)",
            website: discoveredWebsite ?? "(none)",
            affectedRows: updateResult.length,
          },
        );
      }
    } catch (contactErr) {
      console.warn(
        `[vacancy-check] Failed to persist contact details for "${organisationName}":`,
        contactErr instanceof Error ? contactErr.message : contactErr,
      );
    }
  }

  return {
    vacanciesFound,
    vacancyCount,
    sourceUrl,
    summary,
    checkedAt: saved?.checkedAt ?? new Date(),
    fromCache: false,
    vacancyList,
    discoveredContactEmail,
    discoveredContactPhone,
    discoveredWebsite,
    upsertedCount,
  };
}
