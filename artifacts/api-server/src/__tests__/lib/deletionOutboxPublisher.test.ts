import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ enabled: false }));
vi.mock("../../lib/accountDeletion/releaseReadiness", () => ({
  get DELETION_REQUESTS_ENABLED() { return fixtures.enabled; },
}));

import { publishNextDeletionTombstone } from "../../lib/accountDeletion/outboxPublisher";

const pending = {
  id: "c64b76c8-69d4-47d9-9798-9ce13051bf22",
  accountHash: "a".repeat(64),
  requestedAt: new Date("2026-10-12T10:00:00.000Z"),
};

describe("deletion tombstone outbox publisher (fixtures only)", () => {
  beforeEach(() => { fixtures.enabled = false; });

  it("keeps the release gate closed without reading the outbox", async () => {
    const store = { nextPendingTombstone: vi.fn(), acknowledgeTombstone: vi.fn() };
    await expect(publishNextDeletionTombstone(store, { publish: vi.fn() })).rejects.toThrow("deletion_release_blocked");
    expect(store.nextPendingTombstone).not.toHaveBeenCalled();
  });

  it("publishes only the pseudonymous receipt and acknowledges after registry verification", async () => {
    fixtures.enabled = true;
    const order: string[] = [];
    const store = {
      nextPendingTombstone: vi.fn(async () => pending),
      acknowledgeTombstone: vi.fn(async () => { order.push("acknowledge"); }),
    };
    const registry = { publish: vi.fn(async (receipt) => {
      order.push("publish");
      expect(receipt).toEqual({
        version: 1,
        id: pending.id,
        accountHash: pending.accountHash,
        requestedAt: pending.requestedAt.toISOString(),
      });
    }) };

    await expect(publishNextDeletionTombstone(store, registry, new Date("2026-10-12T10:01:00.000Z")))
      .resolves.toBe(true);
    expect(order).toEqual(["publish", "acknowledge"]);
    expect(store.acknowledgeTombstone).toHaveBeenCalledWith(pending.id, new Date("2026-10-12T10:01:00.000Z"));
  });

  it("does not acknowledge a tombstone when the independent registry fails", async () => {
    fixtures.enabled = true;
    const store = {
      nextPendingTombstone: vi.fn(async () => pending),
      acknowledgeTombstone: vi.fn(),
    };
    await expect(publishNextDeletionTombstone(store, {
      publish: vi.fn(async () => { throw new Error("fixture registry unavailable"); }),
    })).rejects.toThrow("fixture registry unavailable");
    expect(store.acknowledgeTombstone).not.toHaveBeenCalled();
  });

  it("does no registry write when there is no pending outbox item", async () => {
    fixtures.enabled = true;
    const store = {
      nextPendingTombstone: vi.fn(async () => null),
      acknowledgeTombstone: vi.fn(),
    };
    const registry = { publish: vi.fn() };
    await expect(publishNextDeletionTombstone(store, registry)).resolves.toBe(false);
    expect(registry.publish).not.toHaveBeenCalled();
    expect(store.acknowledgeTombstone).not.toHaveBeenCalled();
  });
});
