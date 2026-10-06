import {
  db,
  sponsorLicenceVacanciesTable,
  sponsorLicencesTable,
  vacancySourceObservationsTable,
  vacancySourceStatesTable,
  vacancySyncLogTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
  type BoardAdvert,
} from "./boardVacancyPipeline";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { FREE_BOARD_SOURCES, type FreeBoardSource } from "./freeBoardSources";

const SOURCE_BACKOFF_BASE_MS = 5 * 60_000;
const SOURCE_BACKOFF_MAX_MS = 6 * 60 * 60_000;
const FEED_REQUEST_TIMEOUT_MS = 15_000;
const METADATA_PROVIDER = "provider";

type SourceRunMetrics = {
  sourceId: string;
  provider: string;
  pagesFetched: number;
  recordsFetched: number;
  inserted: number;
  updated: number;
  revived: number;
  rejectedNonSponsor: number;
  rejectedInvalid: number;
  sitemapGone: number;
  missingCount: number;
  reportedTotal: number | null;
  outcome: string;
  nextCursor: string | null;
  error?: string;
};

export type FreeBoardCollectorSummary = {
  selected: number;
  upserted: number;
  errors: number;
  done: boolean;
  remaining: number;
  durationMs: number;
  metrics: {
    sources: SourceRunMetrics[];
    completedSweeps: string[];
  };
};

function observationSourceId(source: FreeBoardSource): string {
  return `job_board:${source.boardName.trim().toLowerCase()}`;
}

function cleanEmployerKey(value: string): string {
  return value.trim().toLowerCase();
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
): Promise<Map<string, string>> {
  const employerKeys = [...new Set(
    adverts
      .map((advert) => advert.organisationName.trim())
      .filter(Boolean)
      .map(cleanEmployerKey),
  )];
  if (employerKeys.length === 0) return new Map();
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
  return new Map(
    [...canonicalNames.entries()]
      .filter(([, names]) => names.size === 1)
      .map(([key, names]) => [key, [...names][0]!]),
  );
}

async function getSeenExternalIds(
  sourceId: string,
  sweepStartedAt: Date,
): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: vacancySourceObservationsTable.externalId })
    .from(vacancySourceObservationsTable)
    .where(and(
      eq(vacancySourceObservationsTable.sourceId, sourceId),
      gte(vacancySourceObservationsTable.lastSeenAt, sweepStartedAt),
    ));
  return new Set(rows.map((row) => row.externalId));
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
}): Promise<FreeBoardCollectorSummary> {
  const startedAt = Date.now();
  const pagesPerSource = Math.max(1, Math.floor(options.pagesPerSource));
  const metrics: SourceRunMetrics[] = [];
  const completedSweeps: string[] = [];
  let selected = 0;
  let upserted = 0;
  let errors = 0;
  let remaining = 0;

  for (const source of FREE_BOARD_SOURCES) {
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
        inserted: 0,
        updated: 0,
        revived: 0,
        rejectedNonSponsor: 0,
        rejectedInvalid: 0,
        sitemapGone: 0,
        missingCount: 0,
        reportedTotal: null,
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
        inserted: 0,
        updated: 0,
        revived: 0,
        rejectedNonSponsor: 0,
        rejectedInvalid: 0,
        sitemapGone: 0,
        missingCount: 0,
        reportedTotal: storedState.reportedTotal,
        outcome: "skipped_backoff",
        nextCursor: storedState.cursor,
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
      inserted: 0,
      updated: 0,
      revived: 0,
      rejectedNonSponsor: 0,
      rejectedInvalid: 0,
      sitemapGone: 0,
      missingCount: 0,
      reportedTotal: storedState.reportedTotal,
      outcome: "partial",
      nextCursor: cursor,
    };

    let pagesProcessed = 0;
    let blockedByInvalidRecord = false;
    let sourceError: unknown = null;
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
      sourceMetrics.recordsFetched += page.adverts.length;
      sourceMetrics.sitemapGone += page.goneCount ?? 0;
      if (page.reportedTotal != null) sourceMetrics.reportedTotal = page.reportedTotal;
      selected += page.adverts.length;

      const requiredValid = page.adverts.filter(hasRequiredListingIdentity);
      const rejectedInvalid = page.adverts.length - requiredValid.length;
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

      const sponsorNames = await resolveSponsorEmployers(normalizable);
      const sponsorAdverts = normalizable.flatMap((advert) => {
        const canonicalName = sponsorNames.get(cleanEmployerKey(advert.organisationName));
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
      sourceMetrics.rejectedNonSponsor += normalizable.length - sponsorAdverts.length;

      if (sponsorAdverts.length > 0) {
        const result = await upsertSharedBoardVacancies(sponsorAdverts, {
          enrichContacts: false,
          queueVerifications: true,
        });
        sourceMetrics.inserted += result.inserted;
        sourceMetrics.updated += result.updated;
        sourceMetrics.revived += result.revived;
        upserted += result.inserted + result.updated + result.revived;
      }

      pagesProcessed += 1;
      if (blockedByInvalidRecord) {
        sourceMetrics.outcome = "needs_review";
        sourceMetrics.nextCursor = pageCursor;
        break;
      }
      cursor = page.nextCursor;
      sourceMetrics.nextCursor = cursor;
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
    }

    if (sourceError) {
      errors += 1;
      remaining += 1;
      const failures = storedState.consecutiveFailures + 1;
      const permanent = isPermanentSourceFailure(sourceError);
      const nextRetryAt = retryAt(failures, permanent);
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
    } else if (sourceMetrics.nextCursor === null && pagesProcessed > 0) {
      const completedAt = new Date();
      const missingCount = await markCompletedSweepMissing(
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
    metrics.push(sourceMetrics);
  }

  const done = remaining === 0 && completedSweeps.length === FREE_BOARD_SOURCES.length;
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
      upserted,
      errors,
      done,
      remaining,
      completedSweeps,
      sources: metrics,
    },
  });

  return {
    selected,
    upserted,
    errors,
    done,
    remaining,
    durationMs,
    metrics: { sources: metrics, completedSweeps },
  };
}
