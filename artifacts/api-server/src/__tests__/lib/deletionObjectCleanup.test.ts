import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const fixture = vi.hoisted(() => ({
  enabled: true, claim: true, active: false, absent: false, cipher: "", hash: "",
  owner: "fixture-candidate", generation: "101", versions: ["101"],
  deleteError: 0, stillExists: false,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  deleted: [] as Array<{ bucket: string; name: string; generation: string | undefined; precondition: string | undefined; metadataPrecondition: string | undefined }>,
}));
vi.mock("../../lib/accountDeletion/releaseReadiness", () => ({
  get DELETION_REQUESTS_ENABLED() { return fixture.enabled; },
}));
vi.mock("@workspace/db", async () => ({
  ...await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema"),
  db: { execute: vi.fn(async (query: SQL) => {
    const compiled = new PgDialect().sqlToQuery(query);
    fixture.queries.push(compiled);
    if (compiled.sql.includes("account_deletion_tasks")) return { rows: fixture.claim ? [{
      request_id: "fixture-request", resource_ciphertext: fixture.cipher, account_hash: fixture.hash,
    }] : [] };
    return { rows: fixture.absent ? [] : [{ id: "fixture-candidate", role: "candidate", suspended_at: fixture.active ? null : new Date() }] };
  }) },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getPrivateObjectDir() { return process.env.PRIVATE_OBJECT_DIR!; }
    normalizeObjectEntityPath(path: string) {
      if (path.startsWith("https://storage.googleapis.com/fixture-app/private/")) {
        return `/objects/${new URL(path).pathname.slice("/fixture-app/private/".length)}`;
      }
      return path;
    }
  },
  objectStorageClient: { bucket: (bucket: string) => ({
    file: (name: string, options?: { generation?: string; preconditionOpts?: { ifGenerationMatch?: string; ifMetagenerationMatch?: string } }) => {
      const generation = options?.generation ?? fixture.generation;
      return {
        getMetadata: async () => {
          if (!fixture.versions.includes(generation)) throw Object.assign(new Error("fixture missing"), { code: 404 });
          return [{ generation, metageneration: "1", metadata: { "custom:aclPolicy": JSON.stringify({ owner: fixture.owner, visibility: "private" }) } }];
        },
        delete: async () => {
          if (fixture.deleteError) throw Object.assign(new Error("fixture transport detail"), { code: fixture.deleteError });
          fixture.deleted.push({ bucket, name, generation: options?.generation,
            precondition: options?.preconditionOpts?.ifGenerationMatch, metadataPrecondition: options?.preconditionOpts?.ifMetagenerationMatch });
          fixture.versions = fixture.versions.filter(version => version !== generation);
        },
        exists: async () => [fixture.stillExists || fixture.versions.includes(generation)],
      };
    },
  }) },
}));
import { eraseOwnedObject, snapshotOwnedObject } from "../../lib/accountDeletion/objectCleanup";
import { requireClaimedCleanup } from "../../lib/accountDeletion/cleanupScope";
import { accountDeletionHash, encryptDeletionResource } from "../../lib/accountDeletion/crypto";
import type { CleanupResource } from "../../lib/accountDeletion/resource";

