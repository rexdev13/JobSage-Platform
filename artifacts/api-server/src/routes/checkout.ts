import { Router, type IRouter } from "express";
import { CreateCheckoutSessionBody, CreateCheckoutSessionResponse } from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";

const router: IRouter = Router();

function addOneCalendarMonth(from: Date): Date {
  const day = from.getUTCDate();
  const result = new Date(from);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

router.post("/checkout/create-session", requireAuthenticated, async (req, res): Promise<void> => {
  const parsed = CreateCheckoutSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // There is deliberately no unverified fallback in production. Until Stripe
  // is connected and its webhook signature is verified, only the local
  // development server can grant sandbox access.
  if (process.env.NODE_ENV !== "development" || process.env.STRIPE_SECRET_KEY) {
    res.status(503).json({
      error: "Live checkout is not available yet. No payment or access change was made.",
    });
    return;
  }

  const userId = req.user!.id;
  const now = new Date();
  const [user] = await db.select({
    subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (parsed.data.type === "booster_pack") {
    await db.update(usersTable)
      .set({
        bonusReadinessChecks: sql`${usersTable.bonusReadinessChecks} + 25`,
      })
      .where(eq(usersTable.id, userId));
  } else {
    const currentExpiry =
      user.subscriptionExpiresAt && user.subscriptionExpiresAt > now
        ? user.subscriptionExpiresAt
        : now;
    await db.update(usersTable)
      .set({
        plan: "pro",
        subscriptionExpiresAt: addOneCalendarMonth(currentExpiry),
      })
      .where(eq(usersTable.id, userId));
  }

  res.json(CreateCheckoutSessionResponse.parse({
    success: true,
    checkoutUrl: null,
    sandboxCompleted: true,
  }));
});

router.post("/checkout/webhook", (_req, res): void => {
  res.status(503).json({
    error: "Payment webhooks are disabled until verified Stripe signature handling is configured.",
  });
});

export default router;