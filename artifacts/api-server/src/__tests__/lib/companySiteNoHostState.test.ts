import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  companySiteHostStatesTable: {},
}));

const http = await import("../../lib/companySiteHttp");

describe("company-site no-host-state mode", () => {
  beforeEach(() => {
    http.resetCompanySiteEphemeralState();
  });

  it("uses only per-process leases and performs no host-state DB reads or writes", async () => {
    const reservation = await http.reserveHost(
      "example.org",
      Date.now() + 1_000,
      false,
      true,
    );
    expect(reservation.allowed).toBe(true);
    if (!reservation.allowed) throw new Error("expected a local lease");

    await expect(http.completeHost(
      "example.org",
      reservation.leaseToken,
      false,
      true,
    )).resolves.toBeUndefined();
    await expect(http.releaseHost(
      "example.org",
      reservation.leaseToken,
      false,
      true,
    )).resolves.toBeUndefined();
    await expect(http.failHost(
      "example.org",
      reservation.leaseToken,
      null,
      false,
      true,
    )).resolves.toBeNull();
  });

  it("does not create process-local host state in strict no-cache mode", async () => {
    const strict = await http.reserveHost(
      "strict-cache.example",
      Date.now() + 100,
      false,
      true,
      true,
    );
    expect(strict.allowed).toBe(false);

    const regularNoHostState = await http.reserveHost(
      "strict-cache.example",
      Date.now() + 5_000,
      false,
      true,
    );
    expect(regularNoHostState.allowed).toBe(true);
  });

  it("skips the persisted robots cache lookup when host state is disabled", async () => {
    const result = await http.fetchCompanySitePage(
      "https://example.org/careers",
      "example.org",
      Date.now() - 1,
      undefined,
      { readOnly: true, noHostState: true },
    );
    expect(result).toMatchObject({ ok: false, kind: "robots" });
  });

  it("strict no-cache page checks bypass both persisted and process-local robots state", async () => {
    const result = await http.fetchCompanySitePage(
      "https://strict-cache.example/careers",
      "strict-cache.example",
      Date.now() - 1,
      undefined,
      { noProcessCache: true },
    );
    expect(result).toMatchObject({ ok: false, kind: "robots" });
  });
});