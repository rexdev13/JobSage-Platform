import cron from "node-cron";
import {
  db,
  sponsorLicenceCompanySiteChecksTable,
} from "@workspace/db";
import * as dbSchema from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  discoverCompanySiteVacancies,
  persistCompanySiteVacancies,
} from "./companySiteDiscovery";

export const COMPANY_SITE_DISCOVERY_CRON = "17 * * * *";
export const COMPANY_SITE_DISCOVERY_BATCH_SIZE = 10;
export const COMPANY_SITE_DISCOVERY_CONCURRENCY = 8;
export const COMPANY_SITE_GENERIC_TTL_MS = 48 * 60 * 60 * 1000;
export const COMPANY_SITE_ATS_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_FAILED_RETRY_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_PARTIAL_RETRY_MS = 15 * 60 * 1000;
export const COMPANY_SITE_HEALTHCARE_EVIDENCE_RESERVE = 2;
export const COMPANY_SITE_HEALTHCARE_EVIDENCE_RETRY_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_BOOKMARK_SHARE = 0.25;
export const COMPANY_SITE_SECTOR_COUNT = 8;
export const COMPANY_SITE_BATCH_WRITE_RESERVE_MS = 3_000;

export type CompanySiteBatchRow = {
  id: number;
  organisationName: string;
  website: string;
  genericCheckedAt: Date | null;
  atsCheckedAt: Date | null;
  careersUrl: string | null;
  atsProvider: string | null;
  bookmarked: boolean;
  healthcareEvidenceBackfill: boolean;
};

export type CompanySiteCheckOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "checked";
      adverts: number;
      inserted: number;
      updated: number;
      revived: number;
      pagesFetched: number;
      careersFound: number;
      atsFound: number;
      transientFailure: boolean;
      completion: "complete" | "partial_page_limit" | "partial_deadline" | "failed";
      advertsRejected: number;
    };

export type CompanySiteBatchSummary = {
  selected: number;
  checked: number;
  skipped: number;
  errors: number;
  upserted: number;
  done: boolean;
  remaining: number;
  remainingIsLowerBound: boolean;
  durationMs: number;
  attempted: number;
  completed: number;
  partial: number;
  failed: number;
  empty: number;
  careersFound: number;
  atsFound: number;
  pagesFetched: number;
  advertsExtracted: number;
  advertsRejected: number;
  inserted: number;
  updated: number;
  revived: number;
};

let batchInProgress = false;

function getBatchSize(): number {
  const raw = Number.parseInt(process.env["COMPANY_SITE_DISCOVERY_BATCH_SIZE"] ?? "", 10);
  return Number.isFinite(raw) && raw >= 1 && raw <= COMPANY_SITE_DISCOVERY_BATCH_SIZE
    ? raw
    : COMPANY_SITE_DISCOVERY_BATCH_SIZE;
}

