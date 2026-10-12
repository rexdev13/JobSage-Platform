import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({
  enabled: false, accounts: [] as Array<{ id: string }>, select: vi.fn(), list: vi.fn(), hash: vi.fn(),
}));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual("@workspace/db/schema");
  return {
    ...schema,
    db: { select: (...args: unknown[]) => {
      fixtures.select(...args);
      const chain: any = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => fixtures.accounts };
      return chain;
    } },
  };
});
vi.mock("../../lib/accountDeletion/releaseReadiness", () => ({ get DELETION_REQUESTS_ENABLED() { return fixtures.enabled; } }));
vi.mock("../../lib/accountDeletion/crypto", () => ({ accountDeletionHash: fixtures.hash }));
vi.mock("../../lib/accountDeletion/tombstoneRegistry", () => ({
  gcsTombstoneStorage: () => ({}),
  IndependentTombstoneRegistry: class { list = fixtures.list; },
}));
import { verifyDeletionStartupBarrier } from "../../lib/accountDeletion/startupBarrier";

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.enabled = false;
  fixtures.accounts = [];
  fixtures.list.mockResolvedValue([{ accountHash: "a".repeat(64) }]);
  fixtures.hash.mockImplementation(id => id === "restored-fixture" ? "a".repeat(64) : "b".repeat(64));
  vi.stubEnv("DEFAULT_OBJECT_STORAGE_BUCKET_ID", "fixture-app-bucket");
  vi.stubEnv("ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID", "fixture-independent-registry");
});
afterEach(() => vi.unstubAllEnvs());
describe("read-only deletion startup barrier (no customer operations)", () => {
  it("does not access a registry or account records while release is disabled", async () => {
    await verifyDeletionStartupBarrier();
    expect(fixtures.list).not.toHaveBeenCalled();
    expect(fixtures.select).not.toHaveBeenCalled();
    expect(fixtures.hash).not.toHaveBeenCalled();
  });
  it("blocks enabling erasure without a distinct configured registry", async () => {
    fixtures.enabled = true;
    vi.stubEnv("ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID", "fixture-app-bucket");
    await expect(verifyDeletionStartupBarrier()).rejects.toThrow("independent_registry_not_configured");
    expect(fixtures.select).not.toHaveBeenCalled();
  });
  it("rejects registry outages before reading or serving accounts", async () => {
    fixtures.enabled = true;
    fixtures.list.mockRejectedValue(new Error("fixture registry unavailable"));
    await expect(verifyDeletionStartupBarrier()).rejects.toThrow("unavailable");
    expect(fixtures.select).not.toHaveBeenCalled();
  });
  it("blocks a restored erased account and permits fixtures after replay", async () => {
    fixtures.enabled = true;
    fixtures.accounts = [{ id: "restored-fixture" }];
    await expect(verifyDeletionStartupBarrier()).rejects.toThrow("requires_replay");
    fixtures.accounts = [{ id: "active-fixture" }];
    await expect(verifyDeletionStartupBarrier()).resolves.toBeUndefined();
  });
});
