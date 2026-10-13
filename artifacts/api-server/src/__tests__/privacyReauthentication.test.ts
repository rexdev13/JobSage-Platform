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

const { clearPrivacyEmailCode, consumePrivacyEmailProof, createPrivacyEmailCode, getPrivacyAuthenticationBinding, verifyPrivacyEmailCode } =
  await import("../lib/privacyReauthentication");

const originalSessionSecret = process.env.SESSION_SECRET;
beforeEach(() => {
  fixtures.sessions.clear();
  process.env.SESSION_SECRET = "fixture-only-session-secret-for-privacy-reauthentication";
});
afterEach(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

describe("passwordless privacy reauthentication", () => {
  it("binds a six-digit code to the account, verified address and authenticated credential", async () => {
    const input = { sessionBinding: "credential-a", accountId: "account-a", email: "A@privacy.invalid" };
    const code = await createPrivacyEmailCode(input);
    expect(code).toMatch(/^\d{6}$/);

    const wrongCode = code === "000000" ? "000001" : "000000";
    await expect(verifyPrivacyEmailCode({ ...input, code: wrongCode })).resolves.toBeNull();
    expect([...fixtures.sessions.values()][0]?.attempts).toBe(1);
    await expect(verifyPrivacyEmailCode({ ...input, sessionBinding: "credential-b", code })).resolves.toBeNull();
    await expect(verifyPrivacyEmailCode({ ...input, accountId: "account-b", code })).resolves.toBeNull();
    await expect(verifyPrivacyEmailCode({ ...input, email: "changed@privacy.invalid", code })).resolves.toBeNull();
  });

  it("issues an account-bound proof after the correct code and consumes it exactly once", async () => {
    const input = { sessionBinding: "credential-a", accountId: "account-a", email: "candidate@privacy.invalid" };
    const code = await createPrivacyEmailCode(input);
    const proofToken = await verifyPrivacyEmailCode({ ...input, code });
    expect(proofToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    await expect(consumePrivacyEmailProof({ proofToken: proofToken!, accountId: "account-b", email: input.email })).resolves.toBe(false);
    const nextCode = await createPrivacyEmailCode(input);
    const nextProof = await verifyPrivacyEmailCode({ ...input, code: nextCode });
    await expect(consumePrivacyEmailProof({ proofToken: nextProof!, accountId: input.accountId, email: input.email.toUpperCase() })).resolves.toBe(true);
    await expect(consumePrivacyEmailProof({ proofToken: nextProof!, accountId: input.accountId, email: input.email })).resolves.toBe(false);
  });

  it("burns a challenge after five incorrect codes and fails closed without the session secret", async () => {
    const input = { sessionBinding: "credential-a", accountId: "account-a", email: "candidate@privacy.invalid" };
    const code = await createPrivacyEmailCode(input);
    const wrongCode = code === "000000" ? "000001" : "000000";
    for (let attempt = 0; attempt < 5; attempt++) {
      await verifyPrivacyEmailCode({ ...input, code: wrongCode });
    }
    expect(fixtures.sessions.size).toBe(0);

    delete process.env.SESSION_SECRET;
    await expect(createPrivacyEmailCode(input)).rejects.toThrow("unavailable");
  });

  it("uses only a digest of the current bearer or cookie credential as the challenge binding", () => {
    const asRequest = (get: (name: string) => string | undefined) =>
      ({ get } as unknown as Parameters<typeof getPrivacyAuthenticationBinding>[0]);
    const bearerBinding = getPrivacyAuthenticationBinding(asRequest((name) => name === "authorization" ? "Bearer raw-token" : undefined));
    const cookieBinding = getPrivacyAuthenticationBinding(asRequest((name) => name === "cookie" ? "session=raw-cookie" : undefined));
    expect(bearerBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(cookieBinding).toMatch(/^[0-9a-f]{64}$/);
    expect(bearerBinding).not.toContain("raw-token");
    expect(bearerBinding).not.toBe(cookieBinding);
  });

  it("removes an unsent code challenge after delivery failure cleanup", async () => {
    const input = { sessionBinding: "credential-a", accountId: "account-a", email: "candidate@privacy.invalid" };
    await createPrivacyEmailCode(input);
    await clearPrivacyEmailCode({ sessionBinding: input.sessionBinding, accountId: input.accountId });
    expect(fixtures.sessions.size).toBe(0);
  });
});
