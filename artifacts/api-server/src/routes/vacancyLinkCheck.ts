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
import { requireAuthenticated } from "../middlewares/requireRole";
import { checkDestinationDead } from "../lib/linkHealth";

const router: IRouter = Router();

interface CacheEntry {
  verdict: "alive" | "dead" | "inconclusive";
  reason: string | null;
  at: number;
}

const linkCheckCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_MAX_SIZE = 5000;
const CLICK_CHECK_TIMEOUT_MS = 3000; // keep it fast for the user

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
      res.json({ verdict: entry.verdict, reason: entry.reason, cached: false });
    } catch {
      // Timeout or network error — inconclusive; don't cache so next click retries
      res.json({ verdict: "inconclusive", reason: null, cached: false });
    }
  },
);

export default router;