function resource(): CleanupResource {
  return { version: 1, accountId: "fixture-candidate", reference: "/objects/uploads/fixture-file", provider: "app-storage", generation: "101" };
}
function bind(value = resource()) { fixture.cipher = encryptDeletionResource(JSON.stringify(value)); }
describe("concrete App Storage erasure, isolated SDK/database fixtures only", () => {
  beforeEach(() => {
    vi.stubEnv("ACCOUNT_DELETION_MASTER_KEY", "fixture-only-deletion-key-not-a-real-secret-123456789");
    vi.stubEnv("DEFAULT_OBJECT_STORAGE_BUCKET_ID", "fixture-app");
    vi.stubEnv("ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID", "fixture-registry");
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/fixture-app/private");
    vi.stubEnv("PUBLIC_OBJECT_SEARCH_PATHS", "/fixture-app/public");
    fixture.enabled = true; fixture.claim = true; fixture.active = false; fixture.absent = false;
    fixture.owner = "fixture-candidate"; fixture.generation = "101"; fixture.versions = ["101"];
    fixture.deleteError = 0; fixture.stillExists = false; fixture.deleted = []; fixture.queries = [];
    fixture.hash = accountDeletionHash("fixture-candidate"); bind();
  });
  afterEach(() => vi.unstubAllEnvs());
  it("keeps the actual production release constant false", async () => {
    const actual = await vi.importActual<typeof import("../../lib/accountDeletion/releaseReadiness")>("../../lib/accountDeletion/releaseReadiness");
    expect(actual.DELETION_REQUESTS_ENABLED).toBe(false);
  });
  it("captures only an owned immutable version and canonical path without writing", async () => {
    fixture.enabled = false;
    expect(await snapshotOwnedObject("fixture-candidate",
      "https://storage.googleapis.com/fixture-app/private/uploads/fixture-file?fixture=ignored")).toEqual(resource());
    expect(fixture.deleted).toEqual([]); expect(fixture.queries).toEqual([]);
  });
  it("refuses another account's object during preparation", async () => {
    fixture.owner = "fixture-other";
    await expect(snapshotOwnedObject("fixture-candidate", resource().reference!)).rejects.toThrow("object_ownership_unverified");
    expect(fixture.deleted).toEqual([]);
  });
  it("deletes exactly the claim-bound generation, verifies absence and retries safely", async () => {
    await eraseOwnedObject(resource(), "fixture-task");
    await eraseOwnedObject(resource(), "fixture-task");
    expect(fixture.deleted).toEqual([{ bucket: "fixture-app", name: "private/uploads/fixture-file",
      generation: "101", precondition: "101", metadataPrecondition: "1" }]);
    expect(fixture.queries[0].sql).toContain("t.lease_until >");
    expect(fixture.queries[0].sql).toContain("r.completed_at IS NULL");
    expect(fixture.queries[0].params.slice(0, 2)).toEqual(["fixture-task", "object"]);
  });
  it("removes the captured old version without deleting a newer generation", async () => {
    fixture.generation = "102"; fixture.versions = ["101", "102"];
    await eraseOwnedObject(resource(), "fixture-task");
    expect(fixture.versions).toEqual(["102"]);
  });
  it("treats only exact-version absence as an idempotent success", async () => {
    fixture.generation = "102"; fixture.versions = ["102"];
    await eraseOwnedObject(resource(), "fixture-task");
    expect(fixture.deleted).toEqual([]); expect(fixture.versions).toEqual(["102"]);
  });
  it("rechecks immutable-version ownership before deletion", async () => {
    fixture.owner = "fixture-other";
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("object_ownership_unverified");
    expect(fixture.deleted).toEqual([]);
  });
  it("does no database or storage work while the release gate is closed", async () => {
    fixture.enabled = false;
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("deletion_release_blocked");
    expect(fixture.deleted).toEqual([]); expect(fixture.queries).toEqual([]);
  });
  it("refuses missing/expired/completed durable claims", async () => {
    fixture.claim = false;
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("cleanup_claim_required");
    expect(fixture.deleted).toEqual([]);
  });
  it("refuses changes to a caller-supplied path or account", async () => {
    for (const changed of [{ ...resource(), reference: "/objects/other" }, { ...resource(), accountId: "fixture-other" }]) {
      await expect(eraseOwnedObject(changed, "fixture-task")).rejects.toThrow("cleanup_claim_mismatch");
    }
    expect(fixture.deleted).toEqual([]);
  });
  it("refuses corrupted encrypted resources", async () => {
    fixture.cipher = "fixture-invalid-ciphertext";
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("resource_invalid");
    expect(fixture.deleted).toEqual([]);
  });
  it("requires quarantine, but permits exact retries after account-row removal", async () => {
    fixture.active = true;
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("account_not_quarantined");
    expect(fixture.deleted).toEqual([]);
    fixture.absent = true;
    await eraseOwnedObject(resource(), "fixture-task");
    expect(fixture.deleted).toHaveLength(1);
  });
  it("refuses object tasks without a captured version", async () => {
    const noVersion = { ...resource(), generation: undefined };
    bind(noVersion);
    await expect(eraseOwnedObject(noVersion, "fixture-task")).rejects.toThrow("object_snapshot_required");
    expect(fixture.deleted).toEqual([]);
  });
  it.each(["/objects/../file", "/objects//file", "/objects/%2e%2e/file", "/objects/\\file", "https://external.example/file"])(
    "refuses unverified paths: %s", async reference => {
      const changed = { ...resource(), reference }; bind(changed);
      await expect(eraseOwnedObject(changed, "fixture-task")).rejects.toThrow("object_path_unverified");
      expect(fixture.deleted).toEqual([]);
    },
  );
  it("cannot delete from the registry bucket or an unconfigured app bucket", async () => {
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/fixture-registry/private");
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("registry_in_application_storage_paths");
    expect(fixture.deleted).toEqual([]);
    vi.stubEnv("PRIVATE_OBJECT_DIR", "/fixture-other/private");
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("object_bucket_unverified");
  });
  it.each([[412, "object_generation_changed"], [503, "object_cleanup_failed"]] as const)(
    "does not equate storage failure %s with erasure", async (code, expected) => {
      fixture.deleteError = code;
      await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow(expected);
      expect(fixture.deleted).toEqual([]);
    },
  );
  it("requires actual post-delete absence", async () => {
    fixture.stillExists = true;
    await expect(eraseOwnedObject(resource(), "fixture-task")).rejects.toThrow("object_cleanup_unconfirmed");
  });
  it("binds claims to the account hash as well as the encrypted resource", async () => {
    fixture.hash = accountDeletionHash("fixture-other");
    await expect(requireClaimedCleanup(resource(), "fixture-task", "object")).rejects.toThrow("cleanup_claim_mismatch");
  });
});
