import cron from "node-cron";
import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { checkDestinationDead } from "./linkHealth";
import { isBlockedVacancyUrl } from "./vacancyUrlPolicy";

/**
 * Background liveness sweep over stored AI-discovered sponsor vacancies.
 *
 * Re-checks stored vacancy URLs using the same dead-link detection as the
 * click-time checker (HTTP 404/410/5xx + expiration-phrase scan), marks
 * failures dead with a recorded reason, and stamps last_verified_at so the
 * click-time check can skip recently verified URLs.
 *
 * Politeness: URLs are grouped per hostname and each domain's URLs are
 * checked sequentially with a delay between requests; only a modest number
 * of domains are checked concurrently.
 */

const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000; // re-verify at most twice a day
const BATCH_LIMIT = 200;
const DOMAIN_CONCURRENCY = 4;
const PER_DOMAIN_DELAY_MS = 1500;
const SWEEP_TIMEOUT_MS = 8000; // background sweep can afford a longer fetch than click-time

type SweepRow = { id: number; organisation_name: string; url: string };

let sweepRunning = false;

/**
 * Select stored vacancies due for a liveness check:
 * - has a URL, not already dead
 * - never verified, or verified longer than the stale threshold ago
 * - bookmarked employers first, then oldest-verified first
 */
async function selectSweepBatch(limit: number): Promise<SweepRow[]> {
  const result = await db.execute<SweepRow>(sql`
    SELECT v.id, v.organisation_name, v.url
    FROM sponsor_licence_vacancies v
    LEFT JOIN sponsor_licences sl ON sl.organisation_name = v.organisation_name
    LEFT JOIN (
      SELECT DISTINCT sponsor_licence_id FROM sponsor_licence_bookmarks
    ) b ON b.sponsor_licence_id = sl.id
    WHERE v.url IS NOT NULL
      AND v.liveness <> 'dead'
      AND (v.last_verified_at IS NULL OR v.last_verified_at < NOW() - make_interval(secs => ${STALE_THRESHOLD_MS / 1000}))
    ORDER BY
      CASE WHEN b.sponsor_licence_id IS NOT NULL THEN 0 ELSE 1 END ASC,
      v.last_verified_at ASC NULLS FIRST,
      v.id ASC
    LIMIT ${limit}
  `);
  return result.rows;
}

async function verifyOne(row: SweepRow): Promise<"live" | "dead" | "inconclusive"> {
  // Aggregator/blocked URLs shouldn't be stored, but never sweep them if present.
  if (isBlockedVacancyUrl(row.url)) return "inconclusive";
  try {
    const result = await checkDestinationDead(row.url, { timeoutMs: SWEEP_TIMEOUT_MS });
    if (result.verdict === "dead") {
      await db
        .update(sponsorLicenceVacanciesTable)
        .set({ liveness: "dead", lastVerifiedAt: new Date(), livenessReason: result.reason.slice(0, 500) })
        .where(eq(sponsorLicenceVacanciesTable.id, row.id));
      return "dead";
    }
    if (result.verdict === "unsafe") {
      // Not a legitimate employer destination — treat as dead so candidates never see it.
      await db
        .update(sponsorLicenceVacanciesTable)
        .set({ liveness: "dead", lastVerifiedAt: new Date(), livenessReason: result.reason.slice(0, 500) })
        .where(eq(sponsorLicenceVacanciesTable.id, row.id));
      return "dead";
    }
    await db
      .update(sponsorLicenceVacanciesTable)
      .set({ liveness: "live", lastVerifiedAt: new Date(), livenessReason: null })
      .where(eq(sponsorLicenceVacanciesTable.id, row.id));
    return "live";
  } catch {
    // Timeout / network / bot-block — inconclusive. Stamp last_verified_at so
    // the sweep doesn't hot-loop on the same unreachable URL, but keep status.
    await db
      .update(sponsorLicenceVacanciesTable)
      .set({ lastVerifiedAt: new Date() })
      .where(eq(sponsorLicenceVacanciesTable.id, row.id))
      .catch(() => {});
    return "inconclusive";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runVacancyLivenessSweep(): Promise<{ checked: number; live: number; dead: number; inconclusive: number } | null> {
  if (sweepRunning) {
    console.log("[vacancy-liveness] Sweep already running — skipping");
    return null;
  }
  sweepRunning = true;
  const startMs = Date.now();
  try {
    const rows = await selectSweepBatch(BATCH_LIMIT);
    if (rows.length === 0) {
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
        await db
          .update(sponsorLicenceVacanciesTable)
          .set({ liveness: "dead", lastVerifiedAt: new Date(), livenessReason: "malformed URL" })
          .where(eq(sponsorLicenceVacanciesTable.id, row.id))
          .catch(() => {});
        continue;
      }
      const list = byDomain.get(host) ?? [];
      list.push(row);
      byDomain.set(host, list);
    }

    const counters = { checked: 0, live: 0, dead: 0, inconclusive: 0 };
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
      Array.from({ length: Math.min(DOMAIN_CONCURRENCY, domainQueues.length) }, () => worker()),
    );

    console.log(
      `[vacancy-liveness] Sweep complete — checked: ${counters.checked}, live: ${counters.live}, dead: ${counters.dead}, inconclusive: ${counters.inconclusive}, ${Date.now() - startMs}ms`,
    );
    return counters;
  } finally {
    sweepRunning = false;
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
      });
    },
    { timezone: "Europe/London" },
  );
  console.log("[vacancy-liveness] Scheduler registered: every 6 hours at 01:30, 07:30, 13:30, 19:30 Europe/London");
}
