import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  run: 0,
  selectCount: 0,
  insertCount: 0,
  updateCount: 0,
}));

vi.mock("@workspace/db", () => {
  const table = {
    id: "id",
    organisationName: "organisationName",
    title: "title",
    employer: "employer",
    email: "email",
  };

  function chain(kind: "select" | "insert" | "update", index: number): any {
    return {
      from() { return this; },
      where() { return this; },
      limit() { return this; },
      set() { return this; },
      values() { return this; },
      returning() {
        if (kind === "insert") return Promise.resolve([{ id: index === 0 ? 11 : 22 }]);
        return Promise.resolve([{ id: index === 0 ? 11 : 22 }]);
      },
      then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
        if (kind !== "select") return Promise.resolve([]).then(resolve, reject);
        const rows =
          state.run === 0
            ? []
            : index === 0
              ? [{ id: 11 }]
              : [{ id: 22 }];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
  }

  const tx = {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn(() => chain("select", state.selectCount++)),
    insert: vi.fn(() => chain("insert", state.insertCount++)),
    update: vi.fn(() => chain("update", state.updateCount++)),
  };

  return {
    db: {
      transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => {
        state.selectCount = 0;
        const result = await callback(tx);
        state.run += 1;
        return result;
      }),
    },
    candidateMatchScoresTable: table,
    rolesTable: table,
    sponsorLicencesTable: table,
    usersTable: table,
  };
});

const { seedTestEmailVacancy } = await import("../../lib/testEmailVacancySeed");

describe("test email vacancy seed", () => {
  beforeEach(() => {
    state.run = 0;
    state.selectCount = 0;
    state.insertCount = 0;
    state.updateCount = 0;
  });

  it("updates the same sponsor and role on a second run instead of duplicating them", async () => {
    const first = await seedTestEmailVacancy();
    const second = await seedTestEmailVacancy();

    expect(first).toEqual({ sponsorLicenceId: 11, roleId: 22, candidateUserId: null });
    expect(second).toEqual(first);
    expect(state.insertCount).toBe(2);
    expect(state.updateCount).toBe(2);
  });
});