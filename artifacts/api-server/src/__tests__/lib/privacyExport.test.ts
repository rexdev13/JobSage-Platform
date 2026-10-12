import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { createPrivateArchive, MAX_EXPORT_BYTES } from "../../lib/privacyExport/archive";
import { PERSONAL_RECORDS, readPersonalRecords } from "../../lib/privacyExport/records";

describe("private export archive and selectors (no customer database)", () => {
  it("writes interoperable stored ZIP entries with a central directory", () => {
    const zip = createPrivateArchive([{ name: "account-records.json", bytes: Buffer.from('{"fixture":true}') }]);
    expect(zip.readUInt32LE()).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(1);
    expect(zip.readUInt32LE(zip.readUInt32LE(end + 16))).toBe(0x02014b50);
    expect(zip.toString()).toContain('{"fixture":true}');
  });
  it("rejects traversal, duplicate paths and oversized archives rather than producing partial files", () => {
    expect(() => createPrivateArchive([{ name: "../secret", bytes: Buffer.alloc(1) }])).toThrow();
    expect(() => createPrivateArchive([{ name: "same", bytes: Buffer.alloc(0) }, { name: "same", bytes: Buffer.alloc(0) }])).toThrow();
    expect(() => createPrivateArchive([{ name: "large", bytes: Buffer.alloc(MAX_EXPORT_BYTES) }])).toThrow();
  });
  it("parameterizes the owner of every section and never selects wildcard or credential columns", async () => {
    const execute = vi.fn(async (query) => {
      const parsed = new PgDialect().sqlToQuery(query);
      expect(parsed.params).toEqual(["fixture-account"]);
      expect(parsed.sql).toContain("WHERE");
      expect(parsed.sql).not.toContain("SELECT *");
      expect(parsed.sql).not.toMatch(/password_hash|refresh_token|admin_notes|reset_token|push_devices/);
      if (parsed.sql.includes("AS row_count")) return { rows: [{ row_count: 1, byte_count: 128 }] };
      return { rows: [{ email: "fixture@export.invalid", password_hash: "must-not-export", admin_notes: "private" }] };
    });
    const result = await readPersonalRecords({ execute }, "fixture-account");
    expect(execute).toHaveBeenCalledTimes(PERSONAL_RECORDS.length * 2);
    expect(JSON.stringify(result)).not.toMatch(/must-not-export|admin_notes|password_hash/);
  });
  it("fails explicitly for excessive rows and cancelled collection", async () => {
    await expect(readPersonalRecords({ execute: async () => ({ rows: [{ row_count: 5001, byte_count: 0 }] }) }, "fixture-account")).rejects.toThrow("limit");
    const signal = AbortSignal.abort();
    const execute = vi.fn();
    await expect(readPersonalRecords({ execute }, "fixture-account", signal)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects oversized record sections on the database side before fetching payload rows", async () => {
    const execute = vi.fn(async () => ({ rows: [{ row_count: 1, byte_count: MAX_EXPORT_BYTES + 1 }] }));
    await expect(readPersonalRecords({ execute }, "fixture-account")).rejects.toThrow("limit");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
