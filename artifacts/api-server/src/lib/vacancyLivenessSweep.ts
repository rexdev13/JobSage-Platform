import cron from "node-cron";
import { db, sponsorLicenceVacanciesTable, rolesTable, jobListingsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { checkDestinationDead } from "./linkHealth";
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

const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000; // re-verify at most twice a day
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

export type SweepCounters = { checked: number; live: number; dead: number; inconclusive: number };

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
    SELECT * FROM (
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
    ) all_links
    ORDER BY
      CASE WHEN last_verified_at IS NULL THEN 0 ELSE 1 END,
      CASE WHEN source_type IN ('job_board', 'company_site') THEN 0 ELSE 1 END,
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

async function verifyOne(row: SweepRow): Promise<"live" | "dead" | "inconclusive"> {
  if (row.source === "sponsor_vacancy" && row.sourceType === "company_site") {
    const outcome = await verifyCompanySiteStoredLink(row.id, row.url);
    return outcome === "live" || outcome === "dead" ? outcome : "inconclusive";
  }
  try {
    const result = await checkDestinationDead(row.url, { timeoutMs: SWEEP_TIMEOUT_MS });
    if (result.verdict === "dead" || result.verdict === "unsafe") {
      // "unsafe" = not a legitimate employer destination — treat as dead so
      // candidates never see it.
      await markResult(row, "dead", result.reason);
      return "dead";
    }
    await markResult(row, "live", null);
    return "live";
  } catch {
    // Timeout / network / bot-block — inconclusive. Stamp last_verified_at so
    // the sweep doesn't hot-loop on the same unreachable URL, but keep status.
    const table = tableFor(row.source);
    await db
      .update(table)
      .set({ lastVerifiedAt: new Date() })
      .where(
        row.source === "sponsor_vacancy"
          ? eq(sponsorLicenceVacanciesTable.url, row.url)
          : eq(table.id, row.id),
      )
      .catch(() => {});
    return "inconclusive";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runVacancyLivenessSweep(
  options: { staleThresholdMs?: number; batchLimit?: number; domainConcurrency?: number } = {},
): Promise<SweepCounters | null> {
  if (sweepRunning) {
    console.log("[vacancy-liveness] Sweep already running — skipping");
    return null;
  }
  sweepRunning = true;
  const startMs = Date.now();
  try {
    const rawRows = await selectSweepBatch(
      options.batchLimit ?? VACANCY_LIVENESS_BATCH_LIMIT,
      options.staleThresholdMs ?? STALE_THRESHOLD_MS,
    );
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
        await db
          .update(table)
          .set({ lastVerifiedAt: now, livenessReason: "aggregator domain — not verifiable" })
          .where(
            source === "sponsor_vacancy"
              ? inArray(sponsorLicenceVacanciesTable.url, group.map((g) => g.url))
              : inArray(table.id, group.map((g) => g.id)),
          )
          .catch(() => {});
      }
      console.log(`[vacancy-liveness] Bulk-stamped ${blocked.length} unverifiable aggregator links`);
    }

    if (rows.length === 0 && blocked.length === 0) {
      console.log("[vacancy-liveness] Nothing stale to verify");
      return { checked: 0, live: 0, dead: 0, inconclusive: 0 };
    }

    // Group per domain for politeness.
    const byDomain = new Map<string, SweepRow[]>();
    for (const row of rows) {
      let host: string;
      try {
        host = new URL(row.url).hostname.toLowerCase();
      } catch {
        // Malformed stored URL — mark dead with a reason.
        await markResult(row, "dead", "malformed URL").catch(() => {});
        continue;
      }
      const list = byDomain.get(host) ?? [];
      list.push(row);
      byDomain.set(host, list);
    }

    const counters: SweepCounters = { checked: blocked.length, live: 0, dead: 0, inconclusive: blocked.length };
    const domainQueues = [...byDomain.values()];
    let nextIdx = 0;

    async function worker(): Promise<void> {
      while (true) {
        const idx = nextIdx++;
        const queue = domainQueues[idx];
        if (!queue) return;
        for (let i = 0; i < queue.length; i++) {
          const outcome = await verifyOne(queue[i]!);
          counters.checked++;
          counters[outcome === "live" ? "live" : outcome === "dead" ? "dead" : "inconclusive"]++;
          if (i < queue.length - 1) await sleep(PER_DOMAIN_DELAY_MS);
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(options.domainConcurrency ?? VACANCY_LIVENESS_DOMAIN_CONCURRENCY, domainQueues.length) },
        () => worker(),
      ),
    );

    console.log(
      `[vacancy-liveness] Sweep complete — checked: ${counters.checked}, live: ${counters.live}, dead: ${counters.dead}, inconclusive: ${counters.inconclusive}, ${Date.now() - startMs}ms`,
    );
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
  // On startup: if the last successful sweep is overdue (> 7 h ago — meaning at
  // least one scheduled 6-hour tick was missed, e.g. due to a dev-server
  // restart or a deploy), kick off an immediate sweep rather than waiting for
  // the next scheduled tick. This keeps the deployed environment self-healing
  // even after restarts during active development.
  (async () => {
    try {
      const result = await db.execute<{ most_recent: string | null }>(sql`
        SELECT MAX(t.lva)::text AS most_recent FROM (
          SELECT MAX(last_verified_at) AS lva FROM sponsor_licence_vacancies
          UNION ALL
          SELECT MAX(last_verified_at) FROM roles
          UNION ALL
          SELECT MAX(last_verified_at) FROM job_listings
        ) t
      `);
      const raw = result.rows[0]?.most_recent ?? null;
      const OVERDUE_MS = 7 * 60 * 60 * 1000; // 7 h — at least one 6-hour tick missed
      const ageMs = raw ? Date.now() - new Date(raw).getTime() : Infinity;
      if (ageMs > OVERDUE_MS) {
        const hoursAgo = (ageMs / 3_600_000).toFixed(1);
        console.log(`[vacancy-liveness] Sweep overdue (last ran ${hoursAgo}h ago) — starting immediate startup sweep`);
        runVacancyLivenessSweep().catch((err) => {
          console.error("[vacancy-liveness] Startup sweep error:", err);
        });
      } else {
        const minsAgo = (ageMs / 60_000).toFixed(0);
        console.log(`[vacancy-liveness] Sweep is recent (${minsAgo}m ago) — no startup kickoff needed`);
      }
    } catch (err) {
      console.error("[vacancy-liveness] Startup overdue-check failed:", err);
    }
  })();

  // Every 6 hours, offset from the AI vacancy-check batches (06/14/22) so the
  // sweep verifies the snapshots those batches produce.
  cron.schedule(
    "30 1,7,13,19 * * *",
    () => {
      runVacancyLivenessSweep().catch((err) => {
        console.error("[vacancy-liveness] Unhandled sweep error:", err);
      });
    },
    { timezone: "Europe/London" },
  );
  console.log("[vacancy-liveness] Scheduler registered: every 6 hours at 01:30, 07:30, 13:30, 19:30 Europe/London");
}
