import { db, usersTable, sessionsTable, pushDevicesTable, privacyPreferencesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { NOTIFICATION_CATEGORIES } from "@workspace/mobile-core";
import { requireClaimedCleanup } from "./cleanupScope";
import { type CleanupResource } from "./resource";
import { requireDeletionRelease } from "./writeGate";

/** Reusable inside the acceptance transaction after its account lock/preflight.
 * External OAuth revocation is separate: do not destroy its only credential
 * before a durable provider job has captured the necessary encrypted material. */
export async function revokeLocalCredentials(
  tx: Pick<typeof db, "update" | "delete">, accountId: string, now: Date,
) {
  requireDeletionRelease();
  await tx.update(usersTable).set({
    suspendedAt: now, passwordHash: null, passwordResetToken: null, passwordResetTokenExpires: null,
    emailVerifyToken: null, emailVerifyTokenExpires: null, googleBookingEnabled: false,
  }).where(eq(usersTable.id, accountId));
  await tx.delete(sessionsTable).where(sql`
    ${sessionsTable.sess}->'user'->>'id' = ${accountId}
    OR ${sessionsTable.sess}->>'userId' = ${accountId}
    OR ${sessionsTable.sess}->>'adminId' = ${accountId}
    OR ${sessionsTable.sess}->>'impersonatingUserId' = ${accountId}`);
  await tx.delete(pushDevicesTable).where(eq(pushDevicesTable.userId, accountId));
  await tx.update(privacyPreferencesTable).set({
    marketing: false, optionalAnalytics: false,
    notifications: Object.fromEntries(NOTIFICATION_CATEGORIES.map(category => [category, false])),
    updatedAt: now,
  }).where(eq(privacyPreferencesTable.userId, accountId));
}

/** Concrete local portion of revokeTokens. This does NOT acknowledge external
 * Google/Apple/provider revocation or physical-device cleanup as complete. */
export async function revokeClaimedLocalCredentials(resource: CleanupResource, taskId: string) {
  requireDeletionRelease();
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cleanup-local:${taskId}`}))`);
    await requireClaimedCleanup(resource, taskId, "token_revocation", tx);
    await revokeLocalCredentials(tx, resource.accountId, new Date());
  });
}
