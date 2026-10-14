import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  execute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: fixtures.execute,
    transaction: (callback: (tx: { execute: typeof fixtures.execute }) => unknown) =>
      callback({ execute: fixtures.execute }),
  },
}));

const dialect = new PgDialect();
const sqlText = (query: unknown) => dialect.sqlToQuery(query as never);

fixtures.execute.mockImplementation(async (query: unknown) => {
  const { sql, params } = sqlText(query);
  if (sql.includes("SELECT pg_advisory_xact_lock")) return { rows: [] };
  if (sql.includes("INSERT INTO user_sessions")) {
    fixtures.sessions.set(String(params[0]), JSON.parse(String(params[1])) as Record<string, unknown>);
    return { rows: [] };
  }
  if (sql.includes("SELECT sess FROM user_sessions")) {
    const state = fixtures.sessions.get(String(params[0]));
    return { rows: state ? [{ sess: state }] : [] };
  }
  if (sql.includes("UPDATE user_sessions")) {
    const state = fixtures.sessions.get(String(params[1]));
    if (state) state.attempts = Number(params[0]);
    return { rows: [] };
  }
  if (sql.includes("DELETE FROM user_sessions")) {
    const state = fixtures.sessions.get(String(params[0]));
    fixtures.sessions.delete(String(params[0]));
    return { rows: sql.includes("RETURNING sess") && state ? [{ sess: state }] : [] };
  }
  throw new Error(`Unexpected fixture SQL: ${sql}`);
});

const {
  clearAccountDeletionEmailCode,
  consumeAccountDeletionEmailProof,
  createAccountDeletionEmailCode,
  verifyAccountDeletionEmailCode,
} = await import("../lib/accountDeletion/reauthentication");
const {
  consumePrivacyEmailProof,
  createPrivacyEmailCode,
  verifyPrivacyEmailCode,
} = await import("../lib/privacyReauthentication");

const originalSessionSecret = process.env.SESSION_SECRET;

beforeEach(() => {
  fixtures.sessions.clear();
  process.env.SESSION_SECRET = "fixture-only-session-secret-for-deletion-reauthentication";
});

afterEach(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

describe("account-deletion-specific passwordless reauthentication", () => {
  it("binds the challenge to the current credential, account, verified email, and deletion purpose", async () => {
    const input = { sessionBinding: "fixture-credential-a", accountId: "fixture-account-a", email: "A@privacy.invalid" };
    const code = await createAccountDeletionEmailCode(input);
    expect(code).toMatch(/^\d{6}$/);

    const wrongCode = code === "000000" ? "000001" : "000000";
    await expect(verifyAccountDeletionEmailCode({ ...input, code: wrongCode })).resolves.toBeNull();
    expect([...fixtures.sessions.values()][0]?.attempts).toBe(1);
    await expect(verifyAccountDeletionEmailCode({ ...input, sessionBinding: "fixture-credential-b", code })).resolves.toBeNull();
    await expect(verifyAccountDeletionEmailCode({ ...input, accountId: "fixture-account-b", code })).resolves.toBeNull();
    await expect(verifyAccountDeletionEmailCode({ ...input, email: "changed@privacy.invalid", code })).resolves.toBeNull();
  });

  it("issues an account-bound proof and consumes it exactly once", async () => {
    const input = {
      sessionBinding: "fixture-credential-a",
      accountId: "fixture-account-a",
      email: "candidate@privacy.invalid",
    };
    const code = await createAccountDeletionEmailCode(input);
    const proofToken = await verifyAccountDeletionEmailCode({ ...input, code });
    expect(proofToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    await expect(consumeAccountDeletionEmailProof({
      proofToken: proofToken!,
      accountId: "fixture-account-b",
      email: input.email,
    })).resolves.toBe(false);

    // A proof is burned on any consumption attempt, even one with a mismatched account.
    const nextCode = await createAccountDeletionEmailCode(input);
    const nextProof = await verifyAccountDeletionEmailCode({ ...input, code: nextCode });
    await expect(consumeAccountDeletionEmailProof({
      proofToken: nextProof!,
      accountId: input.accountId,
      email: input.email.toUpperCase(),
    })).resolves.toBe(true);
    await expect(consumeAccountDeletionEmailProof({
      proofToken: nextProof!,
      accountId: input.accountId,
      email: input.email,
    })).resolves.toBe(false);
  });

  it("cannot exchange or consume a personal-data proof as a deletion proof, or vice versa", async () => {
    const input = {
      sessionBinding: "fixture-credential-a",
      accountId: "fixture-account-a",
      email: "candidate@privacy.invalid",
    };
    const personalDataCode = await createPrivacyEmailCode(input);
    await expect(verifyAccountDeletionEmailCode({ ...input, code: personalDataCode })).resolves.toBeNull();
    const personalDataProof = await verifyPrivacyEmailCode({ ...input, code: personalDataCode });
    await expect(consumeAccountDeletionEmailProof({
      proofToken: personalDataProof!,
      accountId: input.accountId,
      email: input.email,
    })).resolves.toBe(false);

    const deletionCode = await createAccountDeletionEmailCode(input);
    await expect(verifyPrivacyEmailCode({ ...input, code: deletionCode })).resolves.toBeNull();
    const deletionProof = await verifyAccountDeletionEmailCode({ ...input, code: deletionCode });
    await expect(consumePrivacyEmailProof({
      proofToken: deletionProof!,
      accountId: input.accountId,
      email: input.email,
    })).resolves.toBe(false);
  });

  it("burns a challenge after five wrong codes and clears an unsent challenge", async () => {
    const input = {
      sessionBinding: "fixture-credential-a",
      accountId: "fixture-account-a",
      email: "candidate@privacy.invalid",
    };
    const code = await createAccountDeletionEmailCode(input);
    const wrongCode = code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      await verifyAccountDeletionEmailCode({ ...input, code: wrongCode });
    }
    expect(fixtures.sessions.size).toBe(0);

    await createAccountDeletionEmailCode(input);
    await clearAccountDeletionEmailCode({ sessionBinding: input.sessionBinding, accountId: input.accountId });
    expect(fixtures.sessions.size).toBe(0);
  });

  it("fails closed when the session secret is unavailable", async () => {
    delete process.env.SESSION_SECRET;
    await expect(createAccountDeletionEmailCode({
      sessionBinding: "fixture-credential-a",
      accountId: "fixture-account-a",
      email: "candidate@privacy.invalid",
    })).rejects.toThrow("unavailable");
  });
});
