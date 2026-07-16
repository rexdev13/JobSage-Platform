import { describe, it, expect } from "vitest";
import { generateToken, tokenExpiresAt, getSessionId } from "../lib/auth";
import type { Request } from "express";

describe("generateToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("generates unique tokens on each call", () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe("tokenExpiresAt", () => {
  it("returns a date in the future", () => {
    const future = tokenExpiresAt(1);
    expect(future.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns a date approximately N hours from now", () => {
    const hours = 24;
    const before = Date.now();
    const expiry = tokenExpiresAt(hours);
    const after = Date.now();

    const expectedMin = before + hours * 60 * 60 * 1000;
    const expectedMax = after + hours * 60 * 60 * 1000;

    expect(expiry.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(expiry.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("returns a Date instance", () => {
    expect(tokenExpiresAt(1)).toBeInstanceOf(Date);
  });
});

describe("getSessionId", () => {
  it("returns the Bearer token from Authorization header", () => {
    const req = {
      headers: { authorization: "Bearer my-secret-token" },
      cookies: {},
    } as unknown as Request;
    expect(getSessionId(req)).toBe("my-secret-token");
  });

  it("returns the sid cookie when no Authorization header", () => {
    const req = {
      headers: {},
      cookies: { sid: "cookie-session-id" },
    } as unknown as Request;
    expect(getSessionId(req)).toBe("cookie-session-id");
  });

  it("prefers Authorization header over cookie", () => {
    const req = {
      headers: { authorization: "Bearer header-token" },
      cookies: { sid: "cookie-token" },
    } as unknown as Request;
    expect(getSessionId(req)).toBe("header-token");
  });

  it("returns undefined when neither header nor cookie present", () => {
    const req = {
      headers: {},
      cookies: {},
    } as unknown as Request;
    expect(getSessionId(req)).toBeUndefined();
  });

  it("returns undefined when Authorization header is not Bearer", () => {
    const req = {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
      cookies: {},
    } as unknown as Request;
    expect(getSessionId(req)).toBeUndefined();
  });
});
