/**
 * Tests for the speculative application recipient resolution logic,
 * with particular focus on the AI enrichment timeout race condition.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────

const dbSelectResults: any[][] = [];
const updateCalls: any[] = [];

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      set(values: any) { updateCalls.push(values); return chain; },
      values() { return chain; },
      catch() { return chain; },
      returning() { return Promise.resolve([]); },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbSelectResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(),
      update: () => makeChain(),
    },
    employerProfilesTable: {},
    usersTable: {},
    sponsorLicencesTable: {},
  };
});

// ── OpenAI mock — controller settled per-test ──────────────────────────────────

let createResolve: ((v: { output_text: string }) => void) | null = null;

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    responses: {
      create: vi.fn(
        () => new Promise<{ output_text: string }>((resolve) => { createResolve = resolve; }),
      ),
    },
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────────────

const { resolveEmployerRecipient } = await import("../../routes/speculativeApplications");
const OPS_INBOX = "ops@jobsage.co.uk";

beforeEach(() => {
  dbSelectResults.length = 0;
  updateCalls.length = 0;
  createResolve = null;
  vi.clearAllMocks();
});

/** Push one DB result row-set (array of row objects). */
function pushDb(rows: any[] = []) {
  dbSelectResults.push(rows);
}

/** Wait until the OpenAI mock's `create()` has been called and the resolver is available. */
async function waitForCreate(timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!createResolve) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for openai.responses.create()");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ── Step 1: employer account ───────────────────────────────────────────────────

describe("resolveEmployerRecipient — employer account", () => {
  it("returns employer_account route when employer has a JOBSAGE account", async () => {
    pushDb([{ empUserId: "emp-1" }]);   // employer profile lookup
    pushDb([{ email: "hr@acme.com" }]); // users lookup

    const result = await resolveEmployerRecipient("Acme Ltd", null);

    expect(result.route).toBe("employer_account");
    expect(result.email).toBe("hr@acme.com");
  });
});

// ── Step 2: sponsor contact email ─────────────────────────────────────────────

describe("resolveEmployerRecipient — sponsor licence contact email", () => {
  it("returns sponsor_contact_email when stored contactEmail exists", async () => {
    pushDb([]);                                              // no employer profile
    pushDb([{ contactEmail: "contact@sponsor.co.uk" }]);    // licence row

    const result = await resolveEmployerRecipient("Sponsor Corp", 42);

    expect(result.route).toBe("sponsor_contact_email");
    expect(result.email).toBe("contact@sponsor.co.uk");
  });
});

// ── Step 3: AI enrichment ─────────────────────────────────────────────────────

describe("resolveEmployerRecipient — AI enrichment", () => {
  it("returns ai_enrichment route when OpenAI finds a contact email before timeout", async () => {
    pushDb([]);                           // no employer profile
    pushDb([{ contactEmail: null }]);     // licence row, no stored email
    pushDb([{ id: 42, organisationName: "Target Ltd", townCity: "London", county: null }]); // full licence

    const resultPromise = resolveEmployerRecipient("Target Ltd", 42, 5000);

    // Wait until openai.responses.create has actually been called inside the helper
    await waitForCreate();
    createResolve!({ output_text: '{"contactEmail":"info@target.co.uk","website":null,"contactPhone":null,"address":null}' });

    const result = await resultPromise;
    expect(result.route).toBe("ai_enrichment");
    expect(result.email).toBe("info@target.co.uk");
  });
});

// ── Timeout race condition ─────────────────────────────────────────────────────

describe("resolveEmployerRecipient — timeout race", () => {
  it("falls back to ops_fallback when timeout fires before AI, even if AI later resolves", async () => {
    pushDb([]);                           // no employer profile
    pushDb([{ contactEmail: null }]);     // licence row, no stored email
    pushDb([{ id: 99, organisationName: "Slow Corp", townCity: null, county: null }]); // full licence

    // 1 ms timeout — race resolves (to null) before the AI mock is settled
    const resultPromise = resolveEmployerRecipient("Slow Corp", 99, 1);

    // Give the function time to start the enrichment IIFE and reach the AI call
    await waitForCreate();

    // Let the timeout fire (add extra buffer)
    await new Promise((r) => setTimeout(r, 30));

    // Now resolve the AI call — this is AFTER the timeout has already won
    createResolve!({ output_text: '{"contactEmail":"late@slowcorp.com","website":null,"contactPhone":null,"address":null}' });

    const result = await resultPromise;

    // The late AI response must NOT flip the route to ai_enrichment
    expect(result.route).toBe("ops_fallback");
    expect(result.email).toBe(OPS_INBOX);
  });

  it("needsAdminAction is implied (route is ops_fallback) when AI never resolves within timeout", async () => {
    pushDb([]);                           // no employer profile
    pushDb([{ contactEmail: null }]);     // no stored email
    pushDb([{ id: 77, organisationName: "Ghost Ltd", townCity: null, county: null }]);

    // Very short timeout; AI is never resolved
    const resultPromise = resolveEmployerRecipient("Ghost Ltd", 77, 1);

    await waitForCreate();
    await new Promise((r) => setTimeout(r, 30));
    // Do NOT call createResolve — simulate AI hanging forever

    const result = await resultPromise;

    // ops_fallback is the trigger for needsAdminAction in the POST handler
    expect(result.route).toBe("ops_fallback");
    expect(result.email).toBe(OPS_INBOX);
  });
});

// ── Step 4: ops fallback when no licence ID ───────────────────────────────────

describe("resolveEmployerRecipient — ops fallback", () => {
  it("falls back to ops when no sponsorLicenceId and no employer account found", async () => {
    pushDb([]);  // no employer profile

    const result = await resolveEmployerRecipient("Unknown Co", null);

    expect(result.route).toBe("ops_fallback");
    expect(result.email).toBe(OPS_INBOX);
  });
});
