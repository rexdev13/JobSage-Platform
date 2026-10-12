import { createHash, randomBytes } from "node:crypto";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { safeInternalPath } from "@workspace/mobile-core";
import { getSession } from "./auth";

export const MOBILE_EXCHANGE_TTL = 60_000;
export function proofHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function exchangeKey(code: string) { return `mobile-exchange:${proofHash(code)}`; }

interface Grant {
  kind: "mobile-exchange"; userId: string; sessionId: string;
  challenge: string; audience: "web" | "native"; nextPath: string;
}

export async function issueMobileGrant(sessionId: string, userId: string, challenge: string,
  audience: Grant["audience"], nextPath: string) {
  const path = safeInternalPath(nextPath);
  if (!path) throw new Error("Invalid internal destination");
  const code = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MOBILE_EXCHANGE_TTL);
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mobile-grant:${userId}:${audience}`}))`);
    // Keep up to eight active exchanges so simultaneous devices/downloads do
    // not invalidate one another. Pruning runs under the same writer lock.
    await tx.delete(sessionsTable).where(and(
      sql`${sessionsTable.sess}->>'kind' = 'mobile-exchange'`,
      sql`${sessionsTable.sess}->>'userId' = ${userId}`,
      sql`${sessionsTable.sess}->>'audience' = ${audience}`,
      lte(sessionsTable.expire, new Date()),
    ));
    await tx.execute(sql`DELETE FROM ${sessionsTable} WHERE ${sessionsTable.sid} IN (
      SELECT ${sessionsTable.sid} FROM ${sessionsTable}
      WHERE ${sessionsTable.sess}->>'kind' = 'mobile-exchange'
        AND ${sessionsTable.sess}->>'userId' = ${userId}
        AND ${sessionsTable.sess}->>'audience' = ${audience}
      ORDER BY ${sessionsTable.expire} DESC, ${sessionsTable.sid} DESC OFFSET 7
    )`);
    await tx.insert(sessionsTable).values({
      sid: exchangeKey(code),
      sess: { kind: "mobile-exchange", userId, sessionId, challenge, audience, nextPath: path },
      expire: expiresAt,
    });
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function consumeMobileGrant(code: string, verifier: string, audience: Grant["audience"]) {
  // DELETE ... RETURNING is the atomic claim. Wrong proof or audience cannot
  // burn a valid grant. Codes are stored as hashes and are never session IDs.
  const [claimed] = await db.delete(sessionsTable).where(and(
    eq(sessionsTable.sid, exchangeKey(code)),
    gt(sessionsTable.expire, new Date()),
    sql`${sessionsTable.sess}->>'kind' = 'mobile-exchange'`,
    sql`${sessionsTable.sess}->>'challenge' = ${proofHash(verifier)}`,
    sql`${sessionsTable.sess}->>'audience' = ${audience}`,
  )).returning({ sess: sessionsTable.sess });
  if (!claimed) return null;
  const grant = claimed.sess as unknown as Grant;
  const session = await getSession(grant.sessionId);
  if (!session || session.impersonating || session.impersonatingUserId
    || session.user.id !== grant.userId || !safeInternalPath(grant.nextPath)) return null;
  // Recheck the account, not just the cached session snapshot.
  const [account] = await db.select({
    id: usersTable.id, suspendedAt: usersTable.suspendedAt, emailVerified: usersTable.emailVerified,
    role: usersTable.role, email: usersTable.email,
    firstName: usersTable.firstName, lastName: usersTable.lastName,
    profileImageUrl: usersTable.profileImageUrl,
  }).from(usersTable).where(eq(usersTable.id, grant.userId));
  if (!account || account.suspendedAt || !account.emailVerified
    || account.role !== session.user.role) return null;
  return { sessionId: grant.sessionId, user: {
    id: account.id, email: account.email, firstName: account.firstName,
    lastName: account.lastName, role: account.role, profileImageUrl: account.profileImageUrl,
  }, nextPath: grant.nextPath };
}
