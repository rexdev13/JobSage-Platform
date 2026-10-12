import type { Request, Response, NextFunction } from "express";

const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_BUCKETS = 5000;

/** Best-effort per-instance abuse protection, not a distributed quota.
 * The database separately bounds authenticated outstanding single-use grants.
 * Only the authenticated UUID or Express's configured peer address is used. */
export function mobileExchangeRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = req.user?.id ? `user:${req.user.id}` : `peer:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
  const old = buckets.get(key);
  const bucket = old && old.resetAt > now ? old : { count: 0, resetAt: now + WINDOW_MS };
  if (!old && buckets.size >= MAX_BUCKETS) {
    for (const [entry, value] of buckets) if (value.resetAt <= now) buckets.delete(entry);
    if (buckets.size >= MAX_BUCKETS) {
      res.set("Retry-After", "60").status(429).json({ error: "Please wait a minute and retry the session exchange." });
      return;
    }
  }
  bucket.count++;
  buckets.set(key, bucket);
  if (bucket.count > MAX_REQUESTS) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))))
      .status(429).json({ error: "Too many session exchanges. Please wait and retry." });
    return;
  }
  next();
}
