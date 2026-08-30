import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  companySiteHostStatesTable: {},
}));

const {
  createPinnedLookup,
  resolveAndPinPublicAddress,
  robotsAllows,
} = await import("../../lib/companySiteHttp");

describe("company-site robots policy", () => {
  it("selects the most specific user-agent group", () => {
    const body = [
      "User-agent: *",
      "Disallow: /jobs",
      "",
      "User-agent: JOBSAGE",
      "Allow: /jobs",
    ].join("\n");
    expect(robotsAllows(body, "/jobs/123")).toBe(true);
  });

  it("keeps consecutive user agents in one group and honours specific Allow rules", () => {
    const body = [
      "User-agent: JOBSAGE",
      "User-agent: AnotherBot",
      "Disallow: /careers/*",
      "Allow: /careers/public/*",
    ].join("\n");
    expect(robotsAllows(body, "/careers/private/1")).toBe(false);
    expect(robotsAllows(body, "/careers/public/1")).toBe(true);
  });

  it("supports end-anchored rules including query strings", () => {
    const body = [
      "User-agent: *",
      "Disallow: /jobs?preview=true$",
    ].join("\n");
    expect(robotsAllows(body, "/jobs?preview=true")).toBe(false);
    expect(robotsAllows(body, "/jobs?preview=false")).toBe(true);
  });
});

describe("company-site DNS pinning", () => {
  it("rejects a private connection-time resolution", async () => {
    await expect(
      resolveAndPinPublicAddress(
        "rebind.example",
        vi.fn().mockResolvedValue([{ address: "169.254.169.254", family: 4 }]),
      ),
    ).rejects.toThrow(/non-public DNS result/);
  });

  it.each([
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "fe90::1",
  ])("rejects non-global IPv6 resolution %s", async (address) => {
    await expect(
      resolveAndPinPublicAddress(
        "rebind.example",
        vi.fn().mockResolvedValue([{ address, family: 6 }]),
      ),
    ).rejects.toThrow(/non-public DNS result/);
  });

  it("uses the validated public address without resolving the hostname again", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const pinned = await resolveAndPinPublicAddress("rebind.example", resolver);
    const lookup = createPinnedLookup(pinned);
    const callback = vi.fn();

    lookup("rebind.example", { family: 0 }, callback);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });
});