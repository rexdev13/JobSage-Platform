import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { proofHash, exchangeKey, consumeMobileGrant, issueMobileGrant } from "../lib/mobileSessionExchange";

const state = vi.hoisted(() => ({
  records: new Map<string, any>(), session: null as any, account: null as any, writes: [] as any[],
  tail: Promise.resolve() as Promise<unknown>,
}));
vi.mock("../lib/auth", () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock("@workspace/db", async () => {
  const { pgTable, text, jsonb, timestamp, boolean } = await import("drizzle-orm/pg-core");
  const sessionsTable = pgTable("test_sessions", {
    sid: text("sid"), sess: jsonb("sess"), expire: timestamp("expire"),
  });
  const usersTable = pgTable("test_users", {
    id: text("id"), suspendedAt: timestamp("suspended_at"), emailVerified: boolean("email_verified"),
    role: text("role"), email: text("email"), firstName: text("first_name"),
    lastName: text("last_name"), profileImageUrl: text("profile_image_url"),
  });
  const db: any = {
    execute: vi.fn(async (statement: any) => {
      const query = new PgDialect().sqlToQuery(statement);
      if (query.sql.startsWith("DELETE")) {
        const matching = [...state.records.values()].filter(record =>
          query.params.includes(record.sess.userId) && query.params.includes(record.sess.audience))
          .sort((a, b) => b.expire.getTime() - a.expire.getTime());
        for (const record of matching.slice(7)) state.records.delete(record.sid);
      }
    }),
    insert: () => ({ values: async (record: any) => {
      state.writes.push(record); state.records.set(record.sid, record);
    } }),
    delete: () => ({ where: (condition: any) => {
      const query = new PgDialect().sqlToQuery(condition);
      return {
        returning: async () => {
          const key = query.params.find(value => typeof value === "string" && value.startsWith("mobile-exchange:"));
          const record = state.records.get(key as string);
          if (!record || record.expire <= new Date() || !query.params.includes(record.sess.challenge)
            || !query.params.includes(record.sess.audience)) return [];
          state.records.delete(key as string);
          return [{ sess: record.sess }];
        },
        then: (resolve: (value: undefined) => void) => {
          for (const [key, record] of state.records) {
            if (query.params.includes(record.sess.userId) && query.params.includes(record.sess.audience)
              && record.expire <= new Date()) state.records.delete(key);
          }
          resolve(undefined);
        },
      };
    } }),
    select: () => ({ from: () => ({ where: async () => state.account ? [state.account] : [] }) }),
  };
  db.transaction = (callback: (tx: any) => Promise<unknown>) => {
    const task = state.tail.then(() => callback(db));
    state.tail = task.catch(() => {});
    return task;
  };
  return { db, sessionsTable, usersTable };
});

describe("single-use mobile session exchanges (isolated synthetic store)", () => {
  const verifier = "v".repeat(64);
  beforeEach(() => {
    state.records.clear(); state.writes.length = 0; state.tail = Promise.resolve();
    state.session = { user: { id: "synthetic-candidate", role: "candidate" } };
    state.account = { id: "synthetic-candidate", emailVerified: true, role: "candidate" };
  });
  async function grant(audience: "native" | "web" = "native") {
    return issueMobileGrant("original-session", "synthetic-candidate", proofHash(verifier), audience, "/profile");
  }
  it("stores a hashed code rather than the redeemable code or verifier", async () => {
    const result = await grant();
    expect(state.writes[0].sid).toBe(exchangeKey(result.code));
    expect(JSON.stringify(state.writes[0])).not.toContain(verifier);
    expect(state.writes[0].sid).not.toBe(result.code);
    expect(new Date(result.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60000);
  });
  it("claims atomically and cannot replay or simultaneously redeem twice", async () => {
    const result = await grant();
    const responses = await Promise.all([
      consumeMobileGrant(result.code, verifier, "native"), consumeMobileGrant(result.code, verifier, "native"),
    ]);
    expect(responses.filter(Boolean)).toHaveLength(1);
    expect(await consumeMobileGrant(result.code, verifier, "native")).toBeNull();
  });
  it("wrong proof and wrong audience do not burn a valid grant", async () => {
    const result = await grant();
    expect(await consumeMobileGrant(result.code, "bad".repeat(20), "native")).toBeNull();
    expect(await consumeMobileGrant(result.code, verifier, "web")).toBeNull();
    expect(await consumeMobileGrant(result.code, verifier, "native")).not.toBeNull();
  });
  it("allows concurrent device exchanges but bounds outstanding grants", async () => {
    const first = await grant();
    const second = await grant();
    expect(await consumeMobileGrant(first.code, verifier, "native")).not.toBeNull();
    expect(await consumeMobileGrant(second.code, verifier, "native")).not.toBeNull();
    await Promise.all(Array.from({ length: 12 }, () => grant()));
    expect(state.records.size).toBe(8);
  });
  it("rejects expired grants", async () => {
    const result = await grant();
    state.records.get(exchangeKey(result.code)).expire = new Date(0);
    expect(await consumeMobileGrant(result.code, verifier, "native")).toBeNull();
  });
  it.each(["revoked", "impersonating", "different-owner", "suspended", "unverified", "role-changed"])(
    "rechecks live original session and account: %s", async condition => {
      const result = await grant();
      if (condition === "revoked") state.session = null;
      if (condition === "impersonating") state.session.impersonating = true;
      if (condition === "different-owner") state.session.user.id = "other";
      if (condition === "suspended") state.account.suspendedAt = new Date();
      if (condition === "unverified") state.account.emailVerified = false;
      if (condition === "role-changed") state.account.role = "employer";
      expect(await consumeMobileGrant(result.code, verifier, "native")).toBeNull();
    });
  it("rejects external redirect destinations before storing a grant", async () => {
    await expect(issueMobileGrant("session", "synthetic", proofHash(verifier), "web", "//evil.example")).rejects.toThrow();
    expect(state.records.size).toBe(0);
  });
});
