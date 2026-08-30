import { beforeEach, describe, expect, it, vi } from "vitest";

const dbSelectResults: unknown[][] = [];

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      set() { return chain; },
      values() { return chain; },
      returning() { return Promise.resolve([]); },
      then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(dbSelectResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }
  return {
    db: { select: () => makeChain(), update: () => makeChain() },
    speculativeApplicationsTable: {},
    speculativeApplicationDeliveryAttemptsTable: {},
    employerProfilesTable: {},
    sponsorLicencesTable: {},
    documentsTable: {},
    candidateMessagesTable: {},
    usersTable: {},
  };
});

const openAiCreate = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { responses: { create: openAiCreate } },
}));

const { resolveEmployerRecipient } = await import("../../routes/speculativeApplications");

beforeEach(() => {
  dbSelectResults.length = 0;
  openAiCreate.mockReset();
});

describe("resolveEmployerRecipient", () => {
  it("prefers a stored sponsor contact email", async () => {
    dbSelectResults.push([{ contactEmail: "contact@sponsor.co.uk" }]);

    await expect(resolveEmployerRecipient("Sponsor Corp", 42)).resolves.toEqual({
      email: "contact@sponsor.co.uk",
      route: "sponsor_contact_email",
    });
  });

  it("uses a stored employer-profile contact email before an account email", async () => {
    dbSelectResults.push([]);
    dbSelectResults.push([{ contactEmail: "jobs@example.org", empUserId: "emp-1" }]);

    await expect(resolveEmployerRecipient("Example Employer", null)).resolves.toEqual({
      email: "jobs@example.org",
      route: "employer_contact_email",
    });
  });

  it("uses a JOBSAGE employer account when no stored contact email exists", async () => {
    dbSelectResults.push([]);
    dbSelectResults.push([{ contactEmail: null, empUserId: "emp-1" }]);
    dbSelectResults.push([{ email: "hr@acme.com" }]);

    await expect(resolveEmployerRecipient("Acme Ltd", null)).resolves.toEqual({
      email: "hr@acme.com",
      route: "employer_account",
    });
  });

  it("falls back to ops without invoking AI contact enrichment", async () => {
    dbSelectResults.push([]);
    dbSelectResults.push([]);

    await expect(resolveEmployerRecipient("Unknown Co", null)).resolves.toEqual({
      email: "ops@jobsage.co.uk",
      route: "ops_fallback",
    });
    expect(openAiCreate).not.toHaveBeenCalled();
  });
});