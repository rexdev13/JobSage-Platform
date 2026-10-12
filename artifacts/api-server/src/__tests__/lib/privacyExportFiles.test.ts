import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const fixtures = vi.hoisted(() => ({
  generation: "101", owner: "fixture-account",
  pin: vi.fn(), download: vi.fn(), execute: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute: fixtures.execute }) },
}));
vi.mock("../../lib/privacyExport/records", async () => ({
  ...await vi.importActual("../../lib/privacyExport/records"),
  readPersonalRecords: async () => ({ account: [{ email: "owned@fixture.invalid" }] }),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    normalizeObjectEntityPath(path: string) { return path; }
    async getObjectEntityFile() {
      return { name: "fixture-file", getMetadata: async () => [{ generation: fixtures.generation }],
        bucket: { file: fixtures.pin } };
    }
    async canAccessObjectEntity() { return true; }
    downloadObject = fixtures.download;
  },
}));
vi.mock("../../lib/objectAcl", () => ({
  getObjectAclPolicy: async () => ({ owner: fixtures.owner, visibility: "private" }),
}));
import { buildPersonalDataArchive } from "../../lib/privacyExport/service";

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.generation = "101";
  fixtures.owner = "fixture-account";
  fixtures.pin.mockReturnValue({ generation: "101", name: "pinned-fixture-file" });
  fixtures.download.mockImplementation(async () => new Response("original-fixture", { headers: { "content-length": "16" } }));
  fixtures.execute.mockImplementation(async (query) => {
    const text = new PgDialect().sqlToQuery(query).sql;
    if (text.includes("AS row_count")) return { rows: [{ row_count: text.includes("FROM documents") ? 1 : 0, byte_count: 128 }] };
    return { rows: text.includes("FROM documents") ? [{ id: 12, filename: "owned.pdf", storage_key: "/objects/fixture", mime_type: "application/pdf" }] : [] };
  });
});
describe("uploaded-original export safety (storage and database fixtures only)", () => {
  it("pins ACL and streamed bytes to the exact owned object generation", async () => {
    const archive = await buildPersonalDataArchive("fixture-account");
    expect(fixtures.pin).toHaveBeenCalledWith("fixture-file", { generation: "101" });
    expect(fixtures.download).toHaveBeenCalledWith({ generation: "101", name: "pinned-fixture-file" }, 0);
    expect(archive.toString()).toContain("original-fixture");
    expect(archive.toString()).not.toContain("/objects/fixture");
  });
  it("does not download or deliver another account's object", async () => {
    fixtures.owner = "other-fixture-account";
    await expect(buildPersonalDataArchive("fixture-account")).rejects.toThrow("could not be verified");
    expect(fixtures.download).not.toHaveBeenCalled();
  });
  it("fails rather than reading a mutable unverified object version", async () => {
    fixtures.generation = "";
    await expect(buildPersonalDataArchive("fixture-account")).rejects.toThrow("version");
    expect(fixtures.download).not.toHaveBeenCalled();
  });
  it("rejects oversized originals before streaming them into an archive", async () => {
    fixtures.download.mockImplementation(async () => new Response("fixture", { headers: { "content-length": String(13 * 1024 * 1024) } }));
    await expect(buildPersonalDataArchive("fixture-account")).rejects.toThrow("limit");
  });
});
