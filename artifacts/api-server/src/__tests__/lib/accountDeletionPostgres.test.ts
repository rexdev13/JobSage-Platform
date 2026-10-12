import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";
const fixture = vi.hoisted(() => ({
  existing: false, organisation: false,
  accountHash: "",
  claimedRow: null as Record<string, unknown> | null,
  account: { id: "fixture-candidate", role: "candidate", suspendedAt: null as Date | null },
  writes: [] as Array<{ table: string; operation: string; value?: unknown; where?: unknown }>,
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
    return { rows: text.includes("SELECT * FROM") && fixture.claimedRow ? [fixture.claimedRow] : [] };
  }) };
  return { ...actual, db: { ...tx, transaction: async (callback: (tx: any) => unknown) => callback(tx) } };
});
import { accountDeletionRequestsTable } from "@workspace/db";
import { PostgresDeletionStore } from "../../lib/accountDeletion/postgresStore";
import type { AcceptancePlan } from "../../lib/accountDeletion/engine";
import { accountDeletionHash, encryptDeletionResource } from "../../lib/accountDeletion/crypto";
const now = new Date("2026-10-12T00:00:00Z");
function plan(): AcceptancePlan {
  return { actor: { id: "fixture-candidate", role: "candidate", impersonating: false, confirmed: true, reauthenticatedAt: now },
    accountHash: fixture.accountHash, ownership: [], tasks: [{ kind: "active_data",
      resource: JSON.stringify({ version: 1, accountId: "fixture-candidate" }) }] };
}
describe("Postgres deletion transaction, fixture database adapter only", () => {
  beforeEach(() => {
    fixture.existing = false; fixture.organisation = false; fixture.account.role = "candidate"; fixture.claimedRow = null;
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
