import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { db, privacyPreferencesTable, pushDevicesTable, smartApplyDraftsTable, supportTicketsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { ACCOUNT_DELETION_POLICY, DEFAULT_NOTIFICATION_CHOICES, NOTIFICATION_CATEGORIES, PRIVACY_POLICY_VERSION } from "@workspace/mobile-core";
import { requirePrivacyActor, readPrivacyAccount, verifyPrivacyReauthentication } from "../lib/privacyAccess";
import { DELETION_REQUESTS_ENABLED } from "../lib/accountDeletion/releaseReadiness";
import { encryptDeletionResource } from "../lib/accountDeletion/crypto";
import { sendSupportTicketNotification } from "../lib/email";

const router = Router();
const preferencesInput = z.object({
  marketing: z.boolean().optional(), optionalAnalytics: z.boolean().optional(),
  notifications: z.object(Object.fromEntries(NOTIFICATION_CATEGORIES.map(key => [key, z.boolean().optional()]))).strict().optional(),
}).strict();
const actionInput = z.object({ expectedAccountId: z.string(), password: z.string().min(1).max(1024), confirmed: z.literal(true) }).strict();
const confirmationInput = z.object({ confirmed: z.literal(true) }).strict();
// Account-bound, expiry-indexed session records provide distributed rate limits, including failed challenges.
async function rateLimitActor(id: string) {
  const { sql } = await import("drizzle-orm");
  const key = `privacy-limit:${createHash("sha256").update(id).digest("hex")}`;
  const result = await db.execute(sql`
    INSERT INTO user_sessions(sid,sess,expire) VALUES (${key},'{"count":1}'::jsonb,now()+interval '15 minutes')
    ON CONFLICT(sid) DO UPDATE SET
      sess=CASE WHEN user_sessions.expire<=now() THEN '{"count":1}'::jsonb
        ELSE jsonb_build_object('count',(user_sessions.sess->>'count')::int+1) END,
      expire=CASE WHEN user_sessions.expire<=now() THEN now()+interval '15 minutes' ELSE user_sessions.expire END
    RETURNING (sess->>'count')::int AS count`);
  return Number(result.rows[0]?.count) <= 5;
}
router.get("/privacy/settings", requirePrivacyActor, async (req, res) => {
  const [preferences] = await db.select().from(privacyPreferencesTable).where(eq(privacyPreferencesTable.userId, req.user!.id));
  res.json({ userId: req.user!.id, policyVersion: PRIVACY_POLICY_VERSION,
    marketing: preferences?.marketing ?? false, optionalAnalytics: preferences?.optionalAnalytics ?? false,
    notifications: { ...DEFAULT_NOTIFICATION_CHOICES, ...preferences?.notifications },
    deletionEnabled: DELETION_REQUESTS_ENABLED, deletionPolicy: ACCOUNT_DELETION_POLICY });
});
router.patch("/privacy/settings", requirePrivacyActor, async (req, res) => {
  const parsed = preferencesInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid privacy choices." }); return; }
  // Serialize partial notification updates so two devices cannot erase each other's choices.
  await db.transaction(async tx => {
    const { sql } = await import("drizzle-orm");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`privacy:${req.user!.id}`}))`);
    const [existing] = await tx.select().from(privacyPreferencesTable).where(eq(privacyPreferencesTable.userId, req.user!.id));
    const notifications = { ...existing?.notifications };
    for (const category of NOTIFICATION_CATEGORIES) {
      const choice = parsed.data.notifications?.[category];
      if (choice !== undefined) notifications[category] = choice;
    }
    const value = { userId: req.user!.id, marketing: parsed.data.marketing ?? existing?.marketing ?? false,
      optionalAnalytics: parsed.data.optionalAnalytics ?? existing?.optionalAnalytics ?? false,
      notifications, updatedAt: new Date() };
    await tx.insert(privacyPreferencesTable).values(value).onConflictDoUpdate({ target: privacyPreferencesTable.userId, set: value });
  });
  res.json({ success: true });
});
router.post("/privacy/data-request", requirePrivacyActor, async (req, res) => {
  const parsed = actionInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Reauthentication and explicit confirmation are required." }); return; }
  if (!await rateLimitActor(req.user!.id)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }
  try {
    await verifyPrivacyReauthentication({ ...parsed.data, signedInId: req.user!.id, impersonating: !!req.isImpersonating }, readPrivacyAccount);
  } catch { res.status(403).json({ error: "Reauthentication failed. Check the signed-in account and password." }); return; }
  const [actor] = await db.select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!actor?.email) { res.status(403).json({ error: "The account is unavailable." }); return; }
  const ticketId = `JS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const ticket = { ticketId, userId: req.user!.id, category: "Other" as const, subject: "Authenticated personal-data export request",
    name: [actor.firstName, actor.lastName].filter(Boolean).join(" ").slice(0,120) || "JOBSAGE user", email: actor.email,
    message: "The account holder reauthenticated and requested a personal-data export. Verify ownership and field allowlists, exclude credentials/internal notes/other users, and deliver only through a short-lived authenticated channel. No export has been generated yet." };
  await db.insert(supportTicketsTable).values(ticket);
  const notification = await sendSupportTicketNotification(ticket);
  if (!notification.success) req.log.warn({ ticketId }, "Data-access request saved; support notification needs retry");
  res.status(201).json({ ticketId, status: "requested", message: "Your authenticated request is saved. The privacy team will contact your verified account email about securely providing your data. This receipt is not a completed export." });
});
router.delete("/privacy/smart-apply-drafts", requirePrivacyActor, async (req, res) => {
  if (!confirmationInput.safeParse(req.body).success) { res.status(400).json({ error: "Confirm draft deletion." }); return; }
  await db.delete(smartApplyDraftsTable).where(eq(smartApplyDraftsTable.userId, req.user!.id));
  res.json({ success: true });
});
router.post("/privacy/push-device", requirePrivacyActor, async (req, res) => {
  const parsed = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/), platform: z.enum(["ios","android"]) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid push registration." }); return; }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  let tokenCiphertext: string;
  try { tokenCiphertext = encryptDeletionResource(parsed.data.token); }
  catch { res.status(503).json({ error: "Secure push registration is not configured." }); return; }
  await db.insert(pushDevicesTable).values({ tokenHash, tokenCiphertext, userId: req.user!.id, platform: parsed.data.platform })
    .onConflictDoUpdate({ target: pushDevicesTable.tokenHash, set: { userId: req.user!.id, tokenCiphertext, updatedAt: new Date() } });
  res.json({ success: true });
});
router.delete("/privacy/push-device", requirePrivacyActor, async (req, res) => {
  if (!confirmationInput.safeParse(req.body).success) { res.status(400).json({ error: "Explicit confirmation is required." }); return; }
  await db.delete(pushDevicesTable).where(eq(pushDevicesTable.userId, req.user!.id));
  res.json({ success: true });
});
export default router;
