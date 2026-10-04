import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { rows, filters } = vi.hoisted(() => ({
  rows: [] as unknown[][],
  filters: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  return {
    ...schema,
    db: {
      select: () => {
        const result = rows.shift() ?? [];
        const chain: any = {
          from: () => chain,
          where: (condition: unknown) => { filters(condition); return chain; },
          limit: () => chain,
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
        };
        return chain;
      },
    },
  };
});

import { getReadinessQuota, reserveReadinessCheck } from "../../lib/readinessQuota";

describe("persisted readiness reset counting", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const resetAt = new Date("2026-10-04T09:00:00Z");
  beforeEach(() => { rows.length = 0; filters.mockReset(); });

  it.each(["snapshot", "reservation"])("applies the candidate reset to BOTH analysis tables for %s", async (operation) => {
    rows.push(
      [{ plan: "free", bonusReadinessChecks: 0, subscriptionExpiresAt: null, readinessQuotaResetAt: resetAt }],
      [{ count: 0 }],
      [{ count: 0 }],
    );
    const result = operation === "snapshot"
      ? await getReadinessQuota("reset-candidate", now)
      : await reserveReadinessCheck("reset-candidate", now);
    if (operation === "snapshot") expect(result).toMatchObject({ used: 0, limit: 3, bonusRemaining: 0 });
    else expect(result).toMatchObject({ allowed: true, bonusReserved: false });
    const countingQueries = filters.mock.calls.slice(1).map(([condition]) => new PgDialect().sqlToQuery(condition));
    expect(countingQueries).toHaveLength(2);
    for (const query of countingQueries) {
      expect(query.sql).toContain('"generated_at" >= ');
      expect(query.params).toEqual(["reset-candidate", resetAt.toISOString()]);
    }
  });
});