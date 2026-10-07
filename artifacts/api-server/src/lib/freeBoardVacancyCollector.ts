import {
  db,
  sponsorLicenceIdentityCrosswalkTable,
  sponsorLicenceVacanciesTable,
  sponsorLicencesTable,
  vacancySourceListingAuditsTable,
  vacancySourceObservationsTable,
  vacancySourceStatesTable,
  vacancySyncLogTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  normalizeSponsorIdentityValue,
  SPONSOR_IDENTITY_SOURCE,
} from "./sponsorWebsiteCrossEnvIdentity";
import {
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
  type BoardAdvert,
} from "./boardVacancyPipeline";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { ALL_FREE_BOARD_SOURCES, isFreeBoardSourceId } from "./freeBoardSourceRegistry";
import type { FreeBoardSource } from "./freeBoardSources";

const SOURCE_BACKOFF_BASE_MS = 5 * 60_000;
const SOURCE_BACKOFF_MAX_MS = 6 * 60 * 60_000;
const FEED_REQUEST_TIMEOUT_MS = 15_000;
const METADATA_PROVIDER = "provider";

type SourceRunMetrics = {
  sourceId: string;
  provider: string;
  pagesFetched: number;
  recordsFetched: number;
  uniqueListingsSeen: number;
  duplicateListingsSkipped: number;
  sweepStartedAt: string | null;
  sweepUniqueListingsSeen: number;
  sweepSponsorMatched: number;
  unmatchedSponsorIdentity: number;
  sweepUnmatchedSponsorIdentity: number;
  sponsorMatched: number;
  saved: number;
  inserted: number;
  updated: number;
  revived: number;
  rejectedInvalid: number;
  sitemapGone: number;
  missingCount: number;
  reportedTotal: number | null;
  coverageWarning?: string;
  sitemapTotal?: number;
  sitemapOnlyCount?: number;
  missingReconciliation: boolean;
  outcome: string;
  nextCursor: string | null;
  error?: string;
};

function summarizeCursorForMetrics(sourceId: string, cursor: string | null): string | null {
  if (sourceId !== "teaching-vacancies" || cursor == null) return cursor;
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return cursor;
    const state = parsed as Record<string, unknown>;
    if (state["phase"] === "list" && Number.isInteger(state["page"])) {
      return JSON.stringify({
        phase: "list",
        page: state["page"],
        listedIdCount: Array.isArray(state["listedIds"]) ? state["listedIds"].length : 0,
      });
    }
    if (state["phase"] === "sitemap" && Number.isInteger(state["offset"])) {
      return JSON.stringify({
        phase: "sitemap",
        offset: state["offset"],
        sitemapHash: state["sitemapHash"] ?? null,
        listedIdCount: Array.isArray(state["listedIds"]) ? state["listedIds"].length : 0,
      });
    }
  } catch {
    // Older cursors are already short; retain them as-is in metrics.
  }
  return cursor;
}

export type FreeBoardCollectorSummary = {
  selected: number;
  recordsFetched: number;
  uniqueListingsSeen: number;
  duplicateListingsSkipped: number;
  sweepUniqueListingsSeen: number;
  sweepSponsorMatched: number;
  unmatchedSponsorIdentity: number;
  sweepUnmatchedSponsorIdentity: number;
  sponsorMatched: number;
  saved: number;
  upserted: number;
  errors: number;
  done: boolean;
  remaining: number;
  durationMs: number;
  metrics: {
    sources: SourceRunMetrics[];
    completedSweeps: string[];
    sourceId?: string;
  };
};

function observationSourceId(source: FreeBoardSource): string {
  return `job_board:${source.boardName.trim().toLowerCase()}`;
}

function cleanEmployerKey(value: string): string {
  return value.trim().toLowerCase();
}

type ReviewedEmployerAliases = {
  matches: Map<string, string>;
  ambiguous: Set<string>;
};

type SponsorEmployerResolution = {
  matches: Map<string, string>;
  unmatchedReasons: Map<string, "no_sponsor_identity_match" | "ambiguous_sponsor_identity">;
};

