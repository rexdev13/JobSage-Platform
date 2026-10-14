import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const ACCOUNT_DELETION_REAUTH_PURPOSE = "account_deletion" as const;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("Account-deletion reauthentication is unavailable.");
  return secret;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emailDigest(email: string, secret: string): string {
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

function sessionDigest(sessionBinding: string, accountId: string): string {
  return hash(`${accountId}\0${sessionBinding}`);
}

function challengeSid(sessionBinding: string, accountId: string): string {
  return `account-deletion-code:${sessionDigest(sessionBinding, accountId)}`;
}

function proofSid(proofToken: string): string {
  return `account-deletion-proof:${hash(proofToken)}`;
}

function codeDigest(input: {
  code: string;
  sessionBinding: string;
  accountId: string;
  emailHash: string;
}, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${input.accountId}\0${input.sessionBinding}\0${ACCOUNT_DELETION_REAUTH_PURPOSE}\0${input.emailHash}\0${input.code}`)
    .digest("hex");
}

function constantTimeHexEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || !/^[0-9a-f]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function parseSession(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function createAccountDeletionEmailCode(input: {
  sessionBinding: string;
  accountId: string;
  email: string;
}): Promise<string> {
  if (!input.sessionBinding || !input.accountId || !input.email.trim()) {
    throw new Error("Account-deletion reauthentication is unavailable.");
  }
  const secret = getSessionSecret();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const emailHash = emailDigest(input.email, secret);
  const sid = challengeSid(input.sessionBinding, input.accountId);
  const state = {
    accountId: input.accountId,
    purpose: ACCOUNT_DELETION_REAUTH_PURPOSE,
    emailHash,
    codeHash: codeDigest({ ...input, code, emailHash }, secret),
    attempts: 0,
  };

  await db.execute(sql`
    INSERT INTO user_sessions(sid, sess, expire)
    VALUES (${sid}, ${JSON.stringify(state)}::jsonb, now() + interval '10 minutes')
    ON CONFLICT(sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
  `);
  return code;
}

export async function clearAccountDeletionEmailCode(input: {
  sessionBinding: string;
  accountId: string;
}): Promise<void> {
  await db.execute(sql`
    DELETE FROM user_sessions
    WHERE sid = ${challengeSid(input.sessionBinding, input.accountId)}
  `);
}

/** Exchange a matching deletion-only code for a random, five-minute, one-use proof. */
export async function verifyAccountDeletionEmailCode(input: {
  sessionBinding: string;
  accountId: string;
  email: string;
  code: string;
}): Promise<string | null> {
  if (!/^\d{6}$/.test(input.code)) return null;
  const secret = getSessionSecret();
  const emailHash = emailDigest(input.email, secret);
  const sid = challengeSid(input.sessionBinding, input.accountId);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`account-deletion-code:${sid}`}))`);
    const result = await tx.execute(sql`
      SELECT sess FROM user_sessions WHERE sid = ${sid} AND expire > now() FOR UPDATE
    `);
    const state = parseSession(result.rows[0]?.sess);
    if (!state) return null;

    const stateMatches =
      state.accountId === input.accountId &&
      state.purpose === ACCOUNT_DELETION_REAUTH_PURPOSE &&
      state.emailHash === emailHash;
    const suppliedHash = codeDigest({ ...input, emailHash }, secret);
    if (!stateMatches || !constantTimeHexEqual(state.codeHash, suppliedHash)) {
      const attempts = Number.isInteger(state.attempts) ? Number(state.attempts) + 1 : 1;
      if (attempts >= 5 || !stateMatches) {
        await tx.execute(sql`DELETE FROM user_sessions WHERE sid = ${sid}`);
      } else {
        await tx.execute(sql`
          UPDATE user_sessions
          SET sess = jsonb_set(sess, '{attempts}', to_jsonb(${attempts}::int))
          WHERE sid = ${sid}
        `);
      }
      return null;
    }

    const proofToken = randomBytes(32).toString("base64url");
    const proof = {
      accountId: input.accountId,
      purpose: ACCOUNT_DELETION_REAUTH_PURPOSE,
      emailHash,
    };
    await tx.execute(sql`DELETE FROM user_sessions WHERE sid = ${sid}`);
    await tx.execute(sql`
      INSERT INTO user_sessions(sid, sess, expire)
      VALUES (${proofSid(proofToken)}, ${JSON.stringify(proof)}::jsonb, now() + interval '5 minutes')
      ON CONFLICT(sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
    `);
    return proofToken;
  });
}

/** Atomically consumes a deletion-only proof; export and other privacy proofs cannot satisfy it. */
export async function consumeAccountDeletionEmailProof(input: {
  proofToken: string | undefined;
  accountId: string;
  email: string | null;
}): Promise<boolean> {
  if (!input.proofToken || input.proofToken.length < 40 || input.proofToken.length > 128 || !input.email) {
    return false;
  }
  const secret = getSessionSecret();
  const result = await db.execute(sql`
    DELETE FROM user_sessions
    WHERE sid = ${proofSid(input.proofToken)} AND expire > now()
    RETURNING sess
  `);
  const state = parseSession(result.rows[0]?.sess);
  return state?.accountId === input.accountId &&
    state.purpose === ACCOUNT_DELETION_REAUTH_PURPOSE &&
    state.emailHash === emailDigest(input.email, secret);
}
