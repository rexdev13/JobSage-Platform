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
import { searchNhsJobs } from "./nhsJobsClient";
import { searchReedJobs } from "./reedJobsClient";
import {
  completeReedVacancyProbe,
  failReedVacancyProbe,
  reserveReedVacancyProbe,
} from "./reedOutageBackoff";
import {
  canonicalVacancyUrl,
  classifyVacancySource,
  vacancyStorageKey,
  type VacancySourceType,
} from "./vacancySource";
import {
  completeNhsVacancyProbe,
  failNhsVacancyProbe,
  reserveNhsVacancyProbe,
} from "./nhsOutageBackoff";

export const VACANCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_QUALITY_VACANCIES_PER_EMPLOYER = 12;

// Re-export shared URL policy so existing imports keep working.
export { BLOCKED_VACANCY_DOMAINS, isBlockedVacancyUrl, isValidVacancyDeepLink };
import { queueLinkVerificationBatch } from "./linkVerification";

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
  let nhsResultsRequestSucceeded = false;
  let nhsTransientFailure = false;
  let reedResultsRequestSucceeded = false;
  let reedTransientFailure = false;

  const discovered: VacancyListItem[] = [];
  const nhsProbe = await reserveNhsVacancyProbe(organisationName);
  let nhsRetryAt: Date | undefined;
  if (nhsProbe.allowed) {
    try {
      const nhs = await searchNhsJobs(organisationName);
      sourceUrl = nhs.sourceUrl;
      nhsResultsRequestSucceeded = nhs.resultsRequestSucceeded;
      nhsTransientFailure = nhs.transientFailure ?? !nhs.resultsRequestSucceeded;
      discovered.push(
        ...nhs.vacancies.map((vacancy) => ({
          ...vacancy,
          ...classifyVacancySource(vacancy.url),
        })),
      );
      console.info(
        `[vacancy-check] used_nhs_http organisation="${organisationName}" vacancies=${nhs.vacancies.length} structured_feed=${nhs.structuredFeedWorked} results_success=${nhs.resultsRequestSucceeded}`,
      );
    } catch {
      nhsTransientFailure = true;
    }
    if (nhsTransientFailure) {
      nhsRetryAt = (await failNhsVacancyProbe(nhsProbe)) ?? undefined;
      if (nhsRetryAt) {
        console.warn(
          `[vacancy-check] NHS Jobs unavailable organisation="${organisationName}" retry_after=${nhsRetryAt.toISOString()}`,
        );
      }
    } else {
      await completeNhsVacancyProbe(nhsProbe);
    }
  } else {
    nhsTransientFailure = true;
    nhsRetryAt = nhsProbe.retryAt;
  }

  const reedProbe = await reserveReedVacancyProbe(organisationName);
  if (reedProbe.allowed) {
    try {
      const reed = await searchReedJobs(organisationName);
      reedResultsRequestSucceeded = reed.requestSucceeded;
      reedTransientFailure = reed.transientFailure;
      discovered.push(...reed.vacancies);
      console.info(
        `[vacancy-check] used_reed_http organisation="${organisationName}" vacancies=${reed.vacancies.length} results_success=${reed.requestSucceeded}`,
      );
    } catch {
      reedTransientFailure = true;
    }
    if (reedTransientFailure) {
      const retryAt = await failReedVacancyProbe(reedProbe);
      if (retryAt) {
        console.warn(
          `[vacancy-check] Reed unavailable organisation="${organisationName}" retry_after=${retryAt.toISOString()}`,
        );
      }
    } else {
      await completeReedVacancyProbe(reedProbe);
    }
  } else {
    reedTransientFailure = true;
  }

  const seenVacancies = new Set<string>();
  vacancyList = discovered.filter((vacancy) => {
    if (!vacancy.url) return false;
    const key = vacancyStorageKey(organisationName, vacancy.url);
    if (!key || seenVacancies.has(key)) return false;
    seenVacancies.add(key);
    return true;
  }).slice(0, MAX_QUALITY_VACANCIES_PER_EMPLOYER);
  vacanciesFound = vacancyList.length > 0;
  vacancyCount = vacancyList.length || null;
  summary = vacanciesFound
    ? `${vacancyList.length} matching ${vacancyList.length === 1 ? "vacancy" : "vacancies"} found across supported job boards.`
    : "No closely matched current vacancies found on supported job boards.";

  // Never cache a cross-board empty snapshot when a board was unavailable.
  if (!vacanciesFound && (nhsTransientFailure || reedTransientFailure)) {
    return unavailableResult(sourceUrl, nhsRetryAt ?? new Date(Date.now() + 45 * 60 * 1000));
  }

  const [saved] = await db
    .insert(sponsorLicenceVacancyChecksTable)
    .values({ organisationName, vacanciesFound, vacancyCount, sourceUrl, summary, vacancyList })
    .returning();

  // Persist HTTP discoveries without deleting the previous usable snapshot.
  // Closed/stale adverts are retired by the liveness sweep, while outages never
  // turn into destructive empty snapshots.
  // Liveness carry-over: rows in the new snapshot whose URL was already
  // verified by the liveness sweep keep that verdict (live or dead) and its
  // timestamp/reason instead of resetting to "unverified" on every refresh.
  const priorLiveness = new Map<
    string,
    { liveness: "unverified" | "live" | "dead"; lastVerifiedAt: Date | null; livenessReason: string | null }
  >();
  const priorRows = await db
    .select({
      url: sponsorLicenceVacanciesTable.url,
      liveness: sponsorLicenceVacanciesTable.liveness,
      lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
      livenessReason: sponsorLicenceVacanciesTable.livenessReason,
    })
    .from(sponsorLicenceVacanciesTable)
    .where(eq(sponsorLicenceVacanciesTable.organisationName, organisationName));
  for (const r of priorRows) {
    if (r.url && r.liveness !== "unverified") {
      priorLiveness.set(r.url, { liveness: r.liveness, lastVerifiedAt: r.lastVerifiedAt, livenessReason: r.livenessReason });
    }
  }

  if (vacancyList && vacancyList.length > 0) {
    const existing = await db
      .select()
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.organisationName, organisationName));
    const existingUrls = new Set(
      existing.flatMap((row) => {
        const canonical = row.url ? canonicalVacancyUrl(row.url) : null;
        return canonical ? [canonical] : [];
      }),
    );
    const newVacancies = vacancyList.filter((v) => {
      const canonical = v.url ? canonicalVacancyUrl(v.url) : null;
      return canonical != null && !existingUrls.has(canonical);
    });
    const checkDate = new Date().toISOString().split("T")[0]!;
    const inserted = newVacancies.length > 0 ? await db
      .insert(sponsorLicenceVacanciesTable)
      .values(
        newVacancies.map((v) => {
          const prior = v.url ? priorLiveness.get(v.url) : undefined;
          return {
            organisationName,
            checkDate,
            title: v.title,
            location: v.location ?? null,
            salary: v.salary ?? null,
            url: v.url ?? null,
            description: v.description ?? null,
            postedDate: v.postedDate ?? null,
            targetRegions: v.targetRegions ?? [],
            sourceType: v.sourceType,
            boardName: v.boardName,
            externalListingId: v.externalListingId,
            liveness: prior?.liveness ?? ("unverified" as const),
            lastVerifiedAt: prior?.lastVerifiedAt ?? null,
            livenessReason: prior?.livenessReason ?? null,
          };
        }),
      )
      .returning({
        id: sponsorLicenceVacanciesTable.id,
        url: sponsorLicenceVacanciesTable.url,
        liveness: sponsorLicenceVacanciesTable.liveness,
      }) : [];
    console.info(
      `[vacancy-check] persisted_http organisation="${organisationName}" nhs=${vacancyList.filter((v) => v.boardName === "NHS Jobs").length} reed=${vacancyList.filter((v) => v.boardName === "Reed").length} inserted=${inserted.length}`,
    );

    // Verify newly discovered links right away (fire-and-forget) so fresh
    // snapshots don't sit unverified until the next background sweep.
    queueLinkVerificationBatch(
      inserted
        .filter((r) => r.liveness === "unverified" && r.url)
        .map((r) => ({ source: "sponsor_vacancy" as const, id: r.id, url: r.url })),
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
  };
}
