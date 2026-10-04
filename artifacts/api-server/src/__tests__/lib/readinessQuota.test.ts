import { describe, expect, it } from "vitest";
import {
  decideReadinessAccess,
  getNextReadinessReset,
  getReadinessMonthStart,
  getReadinessUsageStart,
  READINESS_BOOSTER_CHECKS,
  READINESS_CURRENCY,
  READINESS_OFFERS,
  READINESS_CHECK_LIMIT,
} from "../../lib/readinessQuota";

describe("readiness monthly quota boundaries", () => {
  it("uses the first day of the current UTC month as the counting boundary", () => {
    expect(getReadinessMonthStart(new Date("2026-08-31T23:59:59Z")).toISOString())
      .toBe("2026-08-01T00:00:00.000Z");
  });

  it("resets at the first instant of the next UTC month, including year rollover", () => {
    expect(getNextReadinessReset(new Date("2026-12-15T12:00:00Z")).toISOString())
      .toBe("2027-01-01T00:00:00.000Z");
  });

  it("counts only analyses after a reset in the current month", () => {
    expect(getReadinessUsageStart(new Date("2026-10-04T12:00:00Z"), new Date("2026-10-03T09:00:00Z")).toISOString())
      .toBe("2026-10-03T09:00:00.000Z");
  });

  it("ignores a reset from a previous month", () => {
    expect(getReadinessUsageStart(new Date("2026-10-04T12:00:00Z"), new Date("2026-09-30T09:00:00Z")).toISOString())
      .toBe("2026-10-01T00:00:00.000Z");
  });

  it("defines GBP offers with a twenty-check booster", () => {
    expect(READINESS_CURRENCY).toBe("gbp");
    expect(READINESS_BOOSTER_CHECKS).toBe(20);
    expect(READINESS_OFFERS.booster_pack.amount).toBe(499);
    expect(READINESS_OFFERS.pro_subscription.amount).toBe(1599);
  });
});

describe("readiness access decision", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("sets the free monthly allowance to three checks", () => {
    expect(READINESS_CHECK_LIMIT).toBe(3);
  });

  it.each([0, 1, 2])("uses the monthly allowance before purchased checks at %i used", (used) => {
    expect(decideReadinessAccess({
      plan: "free",
      bonusReadinessChecks: 20,
      subscriptionExpiresAt: null,
    }, used, now)).toBe("monthly");
  });

  it("uses a purchased check after the free monthly allowance is exhausted", () => {
    expect(decideReadinessAccess({
      plan: "free",
      bonusReadinessChecks: 1,
      subscriptionExpiresAt: null,
    }, 3, now)).toBe("bonus");
  });

  it.each([3, 4, 10])("blocks free users with no purchased checks at %i used", (used) => {
    expect(decideReadinessAccess({
      plan: "free",
      bonusReadinessChecks: 0,
      subscriptionExpiresAt: null,
    }, used, now)).toBe("denied");
  });

  it("unlocks unlimited checks only while a Pro subscription is active", () => {
    expect(decideReadinessAccess({
      plan: "pro",
      bonusReadinessChecks: 0,
      subscriptionExpiresAt: new Date("2026-10-01T00:00:00Z"),
    }, 10_000, now)).toBe("pro");
    expect(decideReadinessAccess({
      plan: "pro",
      bonusReadinessChecks: 0,
      subscriptionExpiresAt: new Date("2026-09-30T11:59:59Z"),
    }, 3, now)).toBe("denied");
  });
});