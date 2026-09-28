import { describe, expect, it, vi } from "vitest";
import { assertDatabaseMode } from "../../tools/databaseSafety";

const fingerprint = "b".repeat(32);

function databaseWith(row: Record<string, unknown>) {
  return {
    execute: vi.fn().mockResolvedValue({ rows: [row] }),
  };
}

const readonlyIdentity = {
  database_name: "jobsage_prod",
  database_host: "10.0.0.8",
  role_name: "jobsage_readonly",
  fingerprint,
  transaction_read_only: "on",
  default_transaction_read_only: "on",
  role_is_superuser: false,
  role_can_administer: false,
  role_has_write_privileges: false,
  role_can_create_schema: false,
  role_has_write_all_data: false,
};

describe("database mode assertions", () => {
  it("accepts a fingerprint-matched, session- and privilege-restricted production connection", async () => {
    const database = databaseWith(readonlyIdentity);
    await expect(assertDatabaseMode(
      database as never,
      "production-readonly",
      fingerprint,
    )).resolves.toMatchObject({
      databaseName: "jobsage_prod",
      fingerprint,
      transactionReadOnly: "on",
      defaultTransactionReadOnly: "on",
      roleHasWritePrivileges: false,
    });
  });

  it("rejects a development fingerprint or writable production role", async () => {
    const wrongDatabase = databaseWith({
      ...readonlyIdentity,
      fingerprint: "c".repeat(32),
    });
    await expect(assertDatabaseMode(
      wrongDatabase as never,
      "production-readonly",
      fingerprint,
    )).rejects.toThrow("does not match");

    const writableDatabase = databaseWith({
      ...readonlyIdentity,
      role_has_write_privileges: true,
    });
    await expect(assertDatabaseMode(
      writableDatabase as never,
      "production-readonly",
      fingerprint,
    )).rejects.toThrow("not verifiably read-only");
  });

  it("prevents development mode from accepting a production fingerprint", async () => {
    const productionDatabase = databaseWith({
      ...readonlyIdentity,
      fingerprint: "c".repeat(32),
    });
    await expect(assertDatabaseMode(
      productionDatabase as never,
      "development",
      fingerprint,
    )).rejects.toThrow("does not match");
  });

  it("refuses production connections without read-only session defaults", async () => {
    const database = databaseWith({
      ...readonlyIdentity,
      default_transaction_read_only: "off",
    });
    await expect(assertDatabaseMode(
      database as never,
      "production-readonly",
      fingerprint,
    )).rejects.toThrow("not verifiably read-only");
  });
});