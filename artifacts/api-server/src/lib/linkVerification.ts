import { db, rolesTable, jobListingsTable, sponsorLicenceVacanciesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkDestinationDead } from "./linkHealth";
import { isBlockedVacancyUrl, isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";

/**
 * Single-record apply-link verification, shared by:
 * - ingestion-time checks (new/updated vacancies get verified immediately
 *   instead of waiting for the periodic sweep), and
 * - the unified background sweep (vacancyLivenessSweep.ts).
 *
 * Verdicts are written to the record's liveness columns:
 * "live" on success, "dead" on 404/410/5xx/expiration-phrase/unsafe, and on
 * inconclusive errors (timeout, bot-block) only last_verified_at is stamped so
 * the record stays "unverified"/previous status without hot-looping.
 */

export type LinkSource = "role" | "job_listing" | "sponsor_vacancy";

const INGEST_CHECK_TIMEOUT_MS = 8000;

function tableFor(source: LinkSource) {
  switch (source) {
    case "role":
      return rolesTable;
    case "job_listing":
      return jobListingsTable;
    case "sponsor_vacancy":
      return sponsorLicenceVacanciesTable;
  }
}

export async function verifyStoredLink(
  source: LinkSource,
  id: number,
  url: string | null | undefined,
): Promise<"live" | "dead" | "inconclusive" | "skipped"> {
  const table = tableFor(source);
  if (!url || !/^https?:\/\//i.test(url)) return "skipped";
  if (
    source === "sponsor_vacancy" &&
    isBlockedVacancyUrl(url) &&
    !isValidJobBoardVacancyDeepLink(url)
  ) return "skipped";
  try {
    const result = await checkDestinationDead(url, { timeoutMs: INGEST_CHECK_TIMEOUT_MS });
    if (result.verdict === "dead" || result.verdict === "unsafe") {
      await db
        .update(table)
        .set({ liveness: "dead", lastVerifiedAt: new Date(), livenessReason: result.reason.slice(0, 500) })
        .where(eq(table.id, id));
      return "dead";
    }
    await db
      .update(table)
      .set({ liveness: "live", lastVerifiedAt: new Date(), livenessReason: null })
      .where(eq(table.id, id));
    return "live";
  } catch {
    // Timeout / network / bot-block — inconclusive. Stamp last_verified_at so
    // sweeps don't hot-loop on the same unreachable URL, but keep status.
    await db
      .update(table)
      .set({ lastVerifiedAt: new Date() })
      .where(eq(table.id, id))
      .catch(() => {});
    return "inconclusive";
  }
}

/**
 * Fire-and-forget ingestion-time check. Never throws; runs in the background
 * so vacancy creation/update responses are not delayed.
 */
export function queueLinkVerification(source: LinkSource, id: number, url: string | null | undefined): void {
  if (!url) return;
  verifyStoredLink(source, id, url)
    .then((outcome) => {
      if (outcome !== "skipped") {
        console.info(`[link-verify] ${source} #${id} ingestion check: ${outcome}`);
      }
    })
    .catch((err) => {
      console.warn(`[link-verify] ${source} #${id} ingestion check failed:`, err instanceof Error ? err.message : err);
    });
}

/**
 * Fire-and-forget batch verification with mild pacing (used after bulk
 * ingestion like CSV import or a vacancy-check snapshot insert).
 */
export function queueLinkVerificationBatch(
  items: Array<{ source: LinkSource; id: number; url: string | null | undefined }>,
  delayMs = 750,
): void {
  const withUrls = items.filter((i) => !!i.url);
  if (withUrls.length === 0) return;
  void (async () => {
    for (const item of withUrls) {
      await verifyStoredLink(item.source, item.id, item.url).catch(() => {});
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.info(`[link-verify] ingestion batch complete (${withUrls.length} links)`);
  })();
}
