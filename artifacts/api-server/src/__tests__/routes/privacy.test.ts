import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  reads: [] as unknown[][],
  values: vi.fn(),
  deletedWhere: vi.fn(),
  execute: vi.fn(),
  compare: vi.fn(),
  mail: vi.fn(),
  auth: true,
  impersonating: false,
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  const select = () => {
    const result = fixtures.reads.shift() ?? [];
    const chain: any = {
      from: () => chain, where: () => chain,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  const insert = () => {
    const chain: any = {
      values: (value: unknown) => { fixtures.values(value); return chain; },
      onConflictDoUpdate: () => Promise.resolve(),
      then: (resolve: any, reject: any) => Promise.resolve().then(resolve, reject),
    };
    return chain;
  };
  const tx = { select, insert, execute: fixtures.execute };
  return {
    ...schema,
    db: {
      ...tx,
      transaction: (callback: any) => callback(tx),
      delete: () => ({ where: fixtures.deletedWhere }),
    },
  };
});
vi.mock("bcryptjs", () => ({ default: { compare: fixtures.compare } }));
vi.mock("../../lib/email", () => ({ sendSupportTicketNotification: fixtures.mail }));
vi.mock("../../lib/accountDeletion/crypto", () => ({
  encryptDeletionResource: () => { throw new Error("Fixture: encryption not provisioned"); },
}));

const { default: privacyRouter } = await import("../../routes/privacy");
const { verifyPrivacyReauthentication, isPrivacyNotificationAllowed } = await import("../../lib/privacyAccess");
const actor = { id: "fixture-privacy-user", role: "candidate", passwordHash: "fixture-hash", suspendedAt: null };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = fixtures.auth ? actor as any : undefined;
  req.isImpersonating = fixtures.impersonating;
  req.log = { warn: vi.fn() } as any;
  next();
});
app.use("/api", privacyRouter);
const action = (method: "patch" | "post" | "delete", path: string) =>
  request(app)[method](`/api/privacy/${path}`)
    .set("Authorization", "Bearer fixture-session")
    .set("x-jobsage-privacy-account", actor.id);
const freshActor = () => fixtures.reads.push([{ ...actor }]);

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.reads.length = 0;
  fixtures.auth = true;
  fixtures.impersonating = false;
  fixtures.compare.mockResolvedValue(true);
  fixtures.execute.mockResolvedValue({ rows: [{ count: 1 }] });
  fixtures.deletedWhere.mockResolvedValue({});
  fixtures.mail.mockResolvedValue({ success: true });
});

