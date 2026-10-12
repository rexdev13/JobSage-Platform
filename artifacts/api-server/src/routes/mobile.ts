import { Router, type IRouter, type Request } from "express";
import { z } from "zod/v4";
import { db, applicationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { safeEmployerUrl, safeInternalPath } from "@workspace/mobile-core";
import { getSessionId, SESSION_COOKIE, SESSION_TTL } from "../lib/auth";
import { issueMobileGrant, consumeMobileGrant } from "../lib/mobileSessionExchange";
import { writeAuditEvent } from "../lib/audit";
import { requireAuthenticated } from "../middlewares/requireRole";
import { mobileExchangeRateLimit } from "../middlewares/mobileExchangeRateLimit";

const router: IRouter = Router();
const issue = z.object({
  challenge: z.string().regex(/^[a-f0-9]{64}$/),
  audience: z.enum(["native", "web"]),
  nextPath: z.string().max(2048).default("/").refine(v => !!safeInternalPath(v)),
}).strict();
const redeem = z.object({
  code: z.string().regex(/^[a-f0-9]{64}$/),
  verifier: z.string().min(32).max(128),
}).strict();

function safeOrigin(req: Request) {
  if (req.headers.authorization?.startsWith("Bearer ")) return true;
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
    const url = new URL(origin);
    return url.protocol === "https:" && url.host === host;
  } catch { return false; }
}

router.post("/auth/mobile/session-grant", requireAuthenticated, mobileExchangeRateLimit, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.isImpersonating || !safeOrigin(req)) {
    res.status(403).json({ error: "Session exchange is not permitted." }); return;
  }
  const parsed = issue.safeParse(req.body);
  const sid = getSessionId(req);
  if (!parsed.success || !sid || !req.is("application/json")) {
    res.status(400).json({ error: "Invalid session exchange request." }); return;
  }
  const grant = await issueMobileGrant(sid, req.user!.id, parsed.data.challenge,
    parsed.data.audience, parsed.data.nextPath);
  await writeAuditEvent(req.user!.id, "mobile_session_grant", undefined, { audience: parsed.data.audience });
  res.json(grant);
});

router.post("/auth/mobile/session-redeem", mobileExchangeRateLimit, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const parsed = redeem.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid exchange." }); return; }
  const result = await consumeMobileGrant(parsed.data.code, parsed.data.verifier, "native");
  if (!result) { res.status(401).json({ error: "Exchange expired or unavailable. Sign in again." }); return; }
  await writeAuditEvent(result.user.id, "mobile_session_redeemed", undefined, { audience: "native" });
  res.json({ token: result.sessionId, user: result.user });
});

router.post("/auth/mobile/session-exchange", mobileExchangeRateLimit, async (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const parsed = redeem.safeParse(req.body);
  if (!parsed.success) { res.status(400).send("Invalid session exchange. Return to JOBSAGE and retry."); return; }
  const result = await consumeMobileGrant(parsed.data.code, parsed.data.verifier, "web");
  if (!result) { res.status(401).send("Session exchange expired. Return to JOBSAGE and retry."); return; }
  res.cookie(SESSION_COOKIE, result.sessionId, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL,
  });
  await writeAuditEvent(result.user.id, "mobile_session_redeemed", undefined, { audience: "web" });
  res.redirect(303, result.nextPath);
});

router.get("/mobile/applications/:id/context", requireAuthenticated, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.isImpersonating || req.user!.role !== "candidate") {
    res.status(403).json({ error: "Only the candidate can open this application." }); return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid application." }); return; }
  const [application] = await db.select({
    id: applicationsTable.id, applicationUrl: applicationsTable.applicationUrl,
    roleId: applicationsTable.roleId, status: applicationsTable.status,
    jobTitle: applicationsTable.jobTitle, companyName: applicationsTable.companyName,
  }).from(applicationsTable).where(and(
    eq(applicationsTable.id, id), eq(applicationsTable.userId, req.user!.id),
    eq(applicationsTable.applicationType, "website"),
  ));
  if (!application) { res.status(404).json({ error: "Application not found." }); return; }
  const applicationUrl = safeEmployerUrl(application.applicationUrl ?? "");
  if (!applicationUrl) { res.status(409).json({ error: "This application needs a safe HTTPS destination." }); return; }
  // Preserve the persisted outbound string for exact tracker confirmation;
  // normalization is used only to validate safe navigation.
  res.json({ ...application, applicationUrl: application.applicationUrl });
});

export default router;