export async function selectCompanySiteBatch(
  batchSize = getBatchSize(),
): Promise<CompanySiteBatchRow[]> {
  const bookmarkLimit = Math.floor(batchSize * COMPANY_SITE_BOOKMARK_SHARE);
  const guaranteedOldestSlots = batchSize - bookmarkLimit;
  const genericCutoff = new Date(Date.now() - COMPANY_SITE_GENERIC_TTL_MS);
  const atsCutoff = new Date(Date.now() - COMPANY_SITE_ATS_TTL_MS);
  const healthcareEvidenceCutoff = new Date(
    Date.now() - COMPANY_SITE_HEALTHCARE_EVIDENCE_RETRY_MS,
  );
  const result = await db.execute<{
    id: number;
    organisation_name: string;
    website: string;
    generic_checked_at: Date | null;
    ats_checked_at: Date | null;
    careers_url: string | null;
    ats_provider: string | null;
    bookmarked: boolean;
    healthcare_evidence_backfill: boolean;
  }>(sql`
    WITH candidate_pool AS (
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.id,
        sl.organisation_name,
        trim(sl.website) AS website,
        sl.industry,
        cs.generic_checked_at,
        cs.ats_checked_at,
        cs.careers_url,
        cs.ats_provider,
        cs.last_attempted_at,
        EXISTS (
          SELECT 1
          FROM sponsor_licence_bookmarks b
          WHERE b.sponsor_licence_id = sl.id
        ) AS bookmarked,
        EXISTS (
          SELECT 1
          FROM sponsor_licence_vacancies v
          WHERE lower(btrim(v.organisation_name)) = lower(btrim(sl.organisation_name))
            AND v.source_type = 'company_site'
            AND v.liveness = 'live'
            AND v.url IS NOT NULL
            AND trim(v.url) <> ''
            AND v.company_vacancy_evidence IS NULL
            AND (
              v.company_evidence_legacy_until IS NULL
              OR v.company_evidence_legacy_until < NOW()
            )
            AND v.source_missing_since IS NULL
            AND COALESCE(v.source_missing_observations, 0) = 0
            AND (v.closes_at IS NULL OR v.closes_at >= NOW())
            AND (v.expires_at IS NULL OR v.expires_at >= NOW())
            AND (
              v.closed_reason IS NULL
              OR v.closed_reason !~* '(closed|filled|no longer accepting|closing date has passed)'
            )
            AND lower(v.title) ~
              '(^|[^a-z])(nurse|nurses|nursing|midwife|midwifery|doctor|physician|surgeon|registrar|general practitioner|medical officer|psychiatrist|psychiatric|anaesthetist|radiologist|cardiologist|paediatrician|oncologist|dermatologist|neurologist|specialty doctor|junior doctor)([^a-z]|$)'
        ) AS healthcare_evidence_backfill
      FROM sponsor_licences sl
      LEFT JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE sl.website IS NOT NULL
        AND trim(sl.website) <> ''
        AND (cs.retry_after IS NULL OR cs.retry_after <= NOW())
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
    ),
    eligible AS (
      SELECT *
      FROM candidate_pool
      WHERE (
          generic_checked_at IS NULL
          OR generic_checked_at < ${genericCutoff}
          OR (
            ats_provider IS NOT NULL
            AND (ats_checked_at IS NULL OR ats_checked_at < ${atsCutoff})
          )
          OR (
            healthcare_evidence_backfill = true
            AND (
              last_attempted_at IS NULL
              OR last_attempted_at < ${healthcareEvidenceCutoff}
            )
          )
        )
    ),
    priority_healthcare_evidence AS (
      SELECT *
      FROM eligible
      WHERE healthcare_evidence_backfill = true
      ORDER BY last_attempted_at ASC NULLS FIRST, id ASC
      LIMIT ${COMPANY_SITE_HEALTHCARE_EVIDENCE_RESERVE}
    ),
    priority_bookmarks AS (
      SELECT *
      FROM eligible
      WHERE bookmarked = true
        AND NOT EXISTS (
          SELECT 1 FROM priority_healthcare_evidence
          WHERE priority_healthcare_evidence.id = eligible.id
        )
      ORDER BY
        CASE WHEN generic_checked_at IS NULL THEN 0 ELSE 1 END,
        generic_checked_at ASC NULLS FIRST,
        ats_checked_at ASC NULLS FIRST,
        id ASC
      LIMIT ${bookmarkLimit}
    ),
    classified_unbookmarked AS (
      SELECT *
      FROM (
        SELECT
          eligible.*,
          CASE
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(health|hospital|medical|nursing|clinic|care|social care)([^a-z]|$)' THEN 0
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(education|school|university|college|academy|training|nursery)([^a-z]|$)' THEN 1
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(engineer|engineering|manufactur|construction|architect|technical)([^a-z]|$)' THEN 2
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(technology|software|information technology|digital|cyber|data|telecom)([^a-z]|$)' THEN 3
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(hospitality|hotel|restaurant|catering|leisure|tourism)([^a-z]|$)' THEN 4
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(retail|wholesale|shop|store|logistics|transport|warehouse|distribution|postal)([^a-z]|$)' THEN 5
            WHEN LOWER(COALESCE(industry, '')) ~ '(^|[^a-z])(finance|financial|account|legal|law|consult|marketing|property|real estate|estate agent|recruit)([^a-z]|$)' THEN 6
            ELSE 7
          END AS sector_order
        FROM eligible
        WHERE bookmarked = false
          AND NOT EXISTS (
            SELECT 1 FROM priority_healthcare_evidence
            WHERE priority_healthcare_evidence.id = eligible.id
          )
      ) AS classified
    ),
    ranked_unbookmarked AS (
      SELECT *
      FROM (
        SELECT
          classified.*,
          ROW_NUMBER() OVER (
            PARTITION BY sector_order
            ORDER BY
              CASE WHEN generic_checked_at IS NULL THEN 0 ELSE 1 END,
              generic_checked_at ASC NULLS FIRST,
              ats_checked_at ASC NULLS FIRST,
              id ASC
          ) AS sector_position
        FROM classified_unbookmarked AS classified
      ) AS ranked
    ),
    rotated_unbookmarked AS (
      SELECT
        id,
        organisation_name,
        website,
        industry,
        generic_checked_at,
        ats_checked_at,
        careers_url,
        ats_provider,
        last_attempted_at,
        bookmarked,
        healthcare_evidence_backfill
      FROM ranked_unbookmarked
      ORDER BY
        sector_position ASC,
        MOD(
          sector_order
          - MOD(
              FLOOR(EXTRACT(EPOCH FROM DATE_TRUNC('hour', NOW())) / 3600)::int,
              ${COMPANY_SITE_SECTOR_COUNT}
            )
          + ${COMPANY_SITE_SECTOR_COUNT},
          ${COMPANY_SITE_SECTOR_COUNT}
        ) ASC,
        CASE WHEN generic_checked_at IS NULL THEN 0 ELSE 1 END,
        generic_checked_at ASC NULLS FIRST,
        ats_checked_at ASC NULLS FIRST,
        id ASC
      LIMIT GREATEST(
        0,
        ${guaranteedOldestSlots}
          - (SELECT count(*) FROM priority_healthcare_evidence)
      )
    ),
    overflow AS (
      SELECT eligible.*
      FROM eligible
      WHERE NOT EXISTS (
        SELECT 1 FROM priority_healthcare_evidence
        WHERE priority_healthcare_evidence.id = eligible.id
      )
        AND NOT EXISTS (
        SELECT 1 FROM priority_bookmarks
        WHERE priority_bookmarks.id = eligible.id
      )
        AND NOT EXISTS (
          SELECT 1 FROM rotated_unbookmarked
          WHERE rotated_unbookmarked.id = eligible.id
        )
      ORDER BY
        CASE WHEN generic_checked_at IS NULL THEN 0 ELSE 1 END,
        generic_checked_at ASC NULLS FIRST,
        ats_checked_at ASC NULLS FIRST,
        id ASC
      LIMIT GREATEST(
        0,
        ${batchSize}
          - (SELECT count(*) FROM priority_bookmarks)
          - (SELECT count(*) FROM rotated_unbookmarked)
          - (SELECT count(*) FROM priority_healthcare_evidence)
      )
    )
    SELECT selected.*
    FROM (
      SELECT priority_healthcare_evidence.*, 0 AS selection_priority
      FROM priority_healthcare_evidence
      UNION ALL
      SELECT rotated_unbookmarked.*, 1 AS selection_priority
      FROM rotated_unbookmarked
      UNION ALL
      SELECT priority_bookmarks.*, 2 AS selection_priority
      FROM priority_bookmarks
      UNION ALL
      SELECT overflow.*, 3 AS selection_priority
      FROM overflow
    ) AS selected
    ORDER BY selected.selection_priority ASC
  `);
  return result.rows.map((row) => ({
    id: Number(row.id),
    organisationName: row.organisation_name,
    website: row.website,
    genericCheckedAt: row.generic_checked_at ? new Date(row.generic_checked_at) : null,
    atsCheckedAt: row.ats_checked_at ? new Date(row.ats_checked_at) : null,
    careersUrl: row.careers_url,
    atsProvider: row.ats_provider,
    bookmarked: row.bookmarked,
    healthcareEvidenceBackfill: row.healthcare_evidence_backfill,
  }));
}

