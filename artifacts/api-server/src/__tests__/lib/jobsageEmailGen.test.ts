import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectResults, updateSets } = vi.hoisted(() => ({
  selectResults: [] as Array<Array<{ jobsageEmail: string | null }>>,
  updateSets: [] as Array<{ jobsageEmail: string }>,
}));

vi.mock("@workspace/db", () => {
  function selectChain(): any {
    const chain: any = {
      from: () => chain,
      where: () => Promise.resolve(selectResults.shift() ?? []),
    };
    return chain;
  }
  function updateChain(): any {
    const chain: any = {
      set: (value: { jobsageEmail: string }) => {
        updateSets.push(value);
        return chain;
      },
      where: () => Promise.resolve(),
    };
    return chain;
  }
  return {
    db: {
      select: () => selectChain(),
      update: () => updateChain(),
      execute: () => Promise.resolve(),
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => selectChain(),
        update: () => updateChain(),
        execute: () => Promise.resolve(),
      }),
    },
    usersTable: { id: {}, jobsageEmail: {} },
    profilesTable: { userId: {}, jobsageEmail: {} },
  };
});

const { ensureCanonicalJobsageAlias } = await import("../../lib/jobsageEmailGen");

describe("ensureCanonicalJobsageAlias", () => {
  beforeEach(() => {
    selectResults.length = 0;
    updateSets.length = 0;
  });

  it("keeps the user alias canonical and repairs a different profile copy", async () => {
    selectResults.push(
      [{ jobsageEmail: "canonical@mail.jobsage.app" }],
      [{ jobsageEmail: "old-profile@mail.jobsage.app" }],
    );

    await expect(ensureCanonicalJobsageAlias("candidate-1", "Jane", "Doe"))
      .resolves.toBe("canonical@mail.jobsage.app");
    expect(updateSets).toEqual([{ jobsageEmail: "canonical@mail.jobsage.app" }]);
  });

  it("promotes a legacy profile-only alias to the user record", async () => {
    selectResults.push(
      [{ jobsageEmail: null }],
      [{ jobsageEmail: "legacy@mail.jobsage.app" }],
    );

    await expect(ensureCanonicalJobsageAlias("candidate-1", "Jane", "Doe"))
      .resolves.toBe("legacy@mail.jobsage.app");
    expect(updateSets).toEqual([{ jobsageEmail: "legacy@mail.jobsage.app" }]);
  });

  it("generates one alias and synchronizes both records when neither has one", async () => {
    selectResults.push(
      [{ jobsageEmail: null }],
      [{ jobsageEmail: null }],
    );

    const alias = await ensureCanonicalJobsageAlias("candidate-1", "Jane", "Doe");

    expect(alias).toMatch(/^jane\.doe\.[a-f0-9]{6}@mail\.jobsage\.app$/);
    expect(updateSets).toEqual([
      { jobsageEmail: alias },
      { jobsageEmail: alias },
    ]);
  });
});