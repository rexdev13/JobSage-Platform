import cron from "node-cron";
import { db, sponsorLicenceVacanciesTable, rolesTable, jobListingsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { checkDestinationDead } from "./linkHealth";
import { verifyStoredLink } from "./linkVerification";
import { isBlockedVacancyUrl, isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";
import { verifyCompanySiteStoredLink } from "./companySiteVerification";

/**
 * Unified background liveness sweep over ALL stored job-application links:
 * - AI-discovered sponsor vacancies (sponsor_licence_vacancies.url)
 * - imported/standard roles (roles.apply_url)
 * - employer-posted job listings (job_listings.apply_url)
 *
 * Re-checks stored apply URLs using the same dead-link detection as the
 * click-time checker (HTTP 404/410/5xx + expiration-phrase scan), marks
 * failures dead with a recorded reason, and stamps last_verified_at so the
 * click-time check can skip recently verified URLs.
 *
 * Never-verified links are prioritised so newly ingested vacancies drain
 * out of the "unverified" backlog quickly.
 *
 * Politeness: URLs are grouped per hostname and each domain's URLs are
 * checked sequentially with a delay between requests; only a modest number
 * of domains are checked concurrently.
 */

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // re-verify within the UI freshness window
export const VACANCY_LIVENESS_BATCH_LIMIT = 600;
export const VACANCY_LIVENESS_DOMAIN_CONCURRENCY = 24;
const PER_DOMAIN_DELAY_MS = 1500;
const SWEEP_TIMEOUT_MS = 8000; // background sweep can afford a longer fetch than click-time

type SweepSource = "sponsor_vacancy" | "role" | "job_listing";
type SweepRow = {
  source: SweepSource;
  sourceType: "job_board" | "company_site" | null;
  id: number;
  url: string;
};
type SweepSqlRow = Omit<SweepRow, "sourceType"> & {
  source_type: "job_board" | "company_site" | null;
};

export type SweepCounters = {
  checked: number;
  live: number;
  dead: number;
  inconclusive: number;
  remaining?: number;
  remainingIsLowerBound?: boolean;
  deadlineStopped?: boolean;
};

class SweepDeadlineError extends Error {
  constructor() {
    super("Vacancy liveness sweep deadline reached");
  }
}

function remainingBudget(deadlineMs?: number): number {
  return deadlineMs ? Math.max(0, deadlineMs - Date.now()) : Number.POSITIVE_INFINITY;
}

async function withinDeadline<T>(
  promise: PromiseLike<T>,
  deadlineMs?: number,
): Promise<T> {
  const budget = remainingBudget(deadlineMs);
  if (!Number.isFinite(budget)) return await promise;
  if (budget <= 0) throw new SweepDeadlineError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SweepDeadlineError()), budget);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let sweepRunning = false;

/**
 * Select stored links due for a liveness check across all sources:
 * - has a URL, not already dead
 * - never verified, or verified longer than the threshold ago
 * - never-verified first, then oldest-verified first
 */
async function selectSweepBatch(limit: number, staleThresholdMs: number): Promise<SweepRow[]> {
  const staleSecs = staleThresholdMs / 1000;
  const result = await db.execute<SweepSqlRow>(sql`
    WITH all_links AS (
      SELECT 'sponsor_vacancy' AS source, v.source_type, v.id, v.url, v.last_verified_at
      FROM sponsor_licence_vacancies v
      WHERE v.url IS NOT NULL AND v.liveness <> 'dead'
        AND (v.last_verified_at IS NULL OR v.last_verified_at < NOW() - make_interval(secs => ${staleSecs}))
      UNION ALL
      SELECT 'role' AS source, NULL::text AS source_type, r.id, r.apply_url AS url, r.last_verified_at
      FROM roles r
      WHERE r.apply_url IS NOT NULL AND r.apply_url <> '' AND r.active = true AND r.liveness <> 'dead'
        AND (r.last_verified_at IS NULL OR r.last_verified_at < NOW() - make_interval(secs => ${staleSecs}))
      UNION ALL
      SELECT 'job_listing' AS source, NULL::text AS source_type, j.id, j.apply_url AS url, j.last_verified_at
      FROM job_listings j
      WHERE j.apply_url IS NOT NULL AND j.apply_url <> '' AND j.status = 'published' AND j.liveness <> 'dead'
        AND (j.last_verified_at IS NULL OR j.last_verified_at < NOW() - make_interval(secs => ${staleSecs}))
    ),
    ranked AS (
      SELECT
        all_links.*,
        CASE
          WHEN source_type = 'job_board' THEN 0
          WHEN source_type = 'company_site' THEN 1
          ELSE 2
        END AS source_priority,
        ROW_NUMBER() OVER (
          PARTITION BY CASE
            WHEN source_type = 'job_board' THEN 'job_board'
            WHEN source_type = 'company_site' THEN 'company_site'
            ELSE 'other'
          END
          ORDER BY
            CASE WHEN last_verified_at IS NULL THEN 0 ELSE 1 END,
            last_verified_at ASC NULLS FIRST,
            id ASC
        ) AS source_rank
      FROM all_links
    )
    SELECT source, source_type, id, url, last_verified_at
    FROM ranked
    ORDER BY
      source_rank ASC,
      source_priority ASC,
      last_verified_at ASC NULLS FIRST,
      id ASC
    LIMIT ${limit}
  `);
  return result.rows.map((r) => ({
    source: r.source,
    sourceType: r.source_type ?? null,
    id: Number(r.id),
    url: r.url,
  }));
}

function tableFor(source: SweepSource) {
  return source === "sponsor_vacancy" ? sponsorLicenceVacanciesTable : source === "role" ? rolesTable : jobListingsTable;
}

async function markResult(
  row: SweepRow,
  liveness: "live" | "dead",
  reason: string | null,
): Promise<void> {
  const table = tableFor(row.source);
  await db
    .update(table)
    .set({ liveness, lastVerifiedAt: new Date(), livenessReason: reason ? reason.slice(0, 500) : null })
    .where(
      // Sponsor vacancy snapshots repeat the same URL across check dates —
      // one verdict applies to every row sharing the URL.
      row.source === "sponsor_vacancy"
        ? eq(sponsorLicenceVacanciesTable.url, row.url)
        : eq(table.id, row.id),
    );
}

async function verifyOne(
  row: SweepRow,
  deadlineMs?: number,
): Promise<"live" | "dead" | "inconclusive"> {
  if (row.source === "sponsor_vacancy" && row.sourceType === "company_site") {
    const outcome = await withinDeadline(
      verifyCompanySiteStoredLink(row.id, row.url, deadlineMs),
      deadlineMs,
    );
    return outcome === "live" || outcome === "dead" ? outcome : "inconclusive";
  }
  try {
    if (row.source !== "sponsor_vacancy" || row.sourceType === "job_board") {
      const outcome = await withinDeadline(verifyStoredLink(row.source, row.id, row.url), deadlineMs);
      return outcome === "live" || outcome === "dead" ? outcome : "inconclusive";
    }
    const timeoutMs = Math.max(
      1,
      Math.min(SWEEP_TIMEOUT_MS, remainingBudget(deadlineMs)),
    );
    const result = await withinDeadline(
      checkDestinationDead(row.url, { timeoutMs }),
      deadlineMs,
    );
    if (result.verdict === "dead" || result.verdict === "unsafe") {
      // "unsafe" = not a legitimate employer destination — treat as dead so
      // candidates never see it.
      await withinDeadline(markResult(row, "dead", result.reason), deadlineMs);
      return "dead";
    }
    await withinDeadline(markResult(row, "live", null), deadlineMs);
    return "live";
  } catch (error) {
    if (error instanceof SweepDeadlineError) throw error;
    // Timeout / network / bot-block — inconclusive. Stamp last_verified_at so
    // the sweep doesn't hot-loop on the same unreachable URL, but keep status.
    const table = tableFor(row.source);
    try {
      await withinDeadline(
        db
          .update(table)
          .set({ lastVerifiedAt: new Date() })
          .where(
            row.source === "sponsor_vacancy"
              ? eq(sponsorLicenceVacanciesTable.url, row.url)
              : eq(table.id, row.id),
          ),
        deadlineMs,
      );
    } catch (writeError) {
      if (writeError instanceof SweepDeadlineError) throw writeError;
    }
    return "inconclusive";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runVacancyLivenessSweep(
  options: {
    staleThresholdMs?: number;
    batchLimit?: number;
    domainConcurrency?: number;
    deadlineMs?: number;
    onSelected?: (count: number) => void;
  } = {},
): Promise<SweepCounters | null> {
  if (sweepRunning) {
    console.log("[vacancy-liveness] Sweep already running — skipping");
    return null;
  }
  sweepRunning = true;
  const startMs = Date.now();
  try {
    const batchLimit = options.batchLimit ?? VACANCY_LIVENESS_BATCH_LIMIT;
    const rawRows = await withinDeadline(
      selectSweepBatch(
        batchLimit,
        options.staleThresholdMs ?? STALE_THRESHOLD_MS,
      ),
      options.deadlineMs,
    );
    options.onSelected?.(rawRows.length);
    // Dedupe within the batch: one check per (source, url) — markResult
    // propagates sponsor verdicts to every snapshot row sharing the URL.
    const seen = new Set<string>();
    const deduped = rawRows.filter((r) => {
      const key = `${r.source}\u0000${r.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Aggregator/blocked URLs (LinkedIn, Indeed, Reed, …) cannot be verified —
    // they bot-block automated checks. Bulk-stamp last_verified_at so the
    // sweep doesn't re-select them, keeping their liveness unchanged, and
    // skip the per-domain politeness delay entirely.
    const unverifiableBlocked = (row: SweepRow) =>
      row.sourceType !== "company_site" &&
      isBlockedVacancyUrl(row.url) &&
      !isValidJobBoardVacancyDeepLink(row.url);
    const blocked = deduped.filter(unverifiableBlocked);
    const rows = deduped.filter((r) => !unverifiableBlocked(r));
    if (blocked.length > 0) {
      const now = new Date();
      const bySource = new Map<SweepSource, SweepRow[]>();
      for (const b of blocked) {
        const list = bySource.get(b.source) ?? [];
        list.push(b);
        bySource.set(b.source, list);
      }
      for (const [source, group] of bySource) {
        const table = tableFor(source);
        await withinDeadline(
          db
            .update(table)
            .set({ lastVerifiedAt: now, livenessReason: "aggregator domain — not verifiable" })
            .where(
              source === "sponsor_vacancy"
                ? inArray(sponsorLicenceVacanciesTable.url, group.map((g) => g.url))
                : inArray(table.id, group.map((g) => g.id)),
            ),
          options.deadlineMs,
        ).catch((error) => {
          if (error instanceof SweepDeadlineError) throw error;
        });
      }
      console.log(`[vacancy-liveness] Bulk-stamped ${blocked.length} unverifiable aggregator links`);
    }

    if (rows.length === 0 && blocked.length === 0) {
      console.log("[vacancy-liveness] Nothing stale to verify");
      console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=liveness selected=0 upserted=0 live=0 dead=0 inconclusive=0 errors=0`);
      return { checked: 0, live: 0, dead: 0, inconclusive: 0, remaining: 0 };
    }

    // Group per domain for politeness.
    const byDomain = new Map<string, SweepRow[]>();
    for (const row of rows) {
      let host: string;
      try {
        host = new URL(row.url).hostname.toLowerCase();
      } catch {
        // Malformed stored URL — mark dead with a reason.
        await withinDeadline(
          markResult(row, "dead", "malformed URL"),
          options.deadlineMs,
        ).catch(() => {});
        continue;
      }
      const list = byDomain.get(host) ?? [];
      list.push(row);
      byDomain.set(host, list);
    }

    const counters: SweepCounters = { checked: blocked.length, live: 0, dead: 0, inconclusive: blocked.length };
    const domainQueues = [...byDomain.values()];
    let nextIdx = 0;
    const deadline = options.deadlineMs ?? 0;

    async function worker(): Promise<void> {
      while (true) {
        if (deadline && Date.now() >= deadline) return;
        const idx = nextIdx++;
        const queue = domainQueues[idx];
        if (!queue) return;
        for (let i = 0; i < queue.length; i++) {
          if (deadline && Date.now() >= deadline) return;
          let outcome: "live" | "dead" | "inconclusive";
          try {
            outcome = await verifyOne(queue[i]!, options.deadlineMs);
          } catch (error) {
            if (error instanceof SweepDeadlineError) return;
            throw error;
          }
          counters.checked++;
          counters[outcome === "live" ? "live" : outcome === "dead" ? "dead" : "inconclusive"]++;
          if (i < queue.length - 1) {
            const delay = Math.min(PER_DOMAIN_DELAY_MS, remainingBudget(options.deadlineMs));
            if (delay <= 0) return;
            await sleep(delay);
          }
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(options.domainConcurrency ?? VACANCY_LIVENESS_DOMAIN_CONCURRENCY, domainQueues.length) },
        () => worker(),
      ),
    );

    // Fast remaining-stale count so callers can monitor catch-up progress.
    const staleThresholdMs = options.staleThresholdMs ?? STALE_THRESHOLD_MS;
    const staleSecs = staleThresholdMs / 1000;
    let remaining: number | undefined;
    try {
      // The full scan controls completion by starting another selection batch;
      // avoid adding a redundant count query to that unchanged internal path.
      if (!options.deadlineMs && options.staleThresholdMs !== undefined) {
        throw new Error("remaining count not requested for full scan");
      }
      const countResult = await withinDeadline(db.execute<{ cnt: string }>(sql`
        SELECT COUNT(*) AS cnt FROM (
          SELECT 1 FROM sponsor_licence_vacancies v
          WHERE v.url IS NOT NULL AND v.liveness <> 'dead'
            AND (v.last_verified_at IS NULL OR v.last_verified_at < NOW() - make_interval(secs => ${staleSecs}))
          UNION ALL
          SELECT 1 FROM roles r
          WHERE r.apply_url IS NOT NULL AND r.apply_url <> '' AND r.active = true AND r.liveness <> 'dead'
            AND (r.last_verified_at IS NULL OR r.last_verified_at < NOW() - make_interval(secs => ${staleSecs}))
          UNION ALL
          SELECT 1 FROM job_listings j
          WHERE j.apply_url IS NOT NULL AND j.apply_url <> '' AND j.status = 'published' AND j.liveness <> 'dead'
            AND (j.last_verified_at IS NULL OR j.last_verified_at < NOW() - make_interval(secs => ${staleSecs}))
        ) stale
      `), options.deadlineMs);
      remaining = Number(countResult.rows[0]?.cnt ?? 0);
      counters.remaining = remaining;
    } catch {
      // Non-critical — don't fail the sweep if the count query errors.
    }

    const elapsed = Date.now() - startMs;
    const hitDeadline = Boolean(deadline && Date.now() >= deadline);
    if (remaining == null) {
      const deferredFromBatch = Math.max(0, deduped.length - counters.checked);
      counters.remaining = deferredFromBatch + (rawRows.length >= batchLimit ? 1 : 0);
      counters.remainingIsLowerBound = true;
    }
    counters.deadlineStopped = hitDeadline;
    console.log(
      `[vacancy-liveness] Sweep ${hitDeadline ? "deadline-stopped" : "complete"} — checked: ${counters.checked}, live: ${counters.live}, dead: ${counters.dead}, inconclusive: ${counters.inconclusive}${remaining != null ? `, remaining: ${remaining}` : ""}, ${elapsed}ms`,
    );
    console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=liveness selected=${rawRows.length} upserted=0 live=${counters.live} dead=${counters.dead} inconclusive=${counters.inconclusive} errors=0`);
    return counters;
  } finally {
    sweepRunning = false;
  }
}

// ── One-time full scan ────────────────────────────────────────────────────────

export type FullScanStatus = {
  isRunning: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totals: SweepCounters;
  batches: number;
  error: string | null;
};

const fullScanStatus: FullScanStatus = {
  isRunning: false,
  startedAt: null,
  finishedAt: null,
  totals: { checked: 0, live: 0, dead: 0, inconclusive: 0 },
  batches: 0,
  error: null,
};

export function getFullScanStatus(): FullScanStatus {
  return { ...fullScanStatus, totals: { ...fullScanStatus.totals } };
}

/**
 * Run repeated sweep batches until every non-dead link with a URL has been
 * checked in this scan (staleThreshold=0 forces re-verification of
 * everything, including recently verified and never-verified links).
 * Inconclusive links get their timestamp stamped, so the backlog always
 * drains and the loop terminates.
 */
export async function runFullLivenessScan(): Promise<SweepCounters> {
  if (fullScanStatus.isRunning) {
    throw new Error("A full link scan is already running.");
  }
  fullScanStatus.isRunning = true;
  fullScanStatus.startedAt = new Date().toISOString();
  fullScanStatus.finishedAt = null;
  fullScanStatus.error = null;
  fullScanStatus.batches = 0;
  fullScanStatus.totals = { checked: 0, live: 0, dead: 0, inconclusive: 0 };
  const scanStart = new Date();
  try {
    // staleThreshold measured against scan start: anything not yet touched in
    // this scan is due; anything the scan already stamped is skipped.
    while (true) {
      const elapsedMs = Date.now() - scanStart.getTime();
      const counters = await runVacancyLivenessSweep({
        staleThresholdMs: elapsedMs,
        batchLimit: 1000,
        domainConcurrency: 24,
      });
      if (!counters) {
        // periodic sweep grabbed the lock — wait and retry
        await sleep(5000);
        continue;
      }
      fullScanStatus.batches++;
      fullScanStatus.totals.checked += counters.checked;
      fullScanStatus.totals.live += counters.live;
      fullScanStatus.totals.dead += counters.dead;
      fullScanStatus.totals.inconclusive += counters.inconclusive;
      if (counters.checked === 0) break;
    }
    return { ...fullScanStatus.totals };
  } catch (err) {
    fullScanStatus.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    fullScanStatus.isRunning = false;
    fullScanStatus.finishedAt = new Date().toISOString();
  }
}

export function startVacancyLivenessSweepScheduler(): void {
  // Every 6 hours, offset from the AI vacancy-check batches (06/14/22) so the
  // sweep verifies the snapshots those batches produce.
  cron.schedule(
    "30 1,7,13,19 * * *",
    () => {
      runVacancyLivenessSweep().catch((err) => {
        console.error("[vacancy-liveness] Unhandled sweep error:", err);
        console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=liveness selected=0 upserted=0 live=0 dead=0 inconclusive=0 errors=1`);
      });
    },
    { timezone: "Europe/London" },
  );
  console.log("[vacancy-liveness] Scheduler registered: every 6 hours at 01:30, 07:30, 13:30, 19:30 Europe/London");
}