function isDue(value: Date | null, ttlMs: number): boolean {
  return !value || value.getTime() < Date.now() - ttlMs;
}

export async function runCompanySiteCheck(
  row: Pick<
    CompanySiteBatchRow,
    "organisationName" | "website" | "genericCheckedAt" | "atsCheckedAt" | "careersUrl" | "atsProvider"
  >,
  options: { deadlineMs?: number } = {},
): Promise<CompanySiteCheckOutcome> {
  if (!row.website.trim()) return { status: "skipped", reason: "no website" };
  const checkGeneric = isDue(row.genericCheckedAt, COMPANY_SITE_GENERIC_TTL_MS);
  const checkAts =
    row.atsProvider !== null &&
    isDue(row.atsCheckedAt, COMPANY_SITE_ATS_TTL_MS);
  if (!checkGeneric && !checkAts) return { status: "skipped", reason: "fresh cache" };

  let result;
  try {
    result = await discoverCompanySiteVacancies(row.organisationName, row.website, {
      knownCareersUrl: row.careersUrl,
      checkGeneric,
      checkAts: checkAts || checkGeneric,
      deadlineMs: options.deadlineMs,
    });
  } catch (error) {
    const now = new Date();
    await db.insert(sponsorLicenceCompanySiteChecksTable)
      .values({
        organisationName: row.organisationName,
        lastAttemptedAt: now,
        lastOutcome: "failed",
        lastError: error instanceof Error ? error.message.slice(0, 1_000) : "discovery failed",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sponsorLicenceCompanySiteChecksTable.organisationName,
        set: {
          lastAttemptedAt: now,
          lastOutcome: "failed",
          lastError: error instanceof Error ? error.message.slice(0, 1_000) : "discovery failed",
          updatedAt: now,
        },
      });
    throw error;
  }
  const persisted =
    result.adverts.length > 0
      ? await persistCompanySiteVacancies(result.adverts)
      : { inserted: 0, updated: 0, revived: 0 };
  if (result.completion === "complete") {
    await db.execute(sql`
      UPDATE sponsor_licence_vacancies
      SET source_missing_since = COALESCE(source_missing_since, NOW()),
          source_missing_observations = COALESCE(source_missing_observations, 0) + 1
      WHERE lower(btrim(organisation_name)) = lower(btrim(${row.organisationName}))
        AND source_type = 'company_site'
        AND last_discovered_at < NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${JSON.stringify(result.observedAdvertUrls ?? result.adverts.map((advert) => advert.url))}::jsonb) AS current(url)
          WHERE lower(split_part(split_part(sponsor_licence_vacancies.url, '?', 1), '#', 1))
              = lower(split_part(split_part(current.url, '?', 1), '#', 1))
        )
    `);
  }
  const now = new Date();
  const completion = result.completion ??
    (result.transientFailure ? "failed" : "complete");
  const failedRetryFloor = new Date(now.getTime() + COMPANY_SITE_FAILED_RETRY_MS);
  const retryAfter = completion === "failed"
    ? result.retryAt && result.retryAt > failedRetryFloor
      ? result.retryAt
      : failedRetryFloor
    : completion.startsWith("partial")
      ? result.retryAt ?? new Date(now.getTime() + COMPANY_SITE_PARTIAL_RETRY_MS)
    : result.transientFailure
      ? result.retryAt ?? new Date(now.getTime() + 15 * 60 * 1000)
      : null;
  const [existing] = await db
    .select()
    .from(sponsorLicenceCompanySiteChecksTable)
    .where(eq(sponsorLicenceCompanySiteChecksTable.organisationName, row.organisationName))
    .limit(1);

  const values = {
    organisationName: row.organisationName,
    genericCheckedAt:
      completion === "complete" && (result.genericCompleted || checkGeneric)
        ? now
        : existing?.genericCheckedAt ?? null,
    atsCheckedAt:
      completion === "complete" && (result.atsCompleted || checkAts)
        ? now
        : existing?.atsCheckedAt ?? null,
    careersUrl: result.careersUrl ?? existing?.careersUrl ?? null,
    atsProvider: result.atsProvider ?? existing?.atsProvider ?? null,
    retryAfter,
    lastError: result.error?.slice(0, 1_000) ?? null,
    lastAttemptedAt: now,
    lastCompletedAt: completion === "complete" ? now : existing?.lastCompletedAt ?? null,
    lastPartialAt: completion.startsWith("partial") ? now : existing?.lastPartialAt ?? null,
    lastOutcome: completion,
    lastPagesFetched: result.pagesFetched,
    lastAdvertsFound: result.advertsExtracted,
    lastRejectedCount: result.advertsRejected,
    updatedAt: now,
  };
  await db
    .insert(sponsorLicenceCompanySiteChecksTable)
    .values(values)
    .onConflictDoUpdate({
      target: sponsorLicenceCompanySiteChecksTable.organisationName,
      set: values,
    });

  return {
    status: "checked",
    adverts: result.adverts.length,
    inserted: persisted.inserted,
    updated: persisted.updated,
    revived: persisted.revived,
    pagesFetched: result.pagesFetched,
    careersFound: result.careersUrl && !existing?.careersUrl ? 1 : 0,
    atsFound: result.atsProvider && !existing?.atsProvider ? 1 : 0,
    transientFailure: result.transientFailure,
    completion,
    advertsRejected: result.advertsRejected,
  };
}