async function loadReviewedEmployerAliases(): Promise<ReviewedEmployerAliases> {
  const rows = await db
    .select({
      identitySnapshot: sponsorLicenceIdentityCrosswalkTable.identitySnapshot,
      resolutionMethod: sponsorLicenceIdentityCrosswalkTable.resolutionMethod,
      organisationName: sponsorLicencesTable.organisationName,
    })
    .from(sponsorLicenceIdentityCrosswalkTable)
    .innerJoin(
      sponsorLicencesTable,
      eq(
        sponsorLicenceIdentityCrosswalkTable.targetSponsorLicenceId,
        sponsorLicencesTable.id,
      ),
    )
    .where(eq(
      sponsorLicenceIdentityCrosswalkTable.sourceSystem,
      SPONSOR_IDENTITY_SOURCE,
    ));

  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    if (
      row.resolutionMethod !== "exact_unique" &&
      row.resolutionMethod !== "manual_review"
    ) continue;
    const alias = normalizeSponsorIdentityValue(
      row.identitySnapshot["organisationName"],
    );
    const canonicalName = row.organisationName.trim();
    if (!alias || !canonicalName) continue;
    const names = candidates.get(alias) ?? new Set<string>();
    names.add(canonicalName);
    candidates.set(alias, names);
  }

  const matches = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [alias, names] of candidates) {
    if (names.size === 1) matches.set(alias, [...names][0]!);
    else ambiguous.add(alias);
  }
  return { matches, ambiguous };
}

function hasRequiredListingIdentity(advert: BoardAdvert): boolean {
  if (!advert.externalId?.trim() || !advert.title.trim() || !advert.organisationName.trim()) return false;
  try {
    const url = new URL(advert.url);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function resolveSponsorEmployers(
  adverts: readonly BoardAdvert[],
  reviewedAliases: ReviewedEmployerAliases,
): Promise<SponsorEmployerResolution> {
  const employerKeys = [...new Set(
    adverts
      .map((advert) => advert.organisationName.trim())
      .filter(Boolean)
      .map(cleanEmployerKey),
  )];
  if (employerKeys.length === 0) {
    return { matches: new Map(), unmatchedReasons: new Map() };
  }
  const rows = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable)
    .where(
      inArray(
        sql<string>`lower(btrim(${sponsorLicencesTable.organisationName}))`,
        employerKeys,
      ),
    );
  const canonicalNames = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = cleanEmployerKey(row.organisationName);
    const names = canonicalNames.get(key) ?? new Set<string>();
    names.add(row.organisationName.trim());
    canonicalNames.set(key, names);
  }

  const matches = new Map<string, string>();
  const unmatchedReasons = new Map<
    string,
    "no_sponsor_identity_match" | "ambiguous_sponsor_identity"
  >();
  for (const advert of adverts) {
    const key = cleanEmployerKey(advert.organisationName);
    const directNames = canonicalNames.get(key);
    if (directNames?.size === 1) {
      matches.set(key, [...directNames][0]!);
      continue;
    }

    const aliasKey = normalizeSponsorIdentityValue(advert.organisationName);
    const alias = reviewedAliases.matches.get(aliasKey);
    if (alias) {
      matches.set(key, alias);
      continue;
    }

    const ambiguous = (directNames?.size ?? 0) > 1 ||
      reviewedAliases.ambiguous.has(aliasKey);
    unmatchedReasons.set(
      key,
      ambiguous ? "ambiguous_sponsor_identity" : "no_sponsor_identity_match",
    );
  }
  return { matches, unmatchedReasons };
}

