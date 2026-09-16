import cron from "node-cron";
import {
  db,
  sponsorLicenceCompanySiteChecksTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  discoverCompanySiteVacancies,
  persistCompanySiteVacancies,
} from "./companySiteDiscovery";

export const COMPANY_SITE_DISCOVERY_CRON = "17 * * * *";
export const COMPANY_SITE_DISCOVERY_BATCH_SIZE = 100;
export const COMPANY_SITE_DISCOVERY_CONCURRENCY = 8;
export const COMPANY_SITE_GENERIC_TTL_MS = 48 * 60 * 60 * 1000;
export const COMPANY_SITE_ATS_TTL_MS = 24 * 60 * 60 * 1000;
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
};

export type CompanySiteCheckOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "checked";
      adverts: number;
      inserted: number;
      revived: number;
      pagesFetched: number;
      transientFailure: boolean;
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
};

let batchInProgress = false;

function getBatchSize(): number {
  const raw = Number.parseInt(process.env["COMPANY_SITE_DISCOVERY_BATCH_SIZE"] ?? "", 10);
  return Number.isFinite(raw) && raw >= 75 && raw <= 100
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
  const result = await db.execute<{
    id: number;
    organisation_name: string;
    website: string;
    generic_checked_at: Date | null;
    ats_checked_at: Date | null;
    careers_url: string | null;
    ats_provider: string | null;
    bookmarked: boolean;
  }>(sql`
    WITH eligible AS (
      SELECT
        sl.id,
        sl.organisation_name,
        trim(sl.website) AS website,
        sl.industry,
        cs.generic_checked_at,
        cs.ats_checked_at,
        cs.careers_url,
        cs.ats_provider,
        EXISTS (
          SELECT 1
          FROM sponsor_licence_bookmarks b
          WHERE b.sponsor_licence_id = sl.id
        ) AS bookmarked
      FROM sponsor_licences sl
      LEFT JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE sl.website IS NOT NULL
        AND trim(sl.website) <> ''
        AND (cs.retry_after IS NULL OR cs.retry_after <= NOW())
        AND (
          cs.generic_checked_at IS NULL
          OR cs.generic_checked_at < ${genericCutoff}
          OR (
            cs.ats_provider IS NOT NULL
            AND (cs.ats_checked_at IS NULL OR cs.ats_checked_at < ${atsCutoff})
          )
        )
    ),
    priority_bookmarks AS (
      SELECT *
      FROM eligible
      WHERE bookmarked = true
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
        bookmarked
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
      LIMIT ${guaranteedOldestSlots}
    ),
    overflow AS (
      SELECT eligible.*
      FROM eligible
      WHERE NOT EXISTS (
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
      )
    )
    SELECT * FROM rotated_unbookmarked
    UNION ALL
    SELECT * FROM priority_bookmarks
    UNION ALL
    SELECT * FROM overflow
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

  const result = await discoverCompanySiteVacancies(row.organisationName, row.website, {
    knownCareersUrl: row.careersUrl,
    checkGeneric,
    checkAts: checkAts || checkGeneric,
    deadlineMs: options.deadlineMs,
  });
  const persisted =
    result.adverts.length > 0
      ? await persistCompanySiteVacancies(result.adverts)
      : { inserted: 0, revived: 0 };
  const now = new Date();
  const retryAfter = result.transientFailure
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
      result.genericCompleted || (checkGeneric && !result.transientFailure)
        ? now
        : existing?.genericCheckedAt ?? null,
    atsCheckedAt:
      result.atsCompleted || (checkAts && !result.transientFailure)
        ? now
        : existing?.atsCheckedAt ?? null,
    careersUrl: result.careersUrl ?? existing?.careersUrl ?? null,
    atsProvider: result.atsProvider ?? existing?.atsProvider ?? null,
    retryAfter,
    lastError: result.error?.slice(0, 1_000) ?? null,
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
    revived: persisted.revived,
    pagesFetched: result.pagesFetched,
    transientFailure: result.transientFailure,
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
    let deferred = 0;
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
            inserted += outcome.inserted;
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
    return {
      selected: rows.length,
      checked,
      skipped,
      errors,
      upserted,
      done,
      remaining,
      remainingIsLowerBound,
      durationMs,
    };
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