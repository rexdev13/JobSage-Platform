import { type Request, type Response, type NextFunction } from "express";
import { db, consentLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

export async function requireConsent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [latestConsent] = await db
    .select()
    .from(consentLogsTable)
    .where(eq(consentLogsTable.userId, req.user.id))
    .orderBy(desc(consentLogsTable.consentedAt))
    .limit(1);

  if (!latestConsent) {
    res.status(403).json({ error: "Consent required before accessing this resource." });
    return;
  }

  next();
}