async function getSeenExternalIds(
  sourceId: string,
  sweepStartedAt: Date,
): Promise<Set<string>> {
  const [observations, listingAudits] = await Promise.all([
    db
      .select({ externalId: vacancySourceObservationsTable.externalId })
      .from(vacancySourceObservationsTable)
      .where(and(
        eq(vacancySourceObservationsTable.sourceId, sourceId),
        gte(vacancySourceObservationsTable.lastSeenAt, sweepStartedAt),
      )),
    db
      .select({ externalId: vacancySourceListingAuditsTable.externalId })
      .from(vacancySourceListingAuditsTable)
      .where(and(
        eq(vacancySourceListingAuditsTable.sourceId, sourceId),
        gte(vacancySourceListingAuditsTable.lastSeenAt, sweepStartedAt),
      )),
  ]);
  return new Set([
    ...observations.map((row) => row.externalId),
    ...listingAudits.map((row) => row.externalId),
  ]);
}

async function getSweepListingCounts(
  sourceId: string,
  sweepStartedAt: Date,
): Promise<{
  uniqueListingsSeen: number;
  sponsorMatched: number;
  unmatchedSponsorIdentity: number;
}> {
  const [observations, listingAudits] = await Promise.all([
    db
      .select({ externalId: vacancySourceObservationsTable.externalId })
      .from(vacancySourceObservationsTable)
      .where(and(
        eq(vacancySourceObservationsTable.sourceId, sourceId),
        gte(vacancySourceObservationsTable.lastSeenAt, sweepStartedAt),
      )),
    db
      .select({ externalId: vacancySourceListingAuditsTable.externalId })
      .from(vacancySourceListingAuditsTable)
      .where(and(
        eq(vacancySourceListingAuditsTable.sourceId, sourceId),
        gte(vacancySourceListingAuditsTable.lastSeenAt, sweepStartedAt),
      )),
  ]);
  const matchedIds = new Set(observations.map((row) => row.externalId));
  const unmatchedIds = new Set(
    listingAudits
      .map((row) => row.externalId)
      .filter((externalId) => !matchedIds.has(externalId)),
  );
  return {
    uniqueListingsSeen: new Set([...matchedIds, ...unmatchedIds]).size,
    sponsorMatched: matchedIds.size,
    unmatchedSponsorIdentity: unmatchedIds.size,
  };
}