describe("account-bound privacy routes (fixtures only)", () => {
  it("requires sign-in and rejects impersonation without writes", async () => {
    fixtures.auth = false;
    expect((await request(app).get("/api/privacy/settings")).status).toBe(401);
    fixtures.auth = true;
    fixtures.impersonating = true;
    expect((await action("delete", "smart-apply-drafts").send({ confirmed: true })).status).toBe(403);
    expect(fixtures.deletedWhere).not.toHaveBeenCalled();
  });

  it("rejects a stale suspended actor", async () => {
    fixtures.reads.push([{ ...actor, suspendedAt: new Date() }]);
    expect((await action("patch", "settings").send({ marketing: false })).status).toBe(403);
    expect(fixtures.values).not.toHaveBeenCalled();
  });

  it("rejects account/header mismatch and untrusted browser origins", async () => {
    expect((await action("patch", "settings").set("x-jobsage-privacy-account", "other-account").send({ marketing: true })).status).toBe(403);
    expect((await action("patch", "settings").set("Origin", "https://attacker.invalid").send({ marketing: true })).status).toBe(403);
    expect(fixtures.values).not.toHaveBeenCalled();
  });

  it("returns defaults without exposing credentials or push tokens", async () => {
    freshActor();
    fixtures.reads.push([]);
    const response = await request(app).get("/api/privacy/settings");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userId: actor.id, marketing: false, deletionEnabled: false, notifications: { jobAlerts: true } });
    expect(JSON.stringify(response.body)).not.toContain("fixture-hash");
  });

  it("merges a notification update without erasing other saved choices", async () => {
    freshActor();
    fixtures.reads.push([{ marketing: false, optionalAnalytics: false, notifications: { messages: false } }]);
    const response = await action("patch", "settings").send({ notifications: { jobAlerts: false } });
    expect(response.status).toBe(200);
    expect(fixtures.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: actor.id, notifications: { messages: false, jobAlerts: false },
    }));
  });

  it("requires explicit confirmation before either destructive sub-action", async () => {
    freshActor();
    expect((await action("delete", "smart-apply-drafts").send({ confirmed: false })).status).toBe(400);
    freshActor();
    expect((await action("delete", "push-device").send({})).status).toBe(400);
    expect(fixtures.deletedWhere).not.toHaveBeenCalled();
  });

  it("restricts confirmed draft clearing to exactly the signed-in account", async () => {
    freshActor();
    expect((await action("delete", "smart-apply-drafts").send({ confirmed: true })).status).toBe(200);
    const condition = new PgDialect().sqlToQuery(fixtures.deletedWhere.mock.calls[0][0]);
    expect(condition.sql).toContain('"smart_apply_drafts"."user_id"');
    expect(condition.params).toEqual([actor.id]);
  });

  it("records only a reauthenticated export-request receipt, not an export", async () => {
    freshActor(); freshActor(); freshActor();
    fixtures.reads.push([{ email: "fixture@privacy.invalid", firstName: "Fixture", lastName: "User" }]);
    const response = await action("post", "data-request").send({ expectedAccountId: actor.id, password: "fixture-password", confirmed: true });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "requested", ticketId: expect.stringMatching(/^JS-/) });
    expect(response.body.message).toContain("not a completed export");
    expect(fixtures.values).toHaveBeenCalledWith(expect.objectContaining({ userId: actor.id, email: "fixture@privacy.invalid" }));
    expect(fixtures.deletedWhere).not.toHaveBeenCalled();
  });

  it("rejects changed-account export requests and rate-limits password challenges", async () => {
    freshActor();
    expect((await action("post", "data-request").send({ expectedAccountId: "other-account", password: "fixture", confirmed: true })).status).toBe(403);
    freshActor();
    fixtures.execute.mockResolvedValue({ rows: [{ count: 6 }] });
    expect((await action("post", "data-request").send({ expectedAccountId: actor.id, password: "fixture", confirmed: true })).status).toBe(429);
    expect(fixtures.compare).not.toHaveBeenCalled();
    expect(fixtures.values).not.toHaveBeenCalled();
  });

  it("fails push registration closed when secure encryption is unavailable", async () => {
    freshActor();
    const response = await action("post", "push-device").send({ token: "ExpoPushToken[fixture-token]", platform: "ios" });
    expect(response.status).toBe(503);
    expect(fixtures.values).not.toHaveBeenCalled();
  });
});

describe("fresh-account checks", () => {
  it("rejects password or account changes during reauthentication", async () => {
    const read = vi.fn().mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, passwordHash: "changed" });
    await expect(verifyPrivacyReauthentication({
      signedInId: actor.id, expectedAccountId: actor.id, password: "fixture", impersonating: false, confirmed: true,
    }, read)).rejects.toThrow();
  });

  it("blocks notifications for quarantined accounts", async () => {
    fixtures.reads.push([{ ...actor, suspendedAt: new Date() }]);
    expect(await isPrivacyNotificationAllowed(actor.id, "jobAlerts")).toBe(false);
  });

  it("honours an opt-out and preserves defaults for accounts with no preference row", async () => {
    freshActor(); fixtures.reads.push([{ notifications: { jobAlerts: false } }]);
    expect(await isPrivacyNotificationAllowed(actor.id, "jobAlerts")).toBe(false);
    freshActor(); fixtures.reads.push([]);
    expect(await isPrivacyNotificationAllowed(actor.id, "jobAlerts")).toBe(true);
  });
});
