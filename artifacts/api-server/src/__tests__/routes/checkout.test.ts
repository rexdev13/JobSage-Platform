import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

const { updateValues, account } = vi.hoisted(() => ({
  updateValues: vi.fn(),
  account: { subscriptionExpiresAt: null as Date | null, exists: true },
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  return {
    ...schema,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => account.exists ? [{ subscriptionExpiresAt: account.subscriptionExpiresAt }] : [],
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          updateValues(values);
          return { where: async () => undefined };
        },
      }),
    },
  };
});

vi.mock("../../middlewares/requireRole", () => ({
  requireAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "sandbox-test" } as express.Request["user"];
    next();
  },
}));

const checkoutRouter = (await import("../../routes/checkout")).default;
function app() {
  const application = express();
  application.use(express.json(), checkoutRouter);
  return application;
}

describe("readiness GBP sandbox checkout", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    updateValues.mockReset();
    account.exists = true;
    account.subscriptionExpiresAt = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("grants exactly twenty checks at £4.99 and returns server-owned GBP terms", async () => {
    const response = await request(app()).post("/checkout/create-session").send({ type: "booster_pack", currency: "gbp" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, sandboxCompleted: true, currency: "gbp", amount: 499, bonusChecks: 20 });
    expect(response.body.description).toContain("£4.99");
    const increment = updateValues.mock.calls[0][0].bonusReadinessChecks;
    expect(new PgDialect().sqlToQuery(increment).params).toEqual([20]);
  });

  it("activates Pro at £15.99/month and extends an existing active subscription", async () => {
    account.subscriptionExpiresAt = new Date("2099-01-31T12:00:00Z");
    const response = await request(app()).post("/checkout/create-session").send({ type: "pro_subscription" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ currency: "gbp", amount: 1599, bonusChecks: 0 });
    expect(response.body.description).toContain("£15.99/month");
    expect(updateValues).toHaveBeenCalledWith({ plan: "pro", subscriptionExpiresAt: new Date("2099-02-28T12:00:00Z") });
  });

  it("rejects USD without modifying access", async () => {
    const response = await request(app()).post("/checkout/create-session").send({ type: "booster_pack", currency: "usd" });
    expect(response.status).toBe(400);
    expect(updateValues).not.toHaveBeenCalled();
  });

  it.each(["production", "test"])("never grants unverified access in %s", async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    const response = await request(app()).post("/checkout/create-session").send({ type: "booster_pack" });
    expect(response.status).toBe(503);
    expect(updateValues).not.toHaveBeenCalled();
  });

  it("does not use a sandbox fallback when live credentials are configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "synthetic-test-key");
    const response = await request(app()).post("/checkout/create-session").send({ type: "pro_subscription" });
    expect(response.status).toBe(503);
    expect(updateValues).not.toHaveBeenCalled();
  });
});