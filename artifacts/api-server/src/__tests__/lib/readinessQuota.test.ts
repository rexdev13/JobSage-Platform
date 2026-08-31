import { describe, expect, it } from "vitest";
import { getNextReadinessReset, getReadinessMonthStart } from "../../lib/readinessQuota";

describe("readiness monthly quota boundaries", () => {
  it("uses the first day of the current UTC month as the counting boundary", () => {
    expect(getReadinessMonthStart(new Date("2026-08-31T23:59:59Z")).toISOString())
      .toBe("2026-08-01T00:00:00.000Z");
  });

  it("resets at the first instant of the next UTC month, including year rollover", () => {
    expect(getNextReadinessReset(new Date("2026-12-15T12:00:00Z")).toISOString())
      .toBe("2027-01-01T00:00:00.000Z");
  });
});