import cron from "node-cron";
import { randomUUID } from "node:crypto";
import {
  db,
  sponsorLicenceCompanySiteChecksTable,
} from "@workspace/db";
import * as dbSchema from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  discoverCompanySiteVacancies,
  persistCompanySiteVacancies,
  type CompanySiteDiscoveryDiagnostics,
} from "./companySiteDiscovery";
import { parseDirectBoardMapping } from "./directEmployerBoardConnectors";
import {
  classifyCompanySiteFailure,
  COMPANY_SITE_EMPLOYER_BUDGET_MS,
  type CompanySiteFailureClass,
} from "./companySiteHttp";
import { withCompanySiteDatabaseRetry } from "./companySitePersistence";
import {
  COMPANY_SITE_PROBE_BATCH_SIZE,
  COMPANY_SITE_PROBE_OK_RECHECK_MS,
  runCompanySiteProbeBatch,
  type CompanySiteProbeSummary,
} from "./companySiteProbe";
import { regionsFromLocationText } from "./regionMatching";

export const COMPANY_SITE_DISCOVERY_CRON = "17 * * * *";
export const COMPANY_SITE_DISCOVERY_BATCH_SIZE = 10;
export const COMPANY_SITE_DISCOVERY_CONCURRENCY = 8;
export const COMPANY_SITE_GENERIC_TTL_MS = 48 * 60 * 60 * 1000;
export const COMPANY_SITE_ATS_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_FAILED_RETRY_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_PARTIAL_RETRY_MS = 15 * 60 * 1000;
export const COMPANY_SITE_PERMANENT_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
export const COMPANY_SITE_HEALTHCARE_EVIDENCE_RESERVE = 2;
export const COMPANY_SITE_HEALTHCARE_EVIDENCE_RETRY_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_BOOKMARK_SHARE = 0.25;
export const COMPANY_SITE_UNPROBED_SHARE = 0.6;
export const COMPANY_SITE_SECTOR_COUNT = 8;
export const COMPANY_SITE_BATCH_WRITE_RESERVE_MS = 3_000;

export type CompanySiteBatchRow = {
  id: number;
  organisationName: string;
  website: string;
  industry?: string | null;
  genericCheckedAt: Date | null;
  atsCheckedAt: Date | null;
  careersUrl: string | null;
  atsMappingEvidenceUrl?: string | null;
  atsProvider: string | null;
  atsBoardId?: string | null;
  atsMappingStatus?: "verified" | "unverified" | "invalid" | null;
  bookmarked: boolean;
  healthcareEvidenceBackfill: boolean;
  lastOutcome: string | null;
  probeStatus: "ok_for_crawl" | "bad" | "unknown";
  lastProbedAt: Date | null;
  probeReason: string | null;
  crawlState?: {
    queue: string[];
    visited: string[];
    sitemapQueued?: boolean;
    careersUrl?: string | null;
    atsProvider?: string | null;
  } | null;
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
      failureClass: CompanySiteFailureClass | null;
      completion: "complete" | "partial_page_limit" | "partial_deadline" | "failed";
      advertsRejected: number;
      rawAdvertsFound: number;
      ukLocationKnown: number;
      ukLocationUnknown: number;
      careersUrl: string | null;
      atsProvider: string | null;
      repeatImport?: { inserted: number; updated: number; revived: number };
      diagnostics?: CompanySiteDiscoveryDiagnostics;
    };

export type CompanySiteEmployerRunMetric = {
  organisationName: string;
  industry: string | null;
  sourceUrl: string;
  careersUrl: string | null;
  atsProvider: string | null;
  status: "checked" | "skipped" | "error";
  completion: "complete" | "partial_page_limit" | "partial_deadline" | "failed" | null;
  failureClass: CompanySiteFailureClass | null;
  reason: string | null;
  elapsedMs: number;
  pagesFetched: number;
  rawAdvertsFound: number;
  acceptedAdverts: number;
  inserted: number;
  updated: number;
  revived: number;
  advertsRejected: number;
  ukLocationKnown: number;
  ukLocationUnknown: number;
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
  permanentFailures: number;
  temporaryFailures: number;
  probeApproved: number;
  probeUnprobedSelected: number;
  probeUnknownSkipped: number;
  probeBadSkipped: number;
  employerMetrics?: CompanySiteEmployerRunMetric[];
};

let batchInProgress = false;

function getBatchSize(): number {
  const raw = Number.parseInt(process.env["COMPANY_SITE_DISCOVERY_BATCH_SIZE"] ?? "", 10);
  return Number.isFinite(raw) && raw >= 1 && raw <= COMPANY_SITE_DISCOVERY_BATCH_SIZE
    ? raw
    : COMPANY_SITE_DISCOVERY_BATCH_SIZE;
}

