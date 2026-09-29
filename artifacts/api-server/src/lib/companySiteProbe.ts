import {
  db,
  sponsorLicenceCompanySiteChecksTable,
} from "@workspace/db";
import {
  classifyCompanySiteFailure,
  fetchCompanySitePage,
  type CompanySiteFailureClass,
} from "./companySiteHttp";
import {
  inspectCompanySiteProbePage,
  normaliseSponsorWebsite,
} from "./companySiteDiscovery";
import { parseDirectBoardMapping } from "./directEmployerBoardConnectors";
import { withCompanySiteDatabaseRetry } from "./companySitePersistence";

export const COMPANY_SITE_PROBE_FAILED_RETRY_MS = 24 * 60 * 60 * 1000;
export const COMPANY_SITE_PROBE_UNKNOWN_RETRY_MS = 6 * 60 * 60 * 1000;
export const COMPANY_SITE_PROBE_PERMANENT_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
export const COMPANY_SITE_PROBE_OK_RECHECK_MS = 6 * 60 * 60 * 1000;
export const COMPANY_SITE_PROBE_BATCH_SIZE = 60;
export const COMPANY_SITE_PROBE_CONCURRENCY = 18;
export const COMPANY_SITE_PROBE_WRITE_RESERVE_MS = 3_000;
export const COMPANY_SITE_PROBE_HTTP_BUDGET_MS = 25_000;
// Match the full crawler's bounded page size. 128 KB rejected ordinary homepages.
export const COMPANY_SITE_PROBE_MAX_ROOT_BYTES = 1_000_000;

export type CompanySiteProbeRow = {
  organisationName: string;
  website: string;
  previousProbeStatus?: "ok_for_crawl" | "bad" | "unknown" | null;
};

export type CompanySiteProbeClassification =
  | "permanent_bad"
  | "temporary_bad"
  | "unknown"
  | "ok_for_crawl";

export type CompanySiteProbeOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "checked";
      classification: CompanySiteProbeClassification;
      failureClass: CompanySiteFailureClass | null;
    };

function retryAtFor(
  classification: CompanySiteProbeClassification,
  supplied: Date | undefined,
  now: Date,
): Date | null {
  if (classification === "ok_for_crawl") return null;
  if (classification === "unknown") {
    const floor = new Date(now.getTime() + COMPANY_SITE_PROBE_UNKNOWN_RETRY_MS);
    return supplied && supplied > floor ? supplied : floor;
  }
  const floor = new Date(
    now.getTime() +
      (classification === "permanent_bad"
        ? COMPANY_SITE_PROBE_PERMANENT_RETRY_MS
        : COMPANY_SITE_PROBE_FAILED_RETRY_MS),
  );
  return supplied && supplied > floor ? supplied : floor;
}

async function persistProbeOutcome(
  row: CompanySiteProbeRow,
  classification: CompanySiteProbeClassification,
  error: string | null,
  retryAt: Date | undefined,
  metadata: {
    careersUrl?: string | null;
    atsProvider?: string | null;
    reason?: string;
    atsMappingVerified?: boolean;
    atsMappingEvidenceUrl?: string | null;
  } = {},
): Promise<void> {
  const now = new Date();
  const retryAfter = retryAtFor(classification, retryAt, now);
  const mapping = metadata.atsMappingVerified
    ? parseDirectBoardMapping(metadata.atsProvider ?? null, metadata.careersUrl ?? null)
    : null;
  const probeStatus: "ok_for_crawl" | "bad" | "unknown" =
    classification === "ok_for_crawl"
      ? "ok_for_crawl"
      : classification === "unknown"
        ? "unknown"
        : "bad";
  const values = {
    organisationName: row.organisationName,
    retryAfter,
    lastError: error ? error.slice(0, 1_000) : null,
    lastOutcome: classification,
    probeStatus,
    lastProbedAt: now,
    probeReason:
      metadata.reason ?? error?.slice(0, 500) ??
      (classification === "ok_for_crawl"
        ? "root fetch and careers/ATS signal succeeded"
        : classification === "unknown"
          ? "probe inconclusive; retry scheduled"
          : "probe failed"),
    updatedAt: now,
    ...(metadata.careersUrl ? { careersUrl: metadata.careersUrl } : {}),
    ...(metadata.atsProvider ? { atsProvider: metadata.atsProvider } : {}),
    ...(mapping
      ? {
          atsBoardId: mapping.boardId,
          atsMappingEvidenceUrl: metadata.atsMappingEvidenceUrl ?? row.website,
          atsMappingStatus: "verified" as const,
        }
      : {}),
  };
  await withCompanySiteDatabaseRetry("store company-site probe", () =>
    db
      .insert(sponsorLicenceCompanySiteChecksTable)
      .values(values)
      .onConflictDoUpdate({
        target: sponsorLicenceCompanySiteChecksTable.organisationName,
        set: values,
      }),
  );
}