export async function runCompanySiteDiscoveryBatch(
  options: { batchSize?: number; deadlineMs?: number } = {},
): Promise<CompanySiteBatchSummary | null> {
  if (batchInProgress) {
    console.log("[company-site-scheduler] Previous batch still running — skipping this tick");
    return null;
  }
  batchInProgress = true;
  const startedAt = Date.now();
  const workDeadlineMs = options.deadlineMs == null
    ? undefined
    : Math.max(startedAt, options.deadlineMs - COMPANY_SITE_BATCH_WRITE_RESERVE_MS);
  try {
    const batchSize = options.batchSize == null
      ? getBatchSize()
      : Math.max(1, Math.min(Math.floor(options.batchSize), COMPANY_SITE_DISCOVERY_BATCH_SIZE));
    // Fetch one extra candidate instead of running an expensive full queue
    // count after the batch. This keeps the HTTP response bounded while still
    // distinguishing an empty queue from resumable work.
    const candidates = await selectCompanySiteBatch(batchSize + 1);
    const rows = candidates.slice(0, batchSize);
    const hasMore = candidates.length > rows.length;
    console.log(
      `[company-site-scheduler] Starting hourly batch size=${rows.length} concurrency=${COMPANY_SITE_DISCOVERY_CONCURRENCY}`,
    );
    let checked = 0;
    let skipped = 0;
    let errors = 0;
    let adverts = 0;
    let inserted = 0;
    let revived = 0;
    let updated = 0;
    let deferred = 0;
    let partial = 0;
    let failed = 0;
    let empty = 0;
    let pagesFetched = 0;
    let advertsRejected = 0;
    let careersFound = 0;
    let atsFound = 0;
    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (true) {
        if (workDeadlineMs != null && Date.now() >= workDeadlineMs) {
          deferred += Math.max(0, rows.length - nextIndex);
          nextIndex = rows.length;
          return;
        }
        const row = rows[nextIndex++];
        if (!row) return;
        try {
          const outcome = await runCompanySiteCheck(row, {
            deadlineMs: workDeadlineMs,
          });
          if (outcome.status === "skipped") {
            skipped += 1;
          } else {
            checked += 1;
            adverts += outcome.adverts;
            pagesFetched += outcome.pagesFetched;
            advertsRejected += outcome.advertsRejected;
            careersFound += outcome.careersFound ?? 0;
            atsFound += outcome.atsFound ?? 0;
            const completion = outcome.completion ?? "complete";
            if (completion.startsWith("partial")) {
              partial += 1;
              errors += 1;
            }
            if (completion === "failed") {
              failed += 1;
              errors += 1;
            }
            if (completion === "complete" && outcome.adverts === 0) empty += 1;
            inserted += outcome.inserted;
            updated += outcome.updated;
            revived += outcome.revived;
          }
        } catch (error) {
          errors += 1;
          console.error(
            `[company-site-scheduler] Failed organisation="${row.organisationName}":`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(COMPANY_SITE_DISCOVERY_CONCURRENCY, rows.length) },
        () => worker(),
      ),
    );
    const durationMs = Date.now() - startedAt;
    const upserted = inserted + revived;
    const remaining = errors + deferred + (hasMore ? 1 : 0);
    const remainingIsLowerBound = hasMore;
    const done = remaining === 0;
    const remainingLog = remainingIsLowerBound ? `>=${remaining}` : String(remaining);
    console.log(
      `[company-site-scheduler] Complete selected=${rows.length} checked=${checked} skipped=${skipped} upserted=${upserted} errors=${errors} done=${done} remaining=${remainingLog} adverts=${adverts} inserted=${inserted} duration_ms=${durationMs}`,
    );
    console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=company_site selected=${rows.length} upserted=${upserted} live=0 dead=0 inconclusive=0 errors=${errors} done=${done} remaining=${remainingLog} duration_ms=${durationMs}`);
    const summary = {
      selected: rows.length,
      attempted: checked + errors,
      completed: checked - partial - failed,
      partial,
      failed,
      empty,
      careersFound,
      atsFound,
      pagesFetched,
      advertsExtracted: adverts,
      advertsRejected,
      inserted,
      updated,
      revived,
      checked,
      skipped,
      errors,
      upserted,
      done,
      remaining,
      remainingIsLowerBound,
      durationMs,
    };
    let syncLogTable: typeof dbSchema.vacancySyncLogTable | undefined;
    try {
      syncLogTable = dbSchema.vacancySyncLogTable;
    } catch {
      syncLogTable = undefined;
    }
    if (syncLogTable) await db.insert(syncLogTable).values({
      status: errors > 0 ? "error" : "success",
      batchSize: rows.length,
      checkedCount: checked,
      errorCount: errors,
      durationMs,
      triggeredBy: "scheduler",
      jobKind: "company_site",
      metrics: summary,
    });
    return summary;
  } finally {
    batchInProgress = false;
  }
}

export function startCompanySiteDiscoveryScheduler(): void {
  cron.schedule(
    COMPANY_SITE_DISCOVERY_CRON,
    () => {
      runCompanySiteDiscoveryBatch().catch((error) => {
        console.error("[company-site-scheduler] Unhandled batch error:", error);
        console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=company_site selected=0 upserted=0 live=0 dead=0 inconclusive=0 errors=1`);
      });
    },
    { timezone: "Europe/London" },
  );
  console.log(
    `[company-site-scheduler] Registered hourly at minute 17 Europe/London, batch size ${getBatchSize()}, concurrency ${COMPANY_SITE_DISCOVERY_CONCURRENCY}`,
  );
}