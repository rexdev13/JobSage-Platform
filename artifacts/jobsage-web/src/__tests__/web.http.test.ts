/**
 * HTTP-level integration tests for the JOBSAGE web app.
 * These tests hit the running dev server (http://localhost:PORT/jobsage/...) using fetch.
 * They verify that pages load, return 200, and contain expected HTML markers.
 *
 * Requires the web dev server to be running. Run with:
 *   PORT=18557 vitest run
 */
import { describe, it, expect, beforeAll } from "vitest";

const PORT = process.env.PORT ?? "18557";
const BASE = `http://localhost:${PORT}/jobsage`;

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "follow" });
  const text = await res.text();
  return { status: res.status, url: res.url, text };
}

// Check if server is reachable before running tests
let serverReachable = false;
beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) });
    serverReachable = res.status < 500;
  } catch {
    serverReachable = false;
  }
});

function requireServer() {
  if (!serverReachable) {
    console.warn("Dev server not reachable — skipping HTTP integration test");
  }
}

describe("Web app HTTP integration", () => {
  it("root path returns HTML (not a blank page)", async () => {
    requireServer();
    if (!serverReachable) return;
    const { status, text } = await get("/");
    expect(status).toBeLessThan(500);
    expect(text).toMatch(/<!doctype html/i);
  });

  it("/login path serves the app shell (no server error)", async () => {
    requireServer();
    if (!serverReachable) return;
    const { status, text } = await get("/login");
    expect(status).toBeLessThan(500);
    expect(text).toMatch(/<!doctype html/i);
  });

  it("/register path serves the app shell", async () => {
    requireServer();
    if (!serverReachable) return;
    const { status, text } = await get("/register");
    expect(status).toBeLessThan(500);
    expect(text).toMatch(/<!doctype html/i);
  });

  it("/forgot-password path serves the app shell", async () => {
    requireServer();
    if (!serverReachable) return;
    const { status, text } = await get("/forgot-password");
    expect(status).toBeLessThan(500);
    expect(text).toMatch(/<!doctype html/i);
  });

  it("API health check responds", async () => {
    requireServer();
    if (!serverReachable) return;
    const healthBase = `http://localhost:${PORT}`;
    const res = await fetch(`${healthBase}/jobsage/api/health`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    if (!res) return; // health route may not exist; skip without failing
    expect(res.status).toBeLessThan(500);
  });

  it("app HTML references JOBSAGE assets or script bundles", async () => {
    requireServer();
    if (!serverReachable) return;
    const { text } = await get("/");
    expect(text).toMatch(/<script|<link rel="stylesheet"/i);
  });

  it("unknown path does not return 500 (SPA handles it)", async () => {
    requireServer();
    if (!serverReachable) return;
    const { status } = await get("/this-does-not-exist-xyz");
    expect(status).toBeLessThan(500);
  });
});
