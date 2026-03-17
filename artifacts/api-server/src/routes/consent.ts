import { Router, type IRouter, type Request, type Response } from "express";
import { db, consentLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { RecordConsentBody, RecordConsentResponse, GetMyConsentResponse } from "@workspace/api-zod";
import crypto from "crypto";

const router: IRouter = Router();

router.get("/consent", async (req: Request, res: Response): Promise<void> => {
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

  res.json(
    GetMyConsentResponse.parse({
      hasConsented: !!latestConsent,
      latestConsent: latestConsent ?? null,
    }),
  );
});

router.post("/consent", async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RecordConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rawIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  const ipString = Array.isArray(rawIp) ? rawIp[0] : rawIp;
  const ipHash = crypto.createHash("sha256").update(ipString).digest("hex");

  const [consent] = await db
    .insert(consentLogsTable)
    .values({
      userId: req.user.id,
      termsVersion: parsed.data.termsVersion,
      ipHash,
    })
    .returning();

  res.json(RecordConsentResponse.parse(consent));
});

export default router;
