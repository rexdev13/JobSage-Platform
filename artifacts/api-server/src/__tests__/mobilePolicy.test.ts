import { describe, expect, it } from "vitest";
import { safeEmployerUrl, safeInternalPath, validateWorkspaceMessage } from "@workspace/mobile-core";

describe("mobile bridge trust boundary", () => {
  const origin = "https://jobsage.example.com";
  const url = `${origin}/opportunities`;
  const channel = "a".repeat(64);
  const options = { origin, navigationUrl: url, channel, now: 1_000_000 };
  const message = { version: 1, type: "application", channel, url, timestamp: options.now, applicationId: 12 };
  it("accepts a bounded first-party application reference, not page-supplied profile data", () => {
    expect(validateWorkspaceMessage(JSON.stringify(message), options)?.type).toBe("application");
    expect(validateWorkspaceMessage(JSON.stringify({ ...message, token: "untrusted" }), options)).toBeNull();
    expect(validateWorkspaceMessage(JSON.stringify({ ...message, applicationId: -1 }), options)).toBeNull();
  });
  it.each([
    { channel: "b".repeat(64) }, { timestamp: 0 }, { url: "https://employer.example.com/apply" },
    { version: 2 }, { url: `${origin}/profile` }, { url: "https://jobsage.example.com.evil.com/opportunities" },
  ])("rejects replay, cross-origin and navigation mismatch: %j", mutation => {
    expect(validateWorkspaceMessage(JSON.stringify({ ...message, ...mutation }), options)).toBeNull();
  });
  it("checks native navigation as well as the untrusted message URL", () => {
    expect(validateWorkspaceMessage(JSON.stringify(message), {
      ...options, navigationUrl: "https://employer.example.com/apply",
    })).toBeNull();
  });
  it("rejects oversized, malformed and prototype-shaped messages", () => {
    expect(validateWorkspaceMessage("{", options)).toBeNull();
    expect(validateWorkspaceMessage("x".repeat(12001), options)).toBeNull();
    expect(validateWorkspaceMessage(JSON.stringify({ ...message, __proto__: { type: "session" } }), options)?.type).toBe("application");
  });
});

describe("safe mobile destinations", () => {
  it.each(["//attacker.example", "/\\attacker.example", "https://attacker.example", "/%5cattacker", "/%0dX:test"])(
    "rejects open redirects: %s", value => expect(safeInternalPath(value)).toBeNull());
  it("retains real internal routes and query strings", () => {
    expect(safeInternalPath("/documents?view=CV#latest")).toBe("/documents?view=CV#latest");
  });
  it.each(["http://employer.example", "javascript:alert(1)", "https://user:password@employer.example",
    "https://localhost", "https://127.0.0.1", "https://2130706433", "https://[::1]", "file:///tmp/cv",
    "https://site.internal", "https://example.com:8443"])(
    "blocks unsafe employer URLs: %s", value => expect(safeEmployerUrl(value)).toBeNull());
  it("permits ordinary HTTPS ATS detail URLs", () => {
    expect(safeEmployerUrl("https://company.wd3.myworkdayjobs.com/en-US/jobs/job/JR1")).toContain("JR1");
  });
});
