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
  privacyCodeMail: vi.fn(),
  createPrivacyCode: vi.fn(),
  verifyPrivacyCode: vi.fn(),
  consumePrivacyProof: vi.fn(),
  clearPrivacyCode: vi.fn(),
  archive: vi.fn(),
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
vi.mock("../../lib/email", () => ({
  sendSupportTicketNotification: fixtures.mail,
  sendPrivacyReauthenticationCode: fixtures.privacyCodeMail,
}));
vi.mock("../../lib/privacyReauthentication", () => ({
  PERSONAL_DATA_REAUTH_PURPOSE: "personal_data",
  createPrivacyEmailCode: fixtures.createPrivacyCode,
  verifyPrivacyEmailCode: fixtures.verifyPrivacyCode,
  consumePrivacyEmailProof: fixtures.consumePrivacyProof,
  clearPrivacyEmailCode: fixtures.clearPrivacyCode,
  getPrivacyAuthenticationBinding: (req: any) => {
    const authorization = req.get("authorization");
    const cookie = req.get("cookie");
    return authorization?.startsWith("Bearer ") ? "fixture-auth-binding" : cookie ? "fixture-cookie-binding" : null;
  },
}));
vi.mock("../../lib/privacyExport/service", () => ({ buildPersonalDataArchive: fixtures.archive }));
vi.mock("../../lib/accountDeletion/crypto", () => ({
  encryptDeletionResource: () => { throw new Error("Fixture: encryption not provisioned"); },
}));

const { default: privacyRouter } = await import("../../routes/privacy");
const { verifyPrivacyReauthentication, isPrivacyNotificationAllowed } = await import("../../lib/privacyAccess");
const actor = {
  id: "fixture-privacy-user", role: "candidate", passwordHash: "fixture-hash", suspendedAt: null,
  email: "fixture@privacy.invalid", emailVerified: true,
};
const fixtureProofToken = "privacy-proof-fixture-token-value-1234567890abcdef";
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
  fixtures.privacyCodeMail.mockResolvedValue(undefined);
  fixtures.createPrivacyCode.mockResolvedValue("123456");
  fixtures.verifyPrivacyCode.mockResolvedValue(fixtureProofToken);
  fixtures.consumePrivacyProof.mockResolvedValue(true);
  fixtures.clearPrivacyCode.mockResolvedValue(undefined);
  fixtures.execute.mockResolvedValue({ rows: [{ count: 1 }] });
  fixtures.deletedWhere.mockResolvedValue({});
  fixtures.mail.mockResolvedValue({ success: true });
  fixtures.archive.mockResolvedValue(Buffer.from("fixture-private-archive"));
});

describe("account-bound privacy routes (fixtures only)", () => {
  it("delivers a private attachment only after password verification and fresh account checks", async () => {
    for (let i = 0; i < 6; i++) freshActor();
    const response = await action("post", "export").send({ expectedAccountId: actor.id, password: "fixture-password", confirmed: true });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toContain('attachment; filename="JOBSAGE-personal-data.zip"');
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(fixtures.archive).toHaveBeenCalledWith(actor.id);
    expect(fixtures.mail).not.toHaveBeenCalled();
  });
  it("does not prepare a file when password verification fails", async () => {
    freshActor(); freshActor(); freshActor(); freshActor();
    fixtures.compare.mockResolvedValue(false);
    expect((await action("post", "export").send({ expectedAccountId: actor.id, password: "wrong-password", confirmed: true })).status).toBe(403);
    expect(fixtures.archive).not.toHaveBeenCalled();
  });
  it("discards prepared bytes if the account was quarantined during preparation", async () => {
    for (let i = 0; i < 5; i++) freshActor();
    fixtures.reads.push([{ ...actor, suspendedAt: new Date() }]);
    expect((await action("post", "export").send({ expectedAccountId: actor.id, password: "fixture-password", confirmed: true })).status).toBe(403);
  });
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
    freshActor();
    const response = await request(app).get("/api/privacy/settings");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      userId: actor.id, marketing: false, deletionEnabled: false,
      reauthenticationMethod: "password", notifications: { jobAlerts: true },
    });
    expect(JSON.stringify(response.body)).not.toContain("fixture-hash");
  });

  it("exposes email-code reauthentication only for verified passwordless accounts", async () => {
    const passwordless = { ...actor, passwordHash: null };
    fixtures.reads.push([passwordless], [], [passwordless]);
    const eligible = await request(app).get("/api/privacy/settings");
    expect(eligible.status).toBe(200);
    expect(eligible.body.reauthenticationMethod).toBe("email_code");

    const unverified = { ...passwordless, emailVerified: false };
    fixtures.reads.push([unverified], [], [unverified]);
    const unavailable = await request(app).get("/api/privacy/settings");
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.reauthenticationMethod).toBe("unavailable");
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
    freshActor(); freshActor(); freshActor(); freshActor(); freshActor();
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

  it("sends a one-time code only to a verified passwordless account and issues a short-lived proof", async () => {
    const passwordless = { ...actor, passwordHash: null };
    fixtures.reads.push([passwordless], [passwordless]);
    const started = await action("post", "reauthentication/start").send({
      expectedAccountId: actor.id, purpose: "personal_data",
    });
    expect(started.status).toBe(202);
    expect(fixtures.createPrivacyCode).toHaveBeenCalledWith(expect.objectContaining({
      accountId: actor.id, email: actor.email, sessionBinding: "fixture-auth-binding",
    }));
    expect(fixtures.privacyCodeMail).toHaveBeenCalledWith(actor.email, "123456");

    fixtures.reads.push([passwordless], [passwordless]);
    const verified = await action("post", "reauthentication/verify").send({
      expectedAccountId: actor.id, purpose: "personal_data", code: "123456",
    });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ verified: true, proofToken: fixtureProofToken, expiresInSeconds: 300 });
    expect(fixtures.verifyPrivacyCode).toHaveBeenCalledWith(expect.objectContaining({
      accountId: actor.id, email: actor.email, code: "123456", sessionBinding: "fixture-auth-binding",
    }));
  });

  it("accepts a passwordless export proof once and rejects a wrong email code", async () => {
    const passwordless = { ...actor, passwordHash: null };
    for (let i = 0; i < 6; i++) fixtures.reads.push([passwordless]);
    const exported = await action("post", "export").send({
      expectedAccountId: actor.id, emailCodeProof: fixtureProofToken, confirmed: true,
    });
    expect(exported.status).toBe(200);
    expect(fixtures.consumePrivacyProof).toHaveBeenCalledWith(expect.objectContaining({
      accountId: actor.id, email: actor.email, proofToken: fixtureProofToken,
    }));

    fixtures.verifyPrivacyCode.mockResolvedValueOnce(null);
    fixtures.reads.push([passwordless], [passwordless]);
    const rejected = await action("post", "reauthentication/verify").send({
      expectedAccountId: actor.id, purpose: "personal_data", code: "000000",
    });
    expect(rejected.status).toBe(403);
  });

  it("rejects an export request that supplies both reauthentication methods", async () => {
    freshActor();
    const response = await action("post", "export").send({
      expectedAccountId: actor.id,
      password: "fixture-password",
      emailCodeProof: fixtureProofToken,
      confirmed: true,
    });
    expect(response.status).toBe(400);
    expect(fixtures.archive).not.toHaveBeenCalled();
    expect(fixtures.consumePrivacyProof).not.toHaveBeenCalled();
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