type CompanySiteProbeSelection = "ok_for_crawl" | "unprobed";

async function selectCompanySiteBatchForProbeStatus(
  batchSize: number,
  selection: CompanySiteProbeSelection,
): Promise<CompanySiteBatchRow[]> {
  const bookmarkLimit = Math.floor(batchSize * COMPANY_SITE_BOOKMARK_SHARE);
  const guaranteedOldestSlots = batchSize - bookmarkLimit;
  const genericCutoff = new Date(Date.now() - COMPANY_SITE_GENERIC_TTL_MS);
  const atsCutoff = new Date(Date.now() - COMPANY_SITE_ATS_TTL_MS);
  const healthcareEvidenceCutoff = new Date(
    Date.now() - COMPANY_SITE_HEALTHCARE_EVIDENCE_RETRY_MS,
  );
  const probeFilter = selection === "ok_for_crawl"
    ? sql`COALESCE(cs.probe_status, 'unknown') = 'ok_for_crawl'`
    : sql`COALESCE(cs.probe_status, 'unknown') = 'unknown'`;
  const result = await db.execute<{
    id: number;
    organisation_name: string;
    website: string;
    industry: string | null;
    generic_checked_at: Date | null;
    ats_checked_at: Date | null;
    careers_url: string | null;
    ats_mapping_evidence_url: string | null;
    ats_provider: string | null;
    ats_mapping_status: "verified" | "unverified" | null;
    last_outcome: string | null;
    probe_status: "ok_for_crawl" | "bad" | "unknown" | null;
    last_probed_at: Date | null;
    probe_reason: string | null;
    crawl_state: CompanySiteBatchRow["crawlState"];
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
        cs.ats_mapping_evidence_url,
        cs.ats_provider,
        cs.ats_mapping_status,
        cs.last_attempted_at,
        cs.last_outcome,
        cs.probe_status,
        cs.last_probed_at,
        cs.probe_reason,
        cs.crawl_state,
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
        AND ${probeFilter}
        AND (cs.retry_after IS NULL OR cs.retry_after <= NOW())
        AND (cs.crawl_lease_until IS NULL OR cs.crawl_lease_until <= NOW())
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
        CASE
          WHEN last_outcome = 'ok_for_crawl' THEN 0
          WHEN last_outcome IN ('complete', 'partial_page_limit', 'partial_deadline') THEN 1
          WHEN last_outcome IS NULL THEN 2
          ELSE 3
        END,
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
              CASE
                WHEN last_outcome = 'ok_for_crawl' THEN 0
                WHEN last_outcome IN ('complete', 'partial_page_limit', 'partial_deadline') THEN 1
                WHEN last_outcome IS NULL THEN 2
                ELSE 3
              END,
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
        ats_mapping_evidence_url,
        ats_provider,
        ats_mapping_status,
        last_attempted_at,
        last_outcome,
        probe_status,
        last_probed_at,
        probe_reason,
        crawl_state,
        bookmarked,
        healthcare_evidence_backfill
      FROM ranked_unbookmarked
      ORDER BY
        CASE
          WHEN last_outcome = 'ok_for_crawl' THEN 0
          WHEN last_outcome IN ('complete', 'partial_page_limit', 'partial_deadline') THEN 1
          WHEN last_outcome IS NULL THEN 2
          ELSE 3
        END,
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
        CASE
          WHEN last_outcome = 'ok_for_crawl' THEN 0
          WHEN last_outcome IN ('complete', 'partial_page_limit', 'partial_deadline') THEN 1
          WHEN last_outcome IS NULL THEN 2
          ELSE 3
        END,
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
  return (result?.rows ?? []).map((row) => ({
    id: Number(row.id),
    organisationName: row.organisation_name,
    website: row.website,
    industry: row.industry ?? null,
    genericCheckedAt: row.generic_checked_at ? new Date(row.generic_checked_at) : null,
    atsCheckedAt: row.ats_checked_at ? new Date(row.ats_checked_at) : null,
    careersUrl: row.careers_url,
    atsMappingEvidenceUrl: row.ats_mapping_evidence_url ?? null,
    atsProvider: row.ats_provider,
    atsMappingStatus: row.ats_mapping_status === "verified" ? "verified" : "unverified",
    bookmarked: row.bookmarked,
    healthcareEvidenceBackfill: row.healthcare_evidence_backfill,
    lastOutcome: row.last_outcome,
    probeStatus: row.probe_status ?? "unknown",
    lastProbedAt: row.last_probed_at ? new Date(row.last_probed_at) : null,
    probeReason: row.probe_reason,
    crawlState: row.crawl_state ?? null,
  }));
}

export async function selectCompanySiteBatch(
  batchSize = getBatchSize(),
): Promise<CompanySiteBatchRow[]> {
  const requested = Math.max(1, Math.floor(batchSize));
  const approvedRows = await selectCompanySiteBatchForProbeStatus(requested, "ok_for_crawl");
  if (approvedRows.length >= requested) return approvedRows;

  // Keep a meaningful approved refresh queue when it exists, while reserving
  // roughly 60% of a short batch for employers never successfully probed.
  // If no approved rows exist, use the whole batch to drain the unprobed queue.
  const unprobedReserve = Math.ceil(requested * COMPANY_SITE_UNPROBED_SHARE);
  const approvedTarget = Math.min(
    approvedRows.length,
    requested > 1 ? Math.max(1, requested - unprobedReserve) : requested,
  );
  const unprobedLimit = requested - approvedTarget;
  const approvedIds = new Set(approvedRows.map((row) => row.id));
  const unprobedRows = (await selectCompanySiteBatchForProbeStatus(
    unprobedLimit,
    "unprobed",
  )).filter((row) => !approvedIds.has(row.id));

  const selected = [
    ...approvedRows.slice(0, approvedTarget),
    ...unprobedRows,
  ];
  if (selected.length < requested) {
    selected.push(...approvedRows.slice(approvedTarget));
  }
  return selected.slice(0, requested);
}

async function selectCompanySiteProbeSkipStats(): Promise<{
  unknown: number;
  bad: number;
}> {
  const result = await db.execute<{
    unknown_count: number | string;
    bad_count: number | string;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(cs.probe_status, 'unknown') = 'unknown'
      ) AS unknown_count,
      COUNT(*) FILTER (
        WHERE cs.probe_status = 'bad'
          AND cs.retry_after > NOW()
          AND cs.probe_reason NOT ILIKE '%no careers or approved ATS signal%'
          AND cs.probe_reason NOT ILIKE '%buffer larger%'
          AND cs.probe_reason NOT ILIKE '%compressed response exceeded%'
          AND cs.probe_reason NOT ILIKE '%response size%'
      ) AS bad_count
    FROM (
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.organisation_name
      FROM sponsor_licences sl
      WHERE sl.website IS NOT NULL
        AND trim(sl.website) <> ''
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
    ) AS employers
    LEFT JOIN sponsor_licence_company_site_checks cs
      ON cs.organisation_name = employers.organisation_name
  `);
  const row = result?.rows?.[0];
  return {
    unknown: Number(row?.unknown_count ?? 0),
    bad: Number(row?.bad_count ?? 0),
  };
}

export async function selectCompanySiteProbeBatch(
  batchSize = COMPANY_SITE_PROBE_BATCH_SIZE,
): Promise<{
  rows: Array<{
    organisationName: string;
    website: string;
    previousProbeStatus: "ok_for_crawl" | "bad" | "unknown" | null;
  }>;
  hasMore: boolean;
}> {
  const result = await db.execute<{
    organisation_name: string;
    website: string;
    probe_status: "ok_for_crawl" | "bad" | "unknown" | null;
    last_probed_at: Date | null;
    last_outcome: string | null;
    last_attempted_at: Date | null;
  }>(sql`
    WITH candidate_pool AS (
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.organisation_name,
        trim(sl.website) AS website,
        cs.probe_status,
        cs.probe_reason,
        cs.last_probed_at,
        cs.last_outcome,
        cs.last_attempted_at
      FROM sponsor_licences sl
      LEFT JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE sl.website IS NOT NULL
        AND trim(sl.website) <> ''
        AND (
          cs.retry_after IS NULL
          OR cs.retry_after <= NOW()
          OR (
            cs.probe_status = 'bad'
            AND (
              cs.probe_reason ILIKE '%no careers or approved ATS signal%'
              OR cs.probe_reason ILIKE '%buffer larger%'
              OR cs.probe_reason ILIKE '%compressed response exceeded%'
              OR cs.probe_reason ILIKE '%response size%'
            )
          )
        )
        AND (
          COALESCE(cs.probe_status, 'unknown') = 'unknown'
          OR (
            cs.probe_status = 'ok_for_crawl'
            AND (
              cs.last_probed_at IS NULL
              OR cs.last_probed_at < NOW() - ${COMPANY_SITE_PROBE_OK_RECHECK_MS} * INTERVAL '1 millisecond'
            )
          )
          OR cs.probe_status = 'bad'
        )
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
    )
    SELECT organisation_name, website, probe_status, last_probed_at, last_outcome, last_attempted_at
    FROM candidate_pool
    ORDER BY
      CASE
        WHEN probe_status = 'bad' AND (
          probe_reason ILIKE '%no careers or approved ATS signal%'
          OR probe_reason ILIKE '%buffer larger%'
          OR probe_reason ILIKE '%compressed response exceeded%'
          OR probe_reason ILIKE '%response size%'
        ) THEN 0
        WHEN COALESCE(probe_status, 'unknown') = 'unknown' THEN 1
        ELSE 2
      END,
      last_probed_at ASC NULLS FIRST,
      last_attempted_at ASC NULLS FIRST,
      lower(btrim(organisation_name))
    LIMIT ${Math.max(1, Math.min(batchSize, COMPANY_SITE_PROBE_BATCH_SIZE)) + 1}
  `);
  const limit = Math.max(1, Math.min(batchSize, COMPANY_SITE_PROBE_BATCH_SIZE));
  return {
    rows: result.rows.slice(0, limit).map((row) => ({
      organisationName: row.organisation_name,
      website: row.website,
      previousProbeStatus: row.probe_status,
    })),
    hasMore: result.rows.length > limit,
  };
}

function isDue(value: Date | null, ttlMs: number): boolean {
  return !value || value.getTime() < Date.now() - ttlMs;
}

export async function runCompanySiteCheck(
  row: Pick<
    CompanySiteBatchRow,
    "organisationName" | "website" | "genericCheckedAt" | "atsCheckedAt" | "careersUrl" | "atsMappingEvidenceUrl" | "atsProvider" | "atsBoardId" | "atsMappingStatus" | "crawlState"
  >,
  options: {
    deadlineMs?: number;
    acquireLease?: boolean;
    preserveExistingSiteMetadata?: boolean;
    queueVerifications?: boolean;
    verifyImportIdempotency?: boolean;
    directFeedsOnly?: boolean;
    expectNoInserts?: boolean;
  } = {},
): Promise<CompanySiteCheckOutcome> {
  if (!row.website.trim()) return { status: "skipped", reason: "no website" };
  if (
    options.directFeedsOnly &&
    (row.atsMappingStatus !== "verified" || !row.careersUrl)
  ) {
    return { status: "skipped", reason: "no_direct_feed_source" };
  }
  const checkGeneric = isDue(row.genericCheckedAt, COMPANY_SITE_GENERIC_TTL_MS);
  const checkAts =
    row.atsProvider !== null &&
    isDue(row.atsCheckedAt, COMPANY_SITE_ATS_TTL_MS);
  if (!options.directFeedsOnly && !checkGeneric && !checkAts) {
    return { status: "skipped", reason: "fresh cache" };
  }
  const leaseToken = randomUUID();
  const leaseUntil = new Date(Date.now() + Math.max(COMPANY_SITE_EMPLOYER_BUDGET_MS, 30_000));
  const leaseResult = options.acquireLease !== true || process.env.NODE_ENV === "test"
    ? null
    : await db.execute(sql`
    INSERT INTO sponsor_licence_company_site_checks
      (organisation_name, crawl_lease_until, crawl_lease_token, updated_at)
    VALUES (${row.organisationName}, ${leaseUntil}, ${leaseToken}, NOW())
    ON CONFLICT (organisation_name) DO UPDATE
    SET crawl_lease_until = EXCLUDED.crawl_lease_until,
        crawl_lease_token = EXCLUDED.crawl_lease_token,
        updated_at = NOW()
    WHERE sponsor_licence_company_site_checks.crawl_lease_until IS NULL
       OR sponsor_licence_company_site_checks.crawl_lease_until <= NOW()
    RETURNING organisation_name
  `);
  if (leaseResult?.rows && leaseResult.rows.length === 0) {
    return { status: "skipped", reason: "crawl already leased" };
  }
  const leaseAcquired = leaseResult !== null;

  let result;
  try {
    result = await discoverCompanySiteVacancies(row.organisationName, row.website, {
      knownCareersUrl: row.careersUrl,
      knownCareersEvidenceUrl: row.atsMappingEvidenceUrl ?? null,
      knownAtsBoardId: row.atsBoardId,
      knownCareersMappingVerified: row.atsMappingStatus === "verified",
      checkGeneric: options.directFeedsOnly ? false : checkGeneric,
      checkAts: options.directFeedsOnly ? true : checkAts || checkGeneric,
      directFeedsOnly: options.directFeedsOnly,
      deadlineMs: options.deadlineMs,
      resumeState: options.directFeedsOnly ? null : row.crawlState,
    });
  } catch (error) {
    const now = new Date();
    const errorMessage = error instanceof Error ? error.message.slice(0, 1_000) : "discovery failed";
    const failureClass = classifyCompanySiteFailure({
      kind: "network",
      reason: errorMessage,
    });
    const retryAfter = new Date(
      now.getTime() +
        (failureClass === "permanent"
          ? COMPANY_SITE_PERMANENT_RETRY_MS
          : COMPANY_SITE_FAILED_RETRY_MS),
    );
    await withCompanySiteDatabaseRetry("store failed employer check", () =>
      db.insert(sponsorLicenceCompanySiteChecksTable)
        .values({
          organisationName: row.organisationName,
          retryAfter,
          lastAttemptedAt: now,
          lastOutcome: "failed",
          lastError: `[${failureClass}] ${errorMessage}`,
          updatedAt: now,
          crawlLeaseUntil: null,
          crawlLeaseToken: null,
        })
        .onConflictDoUpdate({
          target: sponsorLicenceCompanySiteChecksTable.organisationName,
          set: {
            retryAfter,
            lastAttemptedAt: now,
            lastOutcome: "failed",
            lastError: `[${failureClass}] ${errorMessage}`,
            updatedAt: now,
              crawlLeaseUntil: null,
              crawlLeaseToken: null,
          },
            ...(leaseAcquired
              ? { where: sql`${sponsorLicenceCompanySiteChecksTable.crawlLeaseToken} = ${leaseToken}` }
              : {}),
        }));
    return {
      status: "checked",
      adverts: 0,
      inserted: 0,
      updated: 0,
      revived: 0,
      pagesFetched: 0,
      careersFound: 0,
      atsFound: 0,
      transientFailure: failureClass === "temporary",
      failureClass,
      completion: "failed",
      advertsRejected: 0,
      rawAdvertsFound: 0,
      ukLocationKnown: 0,
      ukLocationUnknown: 0,
      careersUrl: row.careersUrl,
      atsProvider: row.atsProvider,
    };
  }
  if (options.directFeedsOnly) {
    const allowedEvidenceKinds = new Set([
      "known_ats_posting",
      "json_ld_job_posting",
      "microdata_job_posting",
    ]);
    const invalidAdvert = result.adverts.find((advert) => {
      const evidenceKind = advert.companyVacancyEvidence?.kind;
      return advert.sourceType !== "company_site" || !allowedEvidenceKinds.has(evidenceKind ?? "");
    });
    if (invalidAdvert) {
      throw new Error(
        `Direct-feeds-only invariant failed before persistence: ${invalidAdvert.url} lacks approved ATS or schema.org evidence.`,
      );
    }
    if (result.diagnostics.directFeedSkipReason) {
      return { status: "skipped", reason: result.diagnostics.directFeedSkipReason };
    }
  }
  const persisted =
    result.adverts.length > 0
      ? await persistCompanySiteVacancies(result.adverts, {
          queueVerifications: options.queueVerifications,
          ...(options.expectNoInserts ? { requireExisting: true } : {}),
        })
      : { inserted: 0, updated: 0, revived: 0 };
  const repeatImport =
    options.verifyImportIdempotency && result.adverts.length > 0
      ? await persistCompanySiteVacancies(result.adverts, {
          queueVerifications: false,
          ...(options.expectNoInserts ? { requireExisting: true } : {}),
        })
      : undefined;
  // A generic crawl is not a complete inventory of every careers source used by
  // an employer. Only retire postings from the exact board of an authoritative,
  // complete direct-feed snapshot; partial feeds must never retire anything.
  if (result.completion === "complete" && result.snapshotScope) {
    const { provider, boardId } = result.snapshotScope;
    const escapedBoardId = boardId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boardPattern = provider === "Ashby"
      ? `^https://jobs[.]ashbyhq[.]com/${escapedBoardId}/`
      : provider === "Greenhouse"
        ? `^https://(boards|job-boards)([.]eu)?[.]greenhouse[.]io/${escapedBoardId}/`
        : provider === "Lever"
          ? `^https://jobs([.]eu)?[.]lever[.]co/${escapedBoardId}/`
          : provider === "SmartRecruiters"
            ? `^https://jobs[.]smartrecruiters[.]com/${escapedBoardId}/`
            : provider === "Recruitee"
              ? `^https://${escapedBoardId}[.]recruitee[.]com/`
              : provider === "Personio"
                ? `^https://${escapedBoardId}[.]jobs[.]personio[.](de|com)/`
                : null;
    if (boardPattern) await db.execute(sql`
      UPDATE sponsor_licence_vacancies
      SET source_missing_since = COALESCE(source_missing_since, NOW()),
          source_missing_observations = COALESCE(source_missing_observations, 0) + 1
      WHERE lower(btrim(organisation_name)) = lower(btrim(${row.organisationName}))
        AND source_type = 'company_site'
        AND url ~* ${boardPattern}
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
  const failureClass: CompanySiteFailureClass | null =
    completion === "complete"
      ? null
      : result.failureClass ??
        (completion === "failed"
          ? result.transientFailure
            ? "temporary"
            : "permanent"
          : "temporary");
  const failedRetryFloor = new Date(now.getTime() + COMPANY_SITE_FAILED_RETRY_MS);
  const permanentRetryFloor = new Date(now.getTime() + COMPANY_SITE_PERMANENT_RETRY_MS);
  const retryAfter =
    failureClass === "permanent"
      ? result.retryAt && result.retryAt > permanentRetryFloor
        ? result.retryAt
        : permanentRetryFloor
      : completion === "failed"
        ? result.retryAt && result.retryAt > failedRetryFloor
          ? result.retryAt
          : failedRetryFloor
        : completion.startsWith("partial")
          ? result.retryAt ?? new Date(now.getTime() + COMPANY_SITE_PARTIAL_RETRY_MS)
          : result.transientFailure
            ? result.retryAt ?? new Date(now.getTime() + COMPANY_SITE_PARTIAL_RETRY_MS)
            : null;
  const [existing] = await withCompanySiteDatabaseRetry("read employer check", () =>
    db
      .select()
      .from(sponsorLicenceCompanySiteChecksTable)
      .where(eq(sponsorLicenceCompanySiteChecksTable.organisationName, row.organisationName))
      .limit(1));
  const preserveVerifiedAts =
    options.preserveExistingSiteMetadata === true &&
    existing?.atsMappingStatus === "verified";
  const preserveExistingCareers =
    options.preserveExistingSiteMetadata === true &&
    Boolean(existing?.careersUrl) &&
    result.atsMappingVerified !== true;
  const ukLocationKnown = result.adverts.filter((advert) =>
    (advert.targetRegions?.length ?? 0) > 0 ||
    regionsFromLocationText(advert.location).length > 0 ||
    /\b(?:united kingdom|u\.?k\.?|great britain|england|scotland|wales|northern ireland)\b/i.test(
      advert.location ?? "",
    ),
  ).length;

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
    careersUrl:
      preserveVerifiedAts || preserveExistingCareers
        ? existing?.careersUrl ?? null
        : result.careersUrl ?? existing?.careersUrl ?? null,
    atsProvider:
      preserveVerifiedAts
        ? existing?.atsProvider ?? null
        : result.atsProvider ?? existing?.atsProvider ?? null,
    ...(() => {
      const evidenceUrl =
        result.atsMappingVerified === true && !preserveVerifiedAts
          ? result.careersUrl ?? existing?.careersUrl ?? null
          : existing?.atsMappingStatus === "verified"
            ? existing.careersUrl ?? null
            : result.careersUrl ?? existing?.careersUrl ?? null;
      const provider =
        preserveVerifiedAts
          ? existing.atsProvider ?? null
          : result.atsProvider ?? existing?.atsProvider ?? null;
      const mapping = result.atsMappingVerified === true && !preserveVerifiedAts
        ? parseDirectBoardMapping(provider, evidenceUrl)
        : null;
      return mapping
        ? {
            atsBoardId: mapping.boardId,
            atsMappingEvidenceUrl:
              result.atsMappingEvidenceUrl ?? existing?.atsMappingEvidenceUrl ?? mapping.evidenceUrl,
            atsMappingStatus: "verified" as const,
          }
        : {
            atsBoardId: existing?.atsBoardId ?? null,
            atsMappingEvidenceUrl: existing?.atsMappingEvidenceUrl ?? null,
            atsMappingStatus: existing?.atsMappingStatus ?? "unverified" as const,
          };
    })(),
    retryAfter,
    lastError: result.error
      ? `${failureClass ? `[${failureClass}] ` : ""}${result.error}`.slice(0, 1_000)
      : null,
    lastAttemptedAt: now,
    lastCompletedAt: completion === "complete" ? now : existing?.lastCompletedAt ?? null,
    lastPartialAt: completion.startsWith("partial") ? now : existing?.lastPartialAt ?? null,
    lastOutcome: completion,
    lastPagesFetched: result.pagesFetched,
    lastAdvertsFound: result.advertsExtracted,
    lastRejectedCount: result.advertsRejected,
    crawlState: result.completion === "complete" ? null : result.resumeState ?? row.crawlState ?? null,
    crawlLeaseUntil: null,
    crawlLeaseToken: null,
    updatedAt: now,
  };
  await withCompanySiteDatabaseRetry("store employer check", () =>
    db
      .insert(sponsorLicenceCompanySiteChecksTable)
      .values(values)
      .onConflictDoUpdate({
        target: sponsorLicenceCompanySiteChecksTable.organisationName,
        set: values,
        ...(leaseAcquired
          ? { where: sql`${sponsorLicenceCompanySiteChecksTable.crawlLeaseToken} = ${leaseToken}` }
          : {}),
      }));

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
    failureClass,
    completion,
    advertsRejected: result.advertsRejected,
    rawAdvertsFound: result.advertsExtracted,
    ukLocationKnown,
    ukLocationUnknown: Math.max(0, result.adverts.length - ukLocationKnown),
    careersUrl: result.careersUrl,
    atsProvider: result.atsProvider,
    repeatImport,
    diagnostics: result.diagnostics,
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
    const probeSkipStats = await selectCompanySiteProbeSkipStats();
    const probeApproved = rows.filter((row) => row.probeStatus === "ok_for_crawl").length;
    const probeUnprobedSelected = rows.filter(
      (row) => row.probeStatus === "unknown" && row.lastProbedAt === null,
    ).length;
    console.log(
      `[company-site-scheduler] Starting hourly batch size=${rows.length} concurrency=${COMPANY_SITE_DISCOVERY_CONCURRENCY} probe_selected_ok=${probeApproved} probe_selected_unprobed=${probeUnprobedSelected} probe_skipped_bad=${probeSkipStats.bad} probe_unknown_skipped=${probeSkipStats.unknown}`,
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
    let permanentFailures = 0;
    let temporaryFailures = 0;
    let nextIndex = 0;
    const captureEmployerMetrics =
      process.env["COMPANY_SITE_PILOT_TELEMETRY"] === "1";
    const employerMetrics: CompanySiteEmployerRunMetric[] = [];

    async function worker(): Promise<void> {
      while (true) {
        if (workDeadlineMs != null && Date.now() >= workDeadlineMs) {
          deferred += Math.max(0, rows.length - nextIndex);
          nextIndex = rows.length;
          return;
        }
        const row = rows[nextIndex++];
        if (!row) return;
        const employerStartedAt = Date.now();
        try {
          const outcome = await runCompanySiteCheck(row, {
            deadlineMs: workDeadlineMs,
            acquireLease: true,
          });
          if (captureEmployerMetrics) {
            employerMetrics.push({
              organisationName: row.organisationName,
              industry: row.industry ?? null,
              sourceUrl: row.website,
              careersUrl:
                outcome.status === "checked"
                  ? outcome.careersUrl ?? row.careersUrl
                  : row.careersUrl,
              atsProvider:
                outcome.status === "checked"
                  ? outcome.atsProvider ?? row.atsProvider
                  : row.atsProvider,
              status: outcome.status,
              completion: outcome.status === "checked" ? outcome.completion : null,
              failureClass: outcome.status === "checked" ? outcome.failureClass : null,
              reason:
                outcome.status === "skipped"
                  ? outcome.reason
                  : outcome.status === "checked" &&
                      (outcome.completion !== "complete" || outcome.failureClass)
                    ? outcome.failureClass ?? outcome.completion
                    : null,
              elapsedMs: Date.now() - employerStartedAt,
              pagesFetched: outcome.status === "checked" ? outcome.pagesFetched : 0,
              rawAdvertsFound:
                outcome.status === "checked" ? outcome.rawAdvertsFound : 0,
              acceptedAdverts: outcome.status === "checked" ? outcome.adverts : 0,
              inserted: outcome.status === "checked" ? outcome.inserted : 0,
              updated: outcome.status === "checked" ? outcome.updated : 0,
              revived: outcome.status === "checked" ? outcome.revived : 0,
              advertsRejected:
                outcome.status === "checked" ? outcome.advertsRejected : 0,
              ukLocationKnown:
                outcome.status === "checked" ? outcome.ukLocationKnown : 0,
              ukLocationUnknown:
                outcome.status === "checked" ? outcome.ukLocationUnknown : 0,
            });
          }
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
            const failureClass =
              outcome.failureClass ??
              (completion === "complete" ? null : "temporary");
            if (failureClass === "permanent") permanentFailures += 1;
            if (failureClass === "temporary") temporaryFailures += 1;
            inserted += outcome.inserted;
            updated += outcome.updated;
            revived += outcome.revived;
          }
        } catch (error) {
          errors += 1;
          temporaryFailures += 1;
          if (captureEmployerMetrics) {
            employerMetrics.push({
              organisationName: row.organisationName,
              industry: row.industry ?? null,
              sourceUrl: row.website,
              careersUrl: row.careersUrl,
              atsProvider: row.atsProvider,
              status: "error",
              completion: "failed",
              failureClass: "temporary",
              reason: "unexpected employer-check exception",
              elapsedMs: Date.now() - employerStartedAt,
              pagesFetched: 0,
              rawAdvertsFound: 0,
              acceptedAdverts: 0,
              inserted: 0,
              updated: 0,
              revived: 0,
              advertsRejected: 0,
              ukLocationKnown: 0,
              ukLocationUnknown: 0,
            });
          }
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
    const upserted = inserted + updated + revived;
    const remaining = errors + deferred + (hasMore ? 1 : 0);
    const remainingIsLowerBound = hasMore;
    const done = remaining === 0;
    const remainingLog = remainingIsLowerBound ? `>=${remaining}` : String(remaining);
    console.log(
      `[company-site-scheduler] Complete selected=${rows.length} checked=${checked} skipped=${skipped} upserted=${upserted} errors=${errors} done=${done} remaining=${remainingLog} adverts=${adverts} inserted=${inserted} duration_ms=${durationMs} probe_selected_ok=${probeApproved} probe_selected_unprobed=${probeUnprobedSelected} probe_skipped_bad=${probeSkipStats.bad} probe_unknown_skipped=${probeSkipStats.unknown}`,
    );
    console.log(
      `[company-site-scheduler] Failures permanent=${permanentFailures} temporary=${temporaryFailures}`,
    );
    console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=company_site selected=${rows.length} upserted=${upserted} probe_selected_ok=${probeApproved} probe_selected_unprobed=${probeUnprobedSelected} probe_skipped_bad=${probeSkipStats.bad} probe_unknown_skipped=${probeSkipStats.unknown} live=0 dead=0 inconclusive=0 errors=${errors} permanent_failures=${permanentFailures} temporary_failures=${temporaryFailures} done=${done} remaining=${remainingLog} duration_ms=${durationMs}`);
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
      permanentFailures,
      temporaryFailures,
      probeApproved,
      probeUnprobedSelected,
      probeUnknownSkipped: probeSkipStats.unknown,
      probeBadSkipped: probeSkipStats.bad,
      checked,
      skipped,
      errors,
      upserted,
      done,
      remaining,
      remainingIsLowerBound,
      durationMs,
      ...(captureEmployerMetrics ? { employerMetrics } : {}),
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

export async function runCompanySiteProbeDiscoveryBatch(
  options: { batchSize?: number; deadlineMs?: number } = {},
): Promise<CompanySiteProbeSummary | null> {
  if (batchInProgress) {
    console.log("[company-site-probe] Previous batch still running — skipping this tick");
    return null;
  }
  batchInProgress = true;
  try {
    const batchSize = Math.max(
      1,
      Math.min(Math.floor(options.batchSize ?? COMPANY_SITE_PROBE_BATCH_SIZE), COMPANY_SITE_PROBE_BATCH_SIZE),
    );
    const selected = await selectCompanySiteProbeBatch(batchSize);
    const summary = await runCompanySiteProbeBatch(selected.rows, {
      deadlineMs: options.deadlineMs,
      hasMore: selected.hasMore,
    });
    console.log(
      `[company-site-probe] Complete selected=${summary.selected} checked=${summary.checked} ok_for_crawl=${summary.okForCrawl} ok_for_crawl_new=${summary.okForCrawlNew} unknown=${summary.unknown} bad_new=${summary.badNew} temporary_bad=${summary.temporaryBad} permanent_bad=${summary.permanentBad} skipped=${summary.skipped} errors=${summary.errors} duration_ms=${summary.durationMs}`,
    );
    const metrics = { ...summary };
    const syncLogTable = dbSchema.vacancySyncLogTable;
    await db.insert(syncLogTable).values({
      status: summary.errors > 0 ? "error" : "success",
      batchSize: summary.selected,
      checkedCount: summary.checked,
      errorCount: summary.errors,
      durationMs: summary.durationMs,
      triggeredBy: "scheduler",
      jobKind: "company_site_probe",
      metrics,
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