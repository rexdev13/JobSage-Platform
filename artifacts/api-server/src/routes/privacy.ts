import { Router, type Request } from "express";
import { randomUUID, createHash } from "node:crypto";
import { db, privacyPreferencesTable, pushDevicesTable, smartApplyDraftsTable, supportTicketsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { ACCOUNT_DELETION_POLICY, DEFAULT_NOTIFICATION_CHOICES, NOTIFICATION_CATEGORIES, PRIVACY_POLICY_VERSION } from "@workspace/mobile-core";
import { requirePrivacyActor, readPrivacyAccount, verifyPrivacyReauthentication } from "../lib/privacyAccess";
import {
  clearPrivacyEmailCode,
  consumePrivacyEmailProof,
  createPrivacyEmailCode,
  getPrivacyAuthenticationBinding,
  PERSONAL_DATA_REAUTH_PURPOSE,
  verifyPrivacyEmailCode,
} from "../lib/privacyReauthentication";
import { DELETION_REQUESTS_ENABLED } from "../lib/accountDeletion/releaseReadiness";
import { encryptDeletionResource } from "../lib/accountDeletion/crypto";
import { sendPrivacyReauthenticationCode, sendSupportTicketNotification } from "../lib/email";
import { buildPersonalDataArchive } from "../lib/privacyExport/service";
import { ExportUnavailable } from "../lib/privacyExport/archive";

const router = Router();
const preferencesInput = z.object({
  marketing: z.boolean().optional(), optionalAnalytics: z.boolean().optional(),
  notifications: z.object(Object.fromEntries(NOTIFICATION_CATEGORIES.map(key => [key, z.boolean().optional()]))).strict().optional(),
}).strict();
const actionInput = z.object({
  expectedAccountId: z.string(),
  password: z.string().min(1).max(1024).optional(),
  emailCodeProof: z.string().min(40).max(128).optional(),
  confirmed: z.literal(true),
}).strict().refine((input) => !!input.password !== !!input.emailCodeProof);
const reauthenticationStartInput = z.object({
  expectedAccountId: z.string(),
  purpose: z.literal(PERSONAL_DATA_REAUTH_PURPOSE),
}).strict();
const reauthenticationVerifyInput = reauthenticationStartInput.extend({
  code: z.string().regex(/^\d{6}$/),
}).strict();
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
async function verifyPersonalDataAction(req: Request, input: z.infer<typeof actionInput>) {
  const account = await readPrivacyAccount(req.user!.id);
  const emailCodeVerified = account && !account.passwordHash
    ? await consumePrivacyEmailProof({
        proofToken: input.emailCodeProof,
        accountId: req.user!.id,
        email: account.email,
      })
    : false;
  return verifyPrivacyReauthentication({
    ...input,
    signedInId: req.user!.id,
    impersonating: !!req.isImpersonating,
    emailCodeVerified,
  }, readPrivacyAccount);
}
router.get("/privacy/settings", requirePrivacyActor, async (req, res) => {
  const [preferences] = await db.select().from(privacyPreferencesTable).where(eq(privacyPreferencesTable.userId, req.user!.id));
  const account = await readPrivacyAccount(req.user!.id);
  const reauthenticationMethod = account?.passwordHash
    ? "password"
    : account?.email && account.emailVerified ? "email_code" : "unavailable";
  res.json({ userId: req.user!.id, policyVersion: PRIVACY_POLICY_VERSION,
    marketing: preferences?.marketing ?? false, optionalAnalytics: preferences?.optionalAnalytics ?? false,
    notifications: { ...DEFAULT_NOTIFICATION_CHOICES, ...preferences?.notifications },
    deletionEnabled: DELETION_REQUESTS_ENABLED, deletionPolicy: ACCOUNT_DELETION_POLICY, reauthenticationMethod });
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
router.post("/privacy/reauthentication/start", requirePrivacyActor, async (req, res): Promise<void> => {
  const parsed = reauthenticationStartInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid reauthentication request." }); return; }
  if (parsed.data.expectedAccountId !== req.user!.id) { res.status(403).json({ error: "The signed-in account changed." }); return; }
  if (!await rateLimitActor(req.user!.id)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }
  const account = await readPrivacyAccount(req.user!.id);
  const sessionBinding = getPrivacyAuthenticationBinding(req);
  if (!account || account.passwordHash || !account.email || !account.emailVerified || !sessionBinding) {
    res.status(403).json({ error: "Email-code reauthentication is unavailable for this account." });
    return;
  }
  const challenge = { sessionBinding, accountId: account.id };
  try {
    const code = await createPrivacyEmailCode({ ...challenge, email: account.email });
    await sendPrivacyReauthenticationCode(account.email, code);
  } catch (error) {
    try { await clearPrivacyEmailCode(challenge); } catch { /* Expired challenge records are harmless and short-lived. */ }
    req.log.warn({ err: error }, "Privacy reauthentication email could not be delivered");
    res.status(503).json({ error: "We could not send a verification code. Try again later." });
    return;
  }
  res.status(202).json({
    sent: true,
    message: "A verification code was sent to your verified account email. It expires in 10 minutes.",
  });
});
router.post("/privacy/reauthentication/verify", requirePrivacyActor, async (req, res): Promise<void> => {
  const parsed = reauthenticationVerifyInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter the six-digit verification code." }); return; }
  if (parsed.data.expectedAccountId !== req.user!.id) { res.status(403).json({ error: "The signed-in account changed." }); return; }
  if (!await rateLimitActor(req.user!.id)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }
  const account = await readPrivacyAccount(req.user!.id);
  const sessionBinding = getPrivacyAuthenticationBinding(req);
  if (!account || account.passwordHash || !account.email || !account.emailVerified || !sessionBinding) {
    res.status(403).json({ error: "Email-code reauthentication is unavailable for this account." });
    return;
  }
  const proofToken = await verifyPrivacyEmailCode({
    sessionBinding,
    accountId: account.id,
    email: account.email,
    code: parsed.data.code,
  });
  if (!proofToken) { res.status(403).json({ error: "The code is invalid or expired. Request a new code and try again." }); return; }
  res.json({ verified: true, proofToken, expiresInSeconds: 300 });
});
router.post("/privacy/export", requirePrivacyActor, async (req, res) => {
  res.set({ "Cache-Control": "no-store, private", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" });
  const parsed = actionInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Fresh account verification and explicit confirmation are required." }); return; }
  if (!await rateLimitActor(req.user!.id)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }
  const before = await readPrivacyAccount(req.user!.id);
  try {
    await verifyPersonalDataAction(req, parsed.data);
  } catch { res.status(403).json({ error: "Reauthentication failed." }); return; }
  try {
    const archive = await buildPersonalDataArchive(req.user!.id);
    const after = await readPrivacyAccount(req.user!.id);
    if (!before || !after || after.suspendedAt || after.passwordHash !== before.passwordHash ||
        after.role !== before.role || after.email !== before.email || after.emailVerified !== before.emailVerified) {
      res.status(403).json({ error: "The account changed while preparing the export. Sign in again." }); return;
    }
    res.set({ "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="JOBSAGE-personal-data.zip"' });
    res.send(archive);
  } catch (error) {
    if (error instanceof ExportUnavailable) {
      res.status(/limit|exceed|Too many/i.test(error.message) ? 413 : 503).json({ error: error.message }); return;
    }
    req.log.warn("Private export could not be prepared; no archive delivered");
    res.status(503).json({ error: "We could not safely prepare the archive. Try again or request a full export from the privacy team." });
  }
});
router.post("/privacy/data-request", requirePrivacyActor, async (req, res) => {
  const parsed = actionInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Reauthentication and explicit confirmation are required." }); return; }
  if (!await rateLimitActor(req.user!.id)) { res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }
  const before = await readPrivacyAccount(req.user!.id);
  try {
    await verifyPersonalDataAction(req, parsed.data);
  } catch { res.status(403).json({ error: "Reauthentication failed. Check the signed-in account or request a new email code." }); return; }
  const [actor] = await db.select({ email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!before || !actor?.email || actor.email !== before.email) { res.status(403).json({ error: "The account is unavailable or changed." }); return; }
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
