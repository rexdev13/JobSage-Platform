import type { Request, Response, NextFunction } from "express";
import { db, privacyPreferencesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { DeletionBlocked, type DeletionActor } from "./accountDeletion/engine";
import type { NotificationCategory } from "@workspace/mobile-core";

/** All account roles have their own privacy rights; never inherit candidate-only marketing exclusions. */
export async function requirePrivacyActor(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: "Sign in to manage your account." }); return; }
  if (req.isImpersonating) { res.status(403).json({ error: "Privacy actions are unavailable during impersonation." }); return; }
  if (req.method !== "GET" && (req.get("x-jobsage-privacy-account") !== req.user.id || !req.is("application/json"))) {
    res.status(403).json({ error: "Review this action in the signed-in account before continuing." }); return;
  }
  // Custom headers + JSON force cross-origin preflight; unsafe cookie requests additionally need an Origin.
  if (req.method !== "GET" && !req.headers.authorization?.startsWith("Bearer ") && !req.get("origin")) {
    res.status(403).json({ error: "Browser origin verification is required." }); return;
  }
  const origin = req.get("origin");
  if (origin) {
    try {
      const url = new URL(origin);
      const host = req.get("host");
      const proxyHost = req.get("x-forwarded-host");
      const dev = process.env.NODE_ENV !== "production" && (url.host === host || url.host === proxyHost);
      if (url.protocol !== "https:" && !(dev && url.hostname === "localhost")) throw new Error();
      if (!dev && url.hostname !== "jobsage.co.uk" && url.hostname !== "www.jobsage.co.uk") throw new Error();
    } catch { res.status(403).json({ error: "Untrusted origin." }); return; }
  }
  let account: ReauthAccount | undefined;
  try {
    account = await readPrivacyAccount(req.user.id);
  } catch (error) {
    next(error);
    return;
  }
  if (!account || account.id !== req.user.id || account.suspendedAt || account.role !== req.user.role) {
    res.status(403).json({ error: "This account is unavailable or its sign-in state has changed." });
    return;
  }
  next();
}

export interface ReauthAccount { id: string; role: string; passwordHash: string | null; suspendedAt: Date | null }
export async function verifyPrivacyReauthentication(input: {
  signedInId: string; expectedAccountId: string; impersonating: boolean; password: string; confirmed: boolean;
}, readAccount: (id: string) => Promise<ReauthAccount | undefined>, now = new Date()): Promise<DeletionActor> {
  if (input.impersonating) throw new DeletionBlocked("impersonation_forbidden");
  if (!input.signedInId || input.expectedAccountId !== input.signedInId) throw new DeletionBlocked("account_changed");
  if (!input.confirmed) throw new DeletionBlocked("confirmation_required");
  if (!input.password || input.password.length > 1024) throw new DeletionBlocked("reauthentication_failed");
  const account = await readAccount(input.signedInId);
  if (!account || account.id !== input.signedInId || account.suspendedAt || !account.passwordHash) throw new DeletionBlocked("reauthentication_failed");
  if (!await bcrypt.compare(input.password, account.passwordHash)) throw new DeletionBlocked("reauthentication_failed");
  const fresh = await readAccount(input.signedInId);
  if (!fresh || fresh.id !== input.signedInId || fresh.suspendedAt || fresh.passwordHash !== account.passwordHash || fresh.role !== account.role) {
    throw new DeletionBlocked("account_changed");
  }
  return { id: fresh.id, role: fresh.role, impersonating: false, confirmed: true, reauthenticatedAt: now };
}
export async function readPrivacyAccount(id: string) {
  const [account] = await db.select({
    id: usersTable.id, role: usersTable.role, passwordHash: usersTable.passwordHash, suspendedAt: usersTable.suspendedAt,
  }).from(usersTable).where(eq(usersTable.id, id));
  return account;
}

export async function isPrivacyNotificationAllowed(userId: string, category: NotificationCategory): Promise<boolean> {
  const account = await readPrivacyAccount(userId);
  if (!account || account.suspendedAt) return false;
  const [preferences] = await db
    .select({ notifications: privacyPreferencesTable.notifications })
    .from(privacyPreferencesTable)
    .where(eq(privacyPreferencesTable.userId, userId));
  return (preferences?.notifications as Partial<Record<NotificationCategory, unknown>> | undefined)?.[category] !== false;
}