export async function runCompanySiteProbe(
  row: CompanySiteProbeRow,
  options: { deadlineMs?: number } = {},
): Promise<CompanySiteProbeOutcome> {
  const website = normaliseSponsorWebsite(row.website);
  if (!website) {
    await persistProbeOutcome(row, "permanent_bad", "malformed website URL", undefined);
    return {
      status: "checked",
      classification: "permanent_bad",
      failureClass: "permanent",
    };
  }
  const deadlineMs = options.deadlineMs ?? Date.now() + 9_000;
  let parsed: URL;
  try {
    parsed = new URL(website);
  } catch {
    await persistProbeOutcome(row, "permanent_bad", "malformed website URL", undefined);
    return {
      status: "checked",
      classification: "permanent_bad",
      failureClass: "permanent",
    };
  }

  let classification: CompanySiteProbeClassification;
  let failureClass: CompanySiteFailureClass | null;
  let errorMessage: string | null;
  let retryAt: Date | undefined;
  let metadata: { careersUrl?: string | null; atsProvider?: string | null; reason?: string } | undefined;
  try {
    // This deliberately performs exactly the shared robots-aware root fetch.
    // It does not parse links, follow vacancy pages, or write adverts.
    const result = await fetchCompanySitePage(
      parsed.toString(),
      parsed.hostname,
      deadlineMs,
      COMPANY_SITE_PROBE_MAX_ROOT_BYTES,
    );
    if (result.ok) {
      const inspection = inspectCompanySiteProbePage(result.url, result.body);
      if (!/html|text/i.test(result.contentType) && result.contentType !== "") {
        classification = "temporary_bad";
        failureClass = "temporary";
        errorMessage = "[temporary] root response is not HTML or text";
        retryAt = undefined;
      } else {
        // A safe reachable root without a careers signal may still expose
        // vacancies through its sitemap. Let bounded discovery decide.
        classification = "ok_for_crawl";
        failureClass = null;
        errorMessage = null;
        retryAt = undefined;
        metadata = inspection.hasCareersSignal
          ? inspection
          : { reason: "root reachable without careers/ATS signal; allow bounded discovery" };
      }
    } else {
      failureClass =
        result.failureClass ??
        classifyCompanySiteFailure(result);
      const sizeLimited = /(?:compressed response exceeded|buffer larger than|response (?:exceeded|too large)|(?:body|response) size)/i
        .test(result.reason);
      classification = sizeLimited
        ? "unknown"
        : failureClass === "permanent"
          ? "permanent_bad"
          : "temporary_bad";
      if (sizeLimited) failureClass = "temporary";
      errorMessage = `[${sizeLimited ? "unknown" : failureClass}] ${result.reason}`;
      retryAt = result.retryAt;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "probe failed";
    failureClass = classifyCompanySiteFailure({
      kind: "network",
      reason,
    });
    const sizeLimited = /(?:compressed response exceeded|buffer larger than|response (?:exceeded|too large)|(?:body|response) size)/i
      .test(reason);
    classification = sizeLimited
      ? "unknown"
      : failureClass === "permanent"
        ? "permanent_bad"
        : "temporary_bad";
    if (sizeLimited) failureClass = "temporary";
    errorMessage = `[${sizeLimited ? "unknown" : failureClass}] ${reason}`;
    retryAt = undefined;
  }
  // Persist outside the fetch try/catch: a database failure must remain a
  // batch error and must never reclassify a healthy website as temporary_bad.
  await persistProbeOutcome(row, classification, errorMessage, retryAt, metadata);
  return { status: "checked", classification, failureClass };
}

export type CompanySiteProbeSummary = {
  selected: number;
  checked: number;
  okForCrawl: number;
  okForCrawlNew: number;
  badNew: number;
  temporaryBad: number;
  permanentBad: number;
  unknown: number;
  skipped: number;
  deferred: number;
  errors: number;
  done: boolean;
  remaining: number;
  remainingIsLowerBound: boolean;
  durationMs: number;
};

export async function runCompanySiteProbeBatch(
  rows: CompanySiteProbeRow[],
  options: { deadlineMs?: number; hasMore?: boolean } = {},
): Promise<CompanySiteProbeSummary> {
  const startedAt = Date.now();
  const workDeadlineMs =
    options.deadlineMs == null
      ? undefined
      : Math.max(startedAt, options.deadlineMs - COMPANY_SITE_PROBE_WRITE_RESERVE_MS);
  let nextIndex = 0;
  let checked = 0;
  let okForCrawl = 0;
  let okForCrawlNew = 0;
  let badNew = 0;
  let temporaryBad = 0;
  let permanentBad = 0;
  let unknown = 0;
  let skipped = 0;
  let deferred = 0;
  let errors = 0;

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
        const outcome = await runCompanySiteProbe(row, { deadlineMs: workDeadlineMs });
        if (outcome.status === "skipped") skipped += 1;
        else {
          checked += 1;
          if (outcome.classification === "ok_for_crawl") {
            okForCrawl += 1;
            if (row.previousProbeStatus !== "ok_for_crawl") okForCrawlNew += 1;
          } else if (outcome.classification === "unknown") {
            unknown += 1;
          } else {
            if (row.previousProbeStatus !== "bad") badNew += 1;
            if (outcome.classification === "temporary_bad") temporaryBad += 1;
            else permanentBad += 1;
          }
        }
      } catch {
        errors += 1;
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(COMPANY_SITE_PROBE_CONCURRENCY, rows.length) },
      () => worker(),
    ),
  );
  const durationMs = Date.now() - startedAt;
  const remaining = deferred + (options.hasMore ? 1 : 0) + errors;
  return {
    selected: rows.length,
    checked,
    okForCrawl,
    okForCrawlNew,
    badNew,
    temporaryBad,
    permanentBad,
    unknown,
    skipped,
    deferred,
    errors,
    done: remaining === 0,
    remaining,
    remainingIsLowerBound: Boolean(options.hasMore),
    durationMs,
  };
}