async function persistUnmatchedEmployerListings(
  sourceId: string,
  source: FreeBoardSource,
  adverts: readonly BoardAdvert[],
  unmatchedReasons: ReadonlyMap<
    string,
    "no_sponsor_identity_match" | "ambiguous_sponsor_identity"
  >,
): Promise<void> {
  const now = new Date();
  const unmatched = adverts.flatMap((advert) => {
    const matchReason = unmatchedReasons.get(cleanEmployerKey(advert.organisationName));
    const externalId = advert.externalId?.trim();
    if (!matchReason || !externalId) return [];
    return [{
      sourceId,
      provider: source.provider,
      boardName: source.boardName,
      externalId,
      employerName: advert.organisationName.trim(),
      title: advert.title.trim(),
      listingUrl: advert.url,
      matchReason,
      parserVersion: source.parserVersion,
      firstSeenAt: now,
      lastSeenAt: now,
    }];
  });
  if (unmatched.length === 0) return;

  await db
    .insert(vacancySourceListingAuditsTable)
    .values(unmatched)
    .onConflictDoUpdate({
      target: [
        vacancySourceListingAuditsTable.sourceId,
        vacancySourceListingAuditsTable.externalId,
      ],
      set: {
        provider: sql`excluded.provider`,
        boardName: sql`excluded.board_name`,
        employerName: sql`excluded.employer_name`,
        title: sql`excluded.title`,
        listingUrl: sql`excluded.listing_url`,
        matchReason: sql`excluded.match_reason`,
        parserVersion: sql`excluded.parser_version`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    });
}

async function persistSourceState(
  source: FreeBoardSource,
  values: Partial<typeof vacancySourceStatesTable.$inferInsert>,
): Promise<void> {
  await db
    .insert(vacancySourceStatesTable)
    .values({
      sourceId: source.id,
      provider: source.provider,
      sourceType: "job_board",
      boardName: source.boardName,
      parserVersion: source.parserVersion,
      ...values,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: vacancySourceStatesTable.sourceId,
      set: {
        provider: source.provider,
        sourceType: "job_board",
        boardName: source.boardName,
        parserVersion: source.parserVersion,
        ...values,
        updatedAt: new Date(),
      },
    });
}

async function markCompletedSweepMissing(
  sourceId: string,
  sweepStartedAt: Date,
  completedAt: Date,
): Promise<number> {
  const newlyMissing = await db
    .update(vacancySourceObservationsTable)
    .set({ missingSince: completedAt })
    .where(and(
      eq(vacancySourceObservationsTable.sourceId, sourceId),
      lt(vacancySourceObservationsTable.lastSeenAt, sweepStartedAt),
      isNull(vacancySourceObservationsTable.missingSince),
    ))
    .returning({ vacancyId: vacancySourceObservationsTable.vacancyId });
  const affectedVacancyIds = [...new Set(newlyMissing.map((row) => row.vacancyId))];
  if (affectedVacancyIds.length === 0) return 0;

  await db
    .update(sponsorLicenceVacanciesTable)
    .set({
      sourceMissingSince: sql`
        CASE
          WHEN EXISTS (
            SELECT 1 FROM vacancy_source_observations active_source
            WHERE active_source.vacancy_id = ${sponsorLicenceVacanciesTable.id}
              AND active_source.missing_since IS NULL
          )
          THEN NULL
          ELSE COALESCE(${sponsorLicenceVacanciesTable.sourceMissingSince}, ${completedAt})
        END
      `,
      sourceMissingObservations: sql`
        CASE
          WHEN EXISTS (
            SELECT 1 FROM vacancy_source_observations active_source
            WHERE active_source.vacancy_id = ${sponsorLicenceVacanciesTable.id}
              AND active_source.missing_since IS NULL
          )
          THEN 0
          ELSE ${sponsorLicenceVacanciesTable.sourceMissingObservations} + 1
        END
      `,
    })
    .where(inArray(sponsorLicenceVacanciesTable.id, affectedVacancyIds));
  return affectedVacancyIds.length;
}

function retryAt(consecutiveFailures: number, permanent: boolean): Date {
  const backoff = permanent
    ? SOURCE_BACKOFF_MAX_MS
    : Math.min(
        SOURCE_BACKOFF_MAX_MS,
        SOURCE_BACKOFF_BASE_MS * (2 ** Math.max(0, consecutiveFailures - 1)),
      );
  return new Date(Date.now() + backoff);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

function isPermanentSourceFailure(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "failureClass" in error &&
    (error as { failureClass?: unknown }).failureClass === "permanent",
  );
}

/**
 * Collects only free, keyless public-board feeds. Each page is committed through
 * the existing shared upsert and source observations. Cursor advancement and
 * missing-vacancy reconciliation happen only after a fully parsed page/sweep.
 */
export async function runFreeBoardVacancyCollector(options: {
  pagesPerSource: number;
  deadlineMs?: number;
  sourceId?: string;
}): Promise<FreeBoardCollectorSummary> {
  const startedAt = Date.now();
  const pagesPerSource = Math.max(1, Math.floor(options.pagesPerSource));
  if (options.sourceId !== undefined && !isFreeBoardSourceId(options.sourceId)) {
    throw new Error(`Unknown free-board source ID: ${options.sourceId}`);
  }
  const sources = options.sourceId !== undefined
    ? ALL_FREE_BOARD_SOURCES.filter((source) => source.id === options.sourceId)
    : ALL_FREE_BOARD_SOURCES;
  const metrics: SourceRunMetrics[] = [];
  const completedSweeps: string[] = [];
  let selected = 0;
  let uniqueListingsSeen = 0;
  let duplicateListingsSkipped = 0;
  let unmatchedSponsorIdentity = 0;
  let sponsorMatched = 0;
  let upserted = 0;
  let errors = 0;
  let remaining = 0;
  let reviewedAliases: ReviewedEmployerAliases | null = null;

  for (const source of sources) {
    const sourceObservationId = observationSourceId(source);
    let [storedState] = await db
      .select()
      .from(vacancySourceStatesTable)
      .where(eq(vacancySourceStatesTable.sourceId, source.id))
      .limit(1);
    if (!storedState) {
      await persistSourceState(source, {});
      [storedState] = await db
        .select()
        .from(vacancySourceStatesTable)
        .where(eq(vacancySourceStatesTable.sourceId, source.id))
        .limit(1);
    }
    if (!storedState) {
      errors += 1;
      remaining += 1;
      metrics.push({
        sourceId: source.id,
        provider: source.provider,
        pagesFetched: 0,
        recordsFetched: 0,
        uniqueListingsSeen: 0,
        duplicateListingsSkipped: 0,
        sweepStartedAt: null,
        sweepUniqueListingsSeen: 0,
        sweepSponsorMatched: 0,
        unmatchedSponsorIdentity: 0,
        sweepUnmatchedSponsorIdentity: 0,
        sponsorMatched: 0,
        saved: 0,
        inserted: 0,
        updated: 0,
        revived: 0,
        rejectedInvalid: 0,
        sitemapGone: 0,
        missingCount: 0,
        reportedTotal: null,
        missingReconciliation: source.reconcileMissingAfterSweep !== false,
        outcome: "state_unavailable",
        nextCursor: null,
      });
      continue;
    }

    const parserChanged = storedState.parserVersion !== source.parserVersion;
    const now = new Date();
    if (!parserChanged && storedState.nextRetryAt && storedState.nextRetryAt > now) {
      remaining += 1;
      metrics.push({
        sourceId: source.id,
        provider: source.provider,
        pagesFetched: 0,
        recordsFetched: 0,
        uniqueListingsSeen: 0,
        duplicateListingsSkipped: 0,
        sweepStartedAt: storedState.sweepStartedAt?.toISOString() ?? null,
        sweepUniqueListingsSeen: 0,
        sweepSponsorMatched: 0,
        unmatchedSponsorIdentity: 0,
        sweepUnmatchedSponsorIdentity: 0,
        sponsorMatched: 0,
        saved: 0,
        inserted: 0,
        updated: 0,
        revived: 0,
        rejectedInvalid: 0,
        sitemapGone: 0,
        missingCount: 0,
        reportedTotal: storedState.reportedTotal,
        missingReconciliation: source.reconcileMissingAfterSweep !== false,
        outcome: "skipped_backoff",
        nextCursor: summarizeCursorForMetrics(source.id, storedState.cursor),
      });
      continue;
    }

    let cursor = parserChanged ? null : storedState.cursor;
    let sweepStartedAt = cursor
      ? storedState.sweepStartedAt ?? now
      : now;
    if (parserChanged) {
      await persistSourceState(source, {
        cursor: null,
        sweepStartedAt,
        nextRetryAt: null,
        lastError: null,
      });
    }

    const sourceMetrics: SourceRunMetrics = {
      sourceId: source.id,
      provider: source.provider,
      pagesFetched: 0,
      recordsFetched: 0,
      uniqueListingsSeen: 0,
      duplicateListingsSkipped: 0,
      sweepStartedAt: sweepStartedAt.toISOString(),
      sweepUniqueListingsSeen: 0,
      sweepSponsorMatched: 0,
      unmatchedSponsorIdentity: 0,
      sweepUnmatchedSponsorIdentity: 0,
      sponsorMatched: 0,
      saved: 0,
      inserted: 0,
      updated: 0,
      revived: 0,
      rejectedInvalid: 0,
      sitemapGone: 0,
      missingCount: 0,
      reportedTotal: storedState.reportedTotal,
      missingReconciliation: source.reconcileMissingAfterSweep !== false,
      outcome: "partial",
      nextCursor: cursor,
    };

    let pagesProcessed = 0;
    let blockedByInvalidRecord = false;
    let sourceError: unknown = null;
    let coverageWarning: string | null = null;
    let firstPage = true;
    let deadlineStopped = false;

    while (firstPage || cursor !== null) {
      firstPage = false;
      if (pagesProcessed >= Math.min(pagesPerSource, source.maxPagesPerRun)) break;
      if (options.deadlineMs && Date.now() >= options.deadlineMs - 2_000) {
        deadlineStopped = true;
        break;
      }

      const pageCursor = cursor;
      const seenExternalIds = await getSeenExternalIds(sourceObservationId, sweepStartedAt);
      const requestDeadline = Math.min(
        options.deadlineMs ?? Number.POSITIVE_INFINITY,
        Date.now() + FEED_REQUEST_TIMEOUT_MS,
      );
      let page;
      try {
        page = await source.fetchPage({
          cursor: pageCursor,
          deadlineMs: requestDeadline,
          seenExternalIds,
        });
      } catch (error) {
        sourceError = error;
        break;
      }

      sourceMetrics.pagesFetched += 1;
      const pageRecordsFetched = page.recordsFetched ?? page.adverts.length;
      if (
        !Number.isInteger(pageRecordsFetched) ||
        pageRecordsFetched < page.adverts.length
      ) {
        sourceError = new Error("Feed returned an invalid raw listing count.");
        break;
      }
      sourceMetrics.recordsFetched += pageRecordsFetched;
      sourceMetrics.sitemapGone += page.goneCount ?? 0;
      if (page.reportedTotal != null) sourceMetrics.reportedTotal = page.reportedTotal;
      if (page.sitemapTotal != null) sourceMetrics.sitemapTotal = page.sitemapTotal;
      if (page.sitemapOnlyCount != null) {
        sourceMetrics.sitemapOnlyCount = page.sitemapOnlyCount;
      }
      selected += pageRecordsFetched;

      const pageSeenIds = new Set(seenExternalIds);
      let duplicateCount = page.duplicateListingsSkipped ?? 0;
      const uniquePageAdverts = page.adverts.filter((advert) => {
        const externalId = advert.externalId?.trim() ?? "";
        if (!externalId) return true;
        if (pageSeenIds.has(externalId)) {
          duplicateCount++;
          return false;
        }
        pageSeenIds.add(externalId);
        return true;
      });
      const pageUniqueIds = new Set(
        uniquePageAdverts
          .map((advert) => advert.externalId?.trim() ?? "")
          .filter(Boolean),
      );
      sourceMetrics.uniqueListingsSeen += pageUniqueIds.size;
      sourceMetrics.duplicateListingsSkipped += duplicateCount;
      uniqueListingsSeen += pageUniqueIds.size;
      duplicateListingsSkipped += duplicateCount;

      const requiredValid = uniquePageAdverts.filter(hasRequiredListingIdentity);
      const rejectedInvalid = uniquePageAdverts.length - requiredValid.length;
      sourceMetrics.rejectedInvalid += rejectedInvalid;
      const structuralRows = requiredValid.filter((advert) => !isManualLabourTitle(advert.title));
      const normalizable = normaliseAndDedupeBoardAdverts(structuralRows);
      const postNormalizeRejections = structuralRows.filter(
        (advert) => normaliseAndDedupeBoardAdverts([advert]).length === 0,
      ).length;
      sourceMetrics.rejectedInvalid += postNormalizeRejections;
      if (rejectedInvalid > 0 || postNormalizeRejections > 0) {
        blockedByInvalidRecord = true;
      }

      if (normalizable.length > 0 && !reviewedAliases) {
        reviewedAliases = await loadReviewedEmployerAliases();
      }
      const resolution = await resolveSponsorEmployers(
        normalizable,
        reviewedAliases ?? { matches: new Map(), ambiguous: new Set() },
      );
      const sponsorAdverts = normalizable.flatMap((advert) => {
        const canonicalName = resolution.matches.get(cleanEmployerKey(advert.organisationName));
        return canonicalName
          ? [{
              ...advert,
              organisationName: canonicalName,
              employer: canonicalName,
              sourceId: sourceObservationId,
              sourceMetadata: {
                ...(advert.sourceMetadata ?? {}),
                [METADATA_PROVIDER]: source.provider,
                parserVersion: source.parserVersion,
              },
            }]
          : [];
      });
      sourceMetrics.sponsorMatched += sponsorAdverts.length;
      sponsorMatched += sponsorAdverts.length;
      const unmatchedCount = normalizable.length - sponsorAdverts.length;
      sourceMetrics.unmatchedSponsorIdentity += unmatchedCount;
      unmatchedSponsorIdentity += unmatchedCount;

      if (sponsorAdverts.length > 0) {
        const result = await upsertSharedBoardVacancies(sponsorAdverts, {
          enrichContacts: false,
          queueVerifications: true,
        });
        sourceMetrics.inserted += result.inserted;
        sourceMetrics.updated += result.updated;
        sourceMetrics.revived += result.revived;
        sourceMetrics.saved += result.inserted + result.updated + result.revived;
        upserted += result.inserted + result.updated + result.revived;
      }
      await persistUnmatchedEmployerListings(
        sourceObservationId,
        source,
        normalizable,
        resolution.unmatchedReasons,
      );

      pagesProcessed += 1;
      if (blockedByInvalidRecord) {
        sourceMetrics.outcome = "needs_review";
        sourceMetrics.nextCursor = pageCursor;
        break;
      }
      cursor = page.nextCursor;
      sourceMetrics.nextCursor = cursor;
      if (page.coverageWarning) {
        coverageWarning = page.coverageWarning;
        sourceMetrics.coverageWarning = coverageWarning;
        break;
      }
      await persistSourceState(source, {
        cursor,
        sweepStartedAt: cursor ? sweepStartedAt : null,
        lastRunAt: new Date(),
        lastSuccessAt: new Date(),
        lastOutcome: cursor ? "partial" : "complete",
        lastError: null,
        reportedTotal: sourceMetrics.reportedTotal,
        consecutiveFailures: 0,
        nextRetryAt: null,
      });
      if (page.stopAfterPage) break;
    }

    if (sourceError) {
      errors += 1;
      remaining += 1;
      const failures = storedState.consecutiveFailures + 1;
      const permanent = isPermanentSourceFailure(sourceError);
      const sourceRetryAt = retryAt(failures, permanent);
      const hostRetry = typeof sourceError === "object" && "retryAt" in sourceError
        ? (sourceError as { retryAt?: unknown }).retryAt
        : undefined;
      const hostRetryAt = hostRetry instanceof Date ? hostRetry.getTime() : 0;
      const nextRetryAt = new Date(Math.max(
        sourceRetryAt.getTime(),
        Number.isFinite(hostRetryAt) ? hostRetryAt : 0,
      ));
      sourceMetrics.outcome = permanent ? "blocked" : "retryable_failure";
      sourceMetrics.nextCursor = cursor;
      sourceMetrics.error = errorText(sourceError);
      await persistSourceState(source, {
        cursor,
        sweepStartedAt,
        lastRunAt: new Date(),
        lastOutcome: sourceMetrics.outcome,
        lastError: sourceMetrics.error,
        consecutiveFailures: failures,
        nextRetryAt,
      });
    } else if (blockedByInvalidRecord) {
      errors += 1;
      remaining += 1;
      const failures = storedState.consecutiveFailures + 1;
      sourceMetrics.error = "Source page contained invalid listing records; cursor was not advanced.";
      await persistSourceState(source, {
        cursor: sourceMetrics.nextCursor,
        sweepStartedAt,
        lastRunAt: new Date(),
        lastOutcome: "needs_review",
        lastError: sourceMetrics.error,
        consecutiveFailures: failures,
        nextRetryAt: retryAt(failures, false),
      });
    } else if (coverageWarning) {
      errors += 1;
      remaining += 1;
      sourceMetrics.outcome = "needs_review";
      sourceMetrics.error = coverageWarning;
      await persistSourceState(source, {
        cursor,
        sweepStartedAt: cursor ? sweepStartedAt : null,
        lastRunAt: new Date(),
        lastOutcome: "needs_review",
        lastError: coverageWarning,
        reportedTotal: sourceMetrics.reportedTotal,
        consecutiveFailures: 0,
        nextRetryAt: null,
      });
    } else if (sourceMetrics.nextCursor === null && pagesProcessed > 0) {
      const completedAt = new Date();
      const missingCount = source.reconcileMissingAfterSweep === false
        ? 0
        : await markCompletedSweepMissing(
            sourceObservationId,
            sweepStartedAt,
            completedAt,
          );
      sourceMetrics.outcome = "complete";
      sourceMetrics.missingCount = missingCount;
      completedSweeps.push(source.id);
      await persistSourceState(source, {
        cursor: null,
        sweepStartedAt: null,
        lastRunAt: completedAt,
        lastSuccessAt: completedAt,
        lastExhaustedAt: completedAt,
        lastOutcome: "complete",
        lastError: null,
        reportedTotal: sourceMetrics.reportedTotal,
        consecutiveFailures: 0,
        nextRetryAt: null,
      });
    } else {
      remaining += 1;
      sourceMetrics.outcome = deadlineStopped ? "deadline_partial" : "partial";
      await persistSourceState(source, {
        cursor: sourceMetrics.nextCursor,
        sweepStartedAt,
        lastRunAt: new Date(),
        lastOutcome: "partial",
        lastError: null,
        reportedTotal: sourceMetrics.reportedTotal,
        consecutiveFailures: 0,
        nextRetryAt: null,
      });
    }
    sourceMetrics.nextCursor = summarizeCursorForMetrics(source.id, sourceMetrics.nextCursor);
    if (pagesProcessed > 0) {
      const sweepCounts = await getSweepListingCounts(sourceObservationId, sweepStartedAt);
      sourceMetrics.sweepUniqueListingsSeen = sweepCounts.uniqueListingsSeen;
      sourceMetrics.sweepSponsorMatched = sweepCounts.sponsorMatched;
      sourceMetrics.sweepUnmatchedSponsorIdentity =
        sweepCounts.unmatchedSponsorIdentity;
    }
    metrics.push(sourceMetrics);
  }

  const sweepUniqueListingsSeen = metrics.reduce(
    (total, source) => total + source.sweepUniqueListingsSeen,
    0,
  );
  const sweepSponsorMatched = metrics.reduce(
    (total, source) => total + source.sweepSponsorMatched,
    0,
  );
  const sweepUnmatchedSponsorIdentity = metrics.reduce(
    (total, source) => total + source.sweepUnmatchedSponsorIdentity,
    0,
  );
  const done = remaining === 0 && completedSweeps.length === sources.length;
  const durationMs = Date.now() - startedAt;
  await db.insert(vacancySyncLogTable).values({
    status: errors > 0 ? "error" : "success",
    batchSize: pagesPerSource,
    checkedCount: selected,
    errorCount: errors,
    errorMessage: null,
    triggeredBy: "scheduler",
    durationMs,
    jobKind: "free_board_sources",
    metrics: {
      selected,
      recordsFetched: selected,
      uniqueListingsSeen,
      duplicateListingsSkipped,
      sweepUniqueListingsSeen,
      sweepSponsorMatched,
      unmatchedSponsorIdentity,
      sweepUnmatchedSponsorIdentity,
      sponsorMatched,
      saved: upserted,
      upserted,
      errors,
      done,
      remaining,
      completedSweeps,
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      sources: metrics,
    },
  });

  return {
    selected,
    recordsFetched: selected,
    uniqueListingsSeen,
    duplicateListingsSkipped,
    sweepUniqueListingsSeen,
    sweepSponsorMatched,
    unmatchedSponsorIdentity,
    sweepUnmatchedSponsorIdentity,
    sponsorMatched,
    saved: upserted,
    upserted,
    errors,
    done,
    remaining,
    durationMs,
    metrics: {
      sources: metrics,
      completedSweeps,
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    },
  };
}
