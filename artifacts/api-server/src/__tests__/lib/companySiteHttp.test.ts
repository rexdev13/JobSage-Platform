import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";
import { brotliCompressSync, gzipSync } from "node:zlib";

vi.mock("@workspace/db", () => ({
  db: {},
  companySiteHostStatesTable: {},
}));

const {
  createPinnedLookup,
  decodeCompanySiteResponseBody,
  knownAtsProvider,
  requestPinned,
  resolveAndPinPublicAddress,
  robotsAllows,
} = await import("../../lib/companySiteHttp");

describe("company-site response decoding", () => {
  it("decompresses gzip before the body can be persisted as PostgreSQL text", async () => {
    const robots = "User-agent: *\nDisallow: /private\n";
    const decoded = await decodeCompanySiteResponseBody(
      gzipSync(Buffer.from(robots)),
      "gzip",
      128_000,
    );

    expect(decoded).toBe(robots);
    expect(decoded).not.toContain("\u0000");
  });

  it("normalizes NUL characters from malformed plain-text responses", async () => {
    await expect(
      decodeCompanySiteResponseBody(Buffer.from("allow\u0000disallow"), undefined, 128_000),
    ).resolves.toBe("allow\uFFFDdisallow");
  });

  it("decodes stacked content encodings in reverse application order", async () => {
    const robots = Buffer.from("User-agent: *\nAllow: /\n");
    const gzipThenBrotli = brotliCompressSync(gzipSync(robots));

    await expect(
      decodeCompanySiteResponseBody(gzipThenBrotli, "gzip, br", 128_000),
    ).resolves.toBe(robots.toString("utf8"));
  });

  it("accepts compressed pages at the exact decoded limit and bounds larger bodies", async () => {
    const body = Buffer.from("A".repeat(128_000));
    await expect(decodeCompanySiteResponseBody(gzipSync(body), "gzip", 128_000))
      .resolves.toHaveLength(128_000);
    await expect(decodeCompanySiteResponseBody(gzipSync(Buffer.concat([body, Buffer.from("B")])), "gzip", 128_000))
      .rejects.toThrow(/exceeded 128000 bytes/);
  });
});

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

describe("known ATS providers", () => {
  it("recognises BambooHR subdomains without accepting unrelated hosts", () => {
    expect(knownAtsProvider("https://hopscotch.bamboohr.com/careers/42")).toBe("BambooHR");
    expect(knownAtsProvider("bamboohr.com")).toBe("BambooHR");
    expect(knownAtsProvider("https://bamboohr.example/careers/42")).toBeNull();
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
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("contains errors emitted by the underlying socket", async () => {
    const request = new EventEmitter() as unknown as import("node:http").ClientRequest;
    const socket = new EventEmitter();
    const socketError = new Error("connect EAFNOSUPPORT");

    Object.assign(request, {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
    });

    const requestSpy = vi.spyOn(http, "request").mockImplementation((...args: any[]) => {
      queueMicrotask(() => {
        request.emit("socket", socket);
        socket.emit("error", socketError);
      });
      return request;
    });

    await expect(
      requestPinned(
        new URL("http://example.com"),
        { address: "8.8.8.8", family: 4 },
        100,
        1_000,
      ),
    ).rejects.toBe(socketError);

    expect(requestSpy).toHaveBeenCalledOnce();
    requestSpy.mockRestore();
  });
});