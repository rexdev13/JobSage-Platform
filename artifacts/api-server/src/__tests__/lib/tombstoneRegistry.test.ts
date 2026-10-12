import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/objectStorage", () => ({ objectStorageClient: { bucket: vi.fn() } }));
import { IndependentTombstoneRegistry, assertDeletionRestoreBarrier, type IndependentTombstone } from "../../lib/accountDeletion/tombstoneRegistry";

const fixture: IndependentTombstone = { version: 1, id: "c64b76c8-69d4-47d9-9798-9ce13051bf22", accountHash: "a".repeat(64), requestedAt: "2026-10-12T00:00:00.000Z" };
function memoryStore() {
  const values = new Map<string, Buffer>();
  return {
    values,
    createOnce: async (key: string, bytes: Buffer) => { if (!values.has(key)) values.set(key, bytes); },
    read: async (key: string) => { const value = values.get(key); if (!value) throw new Error("fixture missing"); return value; },
    names: async (prefix: string) => [...values.keys()].filter(key => key.startsWith(prefix)),
  };
}
describe("independent erasure registry and restore barrier (fixtures only)", () => {
  it("rejects a registry sharing the application's bucket", () => {
    expect(() => new IndependentTombstoneRegistry(memoryStore(), "same-bucket", "same-bucket")).toThrow("independent_registry");
  });
  it("publishes immutable minimal receipts and acknowledges an exact idempotent retry", async () => {
    const store = memoryStore();
    const registry = new IndependentTombstoneRegistry(store, "fixture-app", "fixture-registry");
    await registry.publish(fixture);
    await registry.publish(fixture);
    expect(store.values.size).toBe(1);
    expect(await registry.list()).toEqual([fixture]);
    await expect(registry.publish({ ...fixture, requestedAt: "2026-10-13T00:00:00.000Z" })).rejects.toThrow("receipt_mismatch");
  });
  it("rejects raw identity/extra fields and corrupt listing identities", async () => {
    const store = memoryStore();
    const registry = new IndependentTombstoneRegistry(store, "fixture-app", "fixture-registry");
    await expect(registry.publish({ ...fixture, email: "must-not-store@fixture.invalid" } as any)).rejects.toThrow();
    await registry.publish(fixture);
    store.values.set([...store.values.keys()][0], Buffer.from(JSON.stringify({ ...fixture, accountHash: "b".repeat(64) })));
    await expect(registry.list()).rejects.toThrow("identity_mismatch");
  });
  it("blocks restored deleted accounts and registry outages, but permits fully replayed fixtures", async () => {
    const registry = { list: async () => [fixture] };
    await expect(assertDeletionRestoreBarrier(registry, ["restored-fixture"], () => "a".repeat(64))).rejects.toThrow("requires_replay");
    await expect(assertDeletionRestoreBarrier(registry, ["active-fixture"], () => "b".repeat(64))).resolves.toBeUndefined();
    await expect(assertDeletionRestoreBarrier({ list: async () => { throw new Error("registry unavailable"); } }, [], () => "")).rejects.toThrow("unavailable");
  });
});
