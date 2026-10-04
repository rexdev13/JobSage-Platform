import { and, eq, gte, gt, sql } from "drizzle-orm";
import {
  db,
  roleGapAnalysesTable,
  sponsorLicenceGapAnalysesTable,
  usersTable,
} from "@workspace/db";

export const READINESS_CHECK_LIMIT = 3;
export const READINESS_BOOSTER_CHECKS = 20;
export const READINESS_CURRENCY = "gbp" as const;
export const READINESS_OFFERS = {
  booster_pack: { amount: 499, bonusChecks: READINESS_BOOSTER_CHECKS, description: "20 extra Readiness Checks for £4.99 (one-time)" },
  pro_subscription: { amount: 1599, bonusChecks: 0, description: "JobSage Pro — £15.99/month, unlimited Readiness Checks" },
} as const;

export type ReadinessPlan = "free" | "pro";

export interface ReadinessQuotaSnapshot {
  used: number;
  limit: number;
  bonusRemaining: number;
  plan: ReadinessPlan;
  resetsAt: string;
}

export type ReadinessCheckReservation =
  | { allowed: true; bonusReserved: boolean; plan: ReadinessPlan }
  | { allowed: false; bonusReserved: false; plan: "free" };

export type ReadinessAccessDecision = "pro" | "monthly" | "bonus" | "denied";

export function decideReadinessAccess(
  user: {
    plan: ReadinessPlan;
    bonusReadinessChecks: number;
    subscriptionExpiresAt: Date | null;
  } | undefined,
  used: number,
  now = new Date(),
): ReadinessAccessDecision {
  if (
    user?.plan === "pro" &&
    user.subscriptionExpiresAt !== null &&
    user.subscriptionExpiresAt > now
  ) {
    return "pro";
  }
  if (used < READINESS_CHECK_LIMIT) return "monthly";
  if ((user?.bonusReadinessChecks ?? 0) > 0) return "bonus";
  return "denied";
}

/**
 * Readiness quotas reset at 00:00 UTC on the first day of each calendar month.
 * Using UTC keeps the boundary deterministic across API instances.
 */
export function getReadinessMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getNextReadinessReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function getReadinessUsageStart(now = new Date(), resetAt?: Date | null): Date {
  const monthStart = getReadinessMonthStart(now);
  return resetAt && resetAt > monthStart ? resetAt : monthStart;
}

async function getMonthlyReadinessUsage(userId: string, now = new Date(), resetAt?: Date | null): Promise<number> {
  const monthStart = getReadinessUsageStart(now, resetAt);
  const [[sponsorCount], [roleCount]] = await Promise.all([
    db.select({ count: sql<number>`cast(count(*) as integer)` })
      .from(sponsorLicenceGapAnalysesTable)
      .where(and(
        eq(sponsorLicenceGapAnalysesTable.userId, userId),
        gte(sponsorLicenceGapAnalysesTable.generatedAt, monthStart),
      )),
    db.select({ count: sql<number>`cast(count(*) as integer)` })
      .from(roleGapAnalysesTable)
      .where(and(
        eq(roleGapAnalysesTable.userId, userId),
        gte(roleGapAnalysesTable.generatedAt, monthStart),
      )),
  ]);
  return (sponsorCount?.count ?? 0) + (roleCount?.count ?? 0);
}

function effectivePlan(
  plan: ReadinessPlan,
  subscriptionExpiresAt: Date | null,
  now: Date,
): ReadinessPlan {
  return plan === "pro" && subscriptionExpiresAt && subscriptionExpiresAt > now ? "pro" : "free";
}

export async function getReadinessQuota(
  userId: string,
  now = new Date(),
): Promise<ReadinessQuotaSnapshot> {
  const [user] = await db.select({
      plan: usersTable.plan,
      bonusReadinessChecks: usersTable.bonusReadinessChecks,
      subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
      readinessQuotaResetAt: usersTable.readinessQuotaResetAt,
    }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const used = await getMonthlyReadinessUsage(userId, now, user?.readinessQuotaResetAt);

  return {
    used: Math.min(used, READINESS_CHECK_LIMIT),
    limit: READINESS_CHECK_LIMIT,
    bonusRemaining: user?.bonusReadinessChecks ?? 0,
    plan: user
      ? effectivePlan(user.plan, user.subscriptionExpiresAt, now)
      : "free",
    resetsAt: getNextReadinessReset(now).toISOString(),
  };
}

/**
 * Checks the free monthly allowance first, then atomically reserves one
 * purchased check only after the free allowance is exhausted. Callers must
 * refund a bonus reservation when the new analysis fails.
 */
export async function reserveReadinessCheck(
  userId: string,
  now = new Date(),
): Promise<ReadinessCheckReservation> {
  const [user] = await db.select({
    plan: usersTable.plan,
    bonusReadinessChecks: usersTable.bonusReadinessChecks,
    subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
    readinessQuotaResetAt: usersTable.readinessQuotaResetAt,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (user && effectivePlan(user.plan, user.subscriptionExpiresAt, now) === "pro") {
    return { allowed: true, bonusReserved: false, plan: "pro" };
  }

  const used = await getMonthlyReadinessUsage(userId, now, user?.readinessQuotaResetAt);
  const decision = decideReadinessAccess(user, used, now);
  if (decision === "monthly") {
    return { allowed: true, bonusReserved: false, plan: "free" };
  }
  if (decision === "pro") {
    return { allowed: true, bonusReserved: false, plan: "pro" };
  }
  if (decision === "denied") {
    return { allowed: false, bonusReserved: false, plan: "free" };
  }

  const [updated] = await db.update(usersTable)
    .set({
      bonusReadinessChecks: sql`${usersTable.bonusReadinessChecks} - 1`,
    })
    .where(and(
      eq(usersTable.id, userId),
      gt(usersTable.bonusReadinessChecks, 0),
    ))
    .returning({ bonusReadinessChecks: usersTable.bonusReadinessChecks });

  if (updated) {
    return { allowed: true, bonusReserved: true, plan: "free" };
  }

  return { allowed: false, bonusReserved: false, plan: "free" };
}

export async function refundReservedReadinessCheck(userId: string): Promise<void> {
  await db.update(usersTable)
    .set({
      bonusReadinessChecks: sql`${usersTable.bonusReadinessChecks} + 1`,
    })
    .where(eq(usersTable.id, userId));
}