/**
 * Click-time vacancy link health check.
 *
 * Candidates call this on the Opportunities page before opening an unverified
 * apply URL so dead links never open a broken tab. Results are cached in-memory
 * for 4 hours so repeat clicks are instant.
 *
 * Cost: plain HTTP fetch — zero AI/LLM calls.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobListingsTable, rolesTable, sponsorLicenceVacanciesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { checkDestinationDead } from "../lib/linkHealth";
import { getCandidateVacancyStatus } from "../lib/vacancyLiveness";

const router: IRouter = Router();

interface CacheEntry {
  verdict: "alive" | "dead" | "inconclusive";
  reason: string | null;
  at: number;
}

const linkCheckCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_MAX_SIZE = 5000;
const CLICK_CHECK_TIMEOUT_MS = 1500;

async function markUrlDeadGlobally(url: string, reason: string | null): Promise<void> {
  const update = {
    liveness: "dead" as const,
    lastVerifiedAt: new Date(),
    livenessReason: (reason || "background click check marked URL dead").slice(0, 500),
  };
  await Promise.all([
    db.update(sponsorLicenceVacanciesTable).set(update).where(eq(sponsorLicenceVacanciesTable.url, url)),
    db.update(rolesTable).set(update).where(eq(rolesTable.applyUrl, url)),
    db.update(jobListingsTable).set(update).where(eq(jobListingsTable.applyUrl, url)),
  ]);
}

async function canPromoteUrl(url: string): Promise<boolean> {
  const stored = await db
    .select({
      sourceType: sponsorLicenceVacanciesTable.sourceType,
      liveness: sponsorLicenceVacanciesTable.liveness,
      lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
      lastDiscoveredAt: sponsorLicenceVacanciesTable.lastDiscoveredAt,
      sourceMissingSince: sponsorLicenceVacanciesTable.sourceMissingSince,
      sourceMissingObservations: sponsorLicenceVacanciesTable.sourceMissingObservations,
      closesAt: sponsorLicenceVacanciesTable.closesAt,
      expiresAt: sponsorLicenceVacanciesTable.expiresAt,
      closedReason: sponsorLicenceVacanciesTable.closedReason,
      companyVacancyEvidence: sponsorLicenceVacanciesTable.companyVacancyEvidence,
      companyEvidenceLegacyUntil: sponsorLicenceVacanciesTable.companyEvidenceLegacyUntil,
    })
    .from(sponsorLicenceVacanciesTable)
    .where(eq(sponsorLicenceVacanciesTable.url, url));
  return !stored.some((row) => {
    const status = getCandidateVacancyStatus({ ...row, now: new Date() });
    return status === "expired" || status === "dead" || status === "missing" || status === "unverified";
  });
}

async function markUrlLiveGlobally(url: string): Promise<boolean> {
  if (!(await canPromoteUrl(url))) return false;
  const update = {
    liveness: "live" as const,
    lastVerifiedAt: new Date(),
    livenessReason: null,
  };
  await Promise.all([
    db.update(sponsorLicenceVacanciesTable).set(update).where(eq(sponsorLicenceVacanciesTable.url, url)),
    db.update(rolesTable).set(update).where(eq(rolesTable.applyUrl, url)),
    db.update(jobListingsTable).set(update).where(eq(jobListingsTable.applyUrl, url)),
  ]);
  return true;
}

function pruneCache(): void {
  if (linkCheckCache.size <= CACHE_MAX_SIZE) return;
  // Remove the oldest 20% of entries
  const entries = [...linkCheckCache.entries()].sort((a, b) => a[1].at - b[1].at);
  const toDelete = Math.floor(CACHE_MAX_SIZE * 0.2);
  for (let i = 0; i < toDelete; i++) {
    linkCheckCache.delete(entries[i]![0]);
  }
}

router.get(
  "/vacancy-link-check",
  requireAuthenticated,
  async (req: Request, res: Response): Promise<void> => {
    const url = req.query.url as string | undefined;
    if (!url) {
      res.status(400).json({ error: "url query param is required" });
      return;
    }

    try {
      new URL(url); // validate it parses
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    // Return cached result if fresh enough
    const cached = linkCheckCache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      if (cached.verdict === "alive") {
        if (!(await markUrlLiveGlobally(url))) {
          res.json({ verdict: "dead", reason: "vacancy is no longer available", cached: true });
          return;
        }
      }
      res.json({ verdict: cached.verdict, reason: cached.reason, cached: true });
      return;
    }

    try {
      const result = await checkDestinationDead(url, { timeoutMs: CLICK_CHECK_TIMEOUT_MS });
      const verdict: CacheEntry["verdict"] =
        result.verdict === "dead" || result.verdict === "unsafe" ? "dead" : "alive";
      const entry: CacheEntry = { verdict, reason: result.reason || null, at: Date.now() };
      linkCheckCache.set(url, entry);
      pruneCache();
      if (verdict === "dead") {
        await markUrlDeadGlobally(url, entry.reason);
      } else if (verdict === "alive") {
        if (!(await markUrlLiveGlobally(url))) {
          res.json({ verdict: "dead", reason: "vacancy is no longer available", cached: false });
          return;
        }
      }
      res.json({ verdict: entry.verdict, reason: entry.reason, cached: false });
    } catch {
      // Timeout or network error — inconclusive; don't cache so next click retries
      res.json({ verdict: "inconclusive", reason: null, cached: false });
    }
  },
);

export default router;
