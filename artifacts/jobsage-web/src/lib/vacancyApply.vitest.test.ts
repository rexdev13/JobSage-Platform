import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkApplyLinkInBackground,
  CLICK_HEALTH_TIMEOUT_MS,
} from "./vacancyApply";

describe("vacancy Apply link checks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call the health API for a live link verified within 12 hours", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await checkApplyLinkInBackground({
      url: "https://jobs.example.com/123",
      endpoint: "/api/vacancy-link-check",
      linkVerified: true,
      linkCheckedAt: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
      fetchImpl,
      onDead: vi.fn(),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts an unverified link check after 1.5 seconds so it cannot stay pending", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal instanceof AbortSignal ? init.signal : undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const check = checkApplyLinkInBackground({
      url: "https://jobs.example.com/unverified",
      endpoint: "/api/vacancy-link-check",
      linkVerified: false,
      linkCheckedAt: null,
      fetchImpl,
      onDead: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(CLICK_HEALTH_TIMEOUT_MS);
    await check;
    expect(signal?.aborted).toBe(true);
  });

  it("reports a dead background verdict so the role feed can be invalidated", async () => {
    const onDead = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ verdict: "dead" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await checkApplyLinkInBackground({
      url: "https://jobs.example.com/closed",
      endpoint: "/api/vacancy-link-check",
      linkVerified: false,
      linkCheckedAt: null,
      fetchImpl,
      onDead,
    });
    expect(onDead).toHaveBeenCalledOnce();
  });
});