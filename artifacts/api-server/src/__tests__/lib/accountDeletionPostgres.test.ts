import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
const fixture = vi.hoisted(() => ({
  existing: false, organisation: false, enabled: true,
  accountHash: "",
  claimedRow: null as Record<string, unknown> | null,
  account: { id: "fixture-candidate", role: "candidate", suspendedAt: null as Date | null },
  writes: [] as Array<{ table: string; operation: string; value?: unknown; where?: unknown }>,
}));
vi.mock("../../lib/accountDeletion/releaseReadiness", () => ({
  get DELETION_REQUESTS_ENABLED() { return fixture.enabled; },
}));
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  const chain = (rows: unknown[]) => {
    const value: any = { from: () => value, where: () => value, for: () => value, limit: () => value,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return value;
  };
  const select = () => ({
    from: (table: any) => {
      const name = getTableName(table);
      return chain(name === "users" ? [fixture.account]
        : name === "account_deletion_requests" && fixture.existing ? [{
          id: "fixture-request", accountHash: fixture.accountHash, requestedAt: new Date("2026-10-12T00:00:00Z"),
          outcome: "pending", completedAt: null,
        }]
        : name === "employer_profiles" && fixture.organisation ? [{ id: 1 }] : []);
    },
  });
  const insert = (table: any) => ({
    values: (value: any) => {
      fixture.writes.push({ table: getTableName(table), operation: "insert", value });
      const result: any = chain([...(Array.isArray(value) ? value : [{ ...value, completedAt: null }])]);
      result.returning = () => result;
      return result;
    },
  });
  const update = (table: any) => ({
    set: (value: unknown) => ({
      where: (where: unknown) => {
        fixture.writes.push({ table: getTableName(table), operation: "update", value, where });
        const result: any = chain([]); result.returning = () => result; return result;
      },
    }),
  });
  const remove = (table: any) => ({
    where: (where: unknown) => {
      fixture.writes.push({ table: getTableName(table), operation: "delete", where });
      return Promise.resolve();
    },
  });
  const tx = { select, insert, update, delete: remove, execute: vi.fn(async (query: SQL) => {
    const text = new PgDialect().sqlToQuery(query).sql;
    if (text.includes("SELECT t.request_id")) return { rows: fixture.claimedRow ? [{
      request_id: "fixture-request", resource_ciphertext: fixture.claimedRow.resource_ciphertext,
      account_hash: fixture.accountHash,
    }] : [] };
    if (text.includes("SELECT id, role, suspended_at")) return { rows: [{
      id: fixture.account.id, role: fixture.account.role, suspended_at: fixture.account.suspendedAt,
    }] };
    return { rows: text.includes("SELECT * FROM") && fixture.claimedRow ? [fixture.claimedRow] : [] };
  }) };
  return { ...actual, db: { ...tx, transaction: async (callback: (tx: any) => unknown) => callback(tx) } };
});
import { accountDeletionRequestsTable } from "@workspace/db";
import { PostgresDeletionStore } from "../../lib/accountDeletion/postgresStore";
import type { AcceptancePlan } from "../../lib/accountDeletion/engine";
import { accountDeletionHash, encryptDeletionResource } from "../../lib/accountDeletion/crypto";
import { revokeClaimedLocalCredentials } from "../../lib/accountDeletion/localCredentials";
const now = new Date("2026-10-12T00:00:00Z");
function plan(): AcceptancePlan {
  return { actor: { id: "fixture-candidate", role: "candidate", impersonating: false, confirmed: true, reauthenticatedAt: now },
    accountHash: fixture.accountHash, ownership: [], tasks: [{ kind: "active_data",
      resource: JSON.stringify({ version: 1, accountId: "fixture-candidate" }) }] };
}
describe("Postgres deletion transaction, fixture database adapter only", () => {
  beforeEach(() => {
    fixture.existing = false; fixture.organisation = false; fixture.enabled = true; fixture.account.role = "candidate"; fixture.claimedRow = null;
    fixture.account.suspendedAt = null; fixture.writes.length = 0;
    vi.stubEnv("ACCOUNT_DELETION_MASTER_KEY", "fixture-only-key-not-a-production-secret-123456789");
    fixture.accountHash = accountDeletionHash("fixture-candidate");
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("quarantines credentials, deletes every session/grant ownership shape and queues encrypted work", async () => {
    await new PostgresDeletionStore().accept(plan(), now);
    const quarantine = fixture.writes.find(op => op.table === "users" && op.operation === "update")!;
    expect(quarantine.value).toMatchObject({ suspendedAt: now, passwordHash: null, passwordResetToken: null,
      emailVerifyToken: null, googleBookingEnabled: false });
    const revocation = fixture.writes.find(op => op.table === "user_sessions" && op.operation === "delete")!;
    const compiled = new PgDialect().sqlToQuery(revocation.where as SQL);
    for (const key of ["user", "userId", "adminId", "impersonatingUserId"]) expect(compiled.sql).toContain(key);
    expect(compiled.params).toEqual(["fixture-candidate", "fixture-candidate", "fixture-candidate", "fixture-candidate"]);
    const push = fixture.writes.find(op => op.table === "push_devices" && op.operation === "delete")!;
    expect(new PgDialect().sqlToQuery(push.where as SQL).params).toEqual(["fixture-candidate"]);
    const preferences = fixture.writes.find(op => op.table === "privacy_preferences" && op.operation === "update")!;
    expect(preferences.value).toMatchObject({ marketing: false, optionalAnalytics: false,
      notifications: { messages: false, interviews: false, applications: false, eligibility: false, documents: false, jobAlerts: false } });
    expect(new PgDialect().sqlToQuery(preferences.where as SQL).params).toEqual(["fixture-candidate"]);
    const job = fixture.writes.find(op => op.table === "account_deletion_tasks")!;
    expect(JSON.stringify(job.value)).not.toContain("fixture-resource");
    expect(fixture.writes.some(op => op.table === "deletion_tombstone_outbox")).toBe(true);
  });
  it("rechecks sole-owner status even when an earlier preflight says no transfer is needed", async () => {
    fixture.organisation = true;
    await expect(new PostgresDeletionStore().accept(plan(), now)).rejects.toThrow("organisation_ownership_transfer_required");
    expect(fixture.writes).toHaveLength(0);
  });
  it("rejects stale role/account state before any write", async () => {
    fixture.account.role = "employer";
    await expect(new PostgresDeletionStore().accept(plan(), now)).rejects.toThrow("account_changed");
    expect(fixture.writes).toHaveLength(0);
  });
  it("returns a duplicate request without duplicating tasks or modifying unrelated accounts", async () => {
    fixture.existing = true;
    const result = await new PostgresDeletionStore().accept(plan(), now);
    expect(result.id).toBe("fixture-request"); expect(fixture.writes).toHaveLength(0);
  });
  it("keeps the permanent deletion table to the five approved evidence fields", () => {
    expect(getTableConfig(accountDeletionRequestsTable).columns.map(column => column.name).sort()).toEqual(
      ["id", "account_hash", "requested_at", "completed_at", "outcome"].sort());
  });
  it("rejects a supplied pseudonym that belongs to another account", async () => {
    await expect(new PostgresDeletionStore().accept({ ...plan(), accountHash: accountDeletionHash("fixture-other") }, now))
      .rejects.toThrow("account_hash_mismatch");
    expect(fixture.writes).toHaveLength(0);
  });
  it.each(["fixture-other", "fixture-candidate"])("revalidates persisted task ownership for %s before claiming", async accountId => {
    fixture.existing = true;
    const resource = JSON.stringify({ version: 1, accountId });
    fixture.claimedRow = {
      id: "fixture-task", attempts: 0, kind: "active_data",
      resource_ciphertext: encryptDeletionResource(resource),
    };
    const claim = new PostgresDeletionStore().claim("fixture-request", now);
    if (accountId === "fixture-other") {
      await expect(claim).rejects.toThrow("task_account_mismatch");
      expect(fixture.writes).toHaveLength(0);
    } else {
      await expect(claim).resolves.toMatchObject({ id: "fixture-task", attempts: 1, resource });
      expect(fixture.writes).toContainEqual(expect.objectContaining({ operation: "update", table: "account_deletion_tasks" }));
    }
  });
  it("blocks every direct store mutation while the real release gate is closed", async () => {
    fixture.enabled = false;
    const store = new PostgresDeletionStore();
    const task = { id: "fixture-task", requestId: "fixture-request", kind: "active_data" as const,
      state: "running" as const, attempts: 1, resource: plan().tasks[0].resource };
    for (const operation of [
      () => store.accept(plan(), now), () => store.claim("fixture-request", now),
      () => store.taskComplete(task), () => store.taskBlocked(task, "fixture_failure", now),
      () => store.completeIfReady("fixture-request", now), () => store.acknowledgeTombstone("fixture-request", now),
      () => revokeClaimedLocalCredentials({ version: 1, accountId: "fixture-candidate" }, "fixture-task"),
    ]) await expect(operation()).rejects.toThrow("deletion_release_blocked");
    expect(fixture.writes).toEqual([]);
  });
  it("repeats concrete local revocation only for a quarantined, claim-bound account", async () => {
    const resource = { version: 1 as const, accountId: "fixture-candidate" };
    fixture.claimedRow = { resource_ciphertext: encryptDeletionResource(JSON.stringify(resource)) };
    await expect(revokeClaimedLocalCredentials(resource, "fixture-task")).rejects.toThrow("account_not_quarantined");
    expect(fixture.writes).toEqual([]);
    fixture.account.suspendedAt = now;
    await revokeClaimedLocalCredentials(resource, "fixture-task");
    await revokeClaimedLocalCredentials(resource, "fixture-task");
    expect(fixture.writes.filter(op => op.table === "user_sessions" && op.operation === "delete")).toHaveLength(2);
    expect(fixture.writes.filter(op => op.table === "push_devices" && op.operation === "delete")).toHaveLength(2);
    for (const op of fixture.writes) {
      expect(new PgDialect().sqlToQuery(op.where as SQL).params.every(value => value === "fixture-candidate")).toBe(true);
    }
  });
  it("rejects persisted extra fields before setting a task lease", async () => {
    fixture.existing = true;
    fixture.claimedRow = {
      id: "fixture-task", attempts: 0, kind: "active_data",
      resource_ciphertext: encryptDeletionResource(JSON.stringify({
        version: 1, accountId: "fixture-candidate", password: "fixture-forbidden-field",
      })),
    };
    await expect(new PostgresDeletionStore().claim("fixture-request", now)).rejects.toThrow("resource_invalid");
    expect(fixture.writes).toHaveLength(0);
  });
});
