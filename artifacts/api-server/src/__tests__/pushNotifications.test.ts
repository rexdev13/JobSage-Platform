import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSafePushMessage,
  isRetryableExpoError,
  isPushDeliveryEnabled,
  pushBackoffMs,
  sendExpoPushBatch,
} from "../lib/pushNotifications";

const token = "ExponentPushToken[fixture-device-token]";

describe("push delivery safety", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses generic lock-screen copy and an account-bound internal destination", () => {
    const message = buildSafePushMessage("messages", token, "account-123");
    expect(message).toMatchObject({
      title: "New JOBSAGE message",
      body: "You have a new message.",
      data: { destination: "/inbox", accountId: "account-123" },
      channelId: "default",
    });
    expect(JSON.stringify(message)).not.toContain("message text");
  });

  it("uses bounded exponential backoff", () => {
    expect(pushBackoffMs(1)).toBe(30_000);
    expect(pushBackoffMs(3)).toBe(120_000);
    expect(pushBackoffMs(99)).toBe(16 * 60_000);
  });

  it("retries only transient Expo receipt failures", () => {
    expect(isRetryableExpoError("MessageRateExceeded")).toBe(true);
    expect(isRetryableExpoError("ExpoServerError")).toBe(true);
    expect(isRetryableExpoError("DeviceNotRegistered")).toBe(false);
    expect(isRetryableExpoError("MessageTooBig")).toBe(false);
  });

  it("never enables delivery in development, even when the opt-in flag is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("JOBSAGE_PUSH_DELIVERY_ENABLED", "true");
    expect(isPushDeliveryEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isPushDeliveryEnabled()).toBe(true);
  });

  it("splits Expo sends into provider-sized batches without using the network in tests", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const batch = JSON.parse(String(init?.body)) as unknown[];
      return new Response(JSON.stringify({
        data: batch.map((_, index) => ({ status: "ok", id: `ticket-${index}` })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const messages = Array.from({ length: 101 }, (_, index) =>
      buildSafePushMessage("applications", token, `account-${index}`));

    const tickets = await sendExpoPushBatch(messages, fetcher, undefined);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(101);
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as unknown[]);
    expect(bodies.map((body) => body.length)).toEqual([100, 1]);
  });

  it("rejects provider failures and malformed ticket envelopes", async () => {
    const message = [buildSafePushMessage("messages", token, "account-1")];
    const failed = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
    const malformed = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(sendExpoPushBatch(message, failed, undefined)).rejects.toThrow("expo_push_http_error");
    await expect(sendExpoPushBatch(message, malformed, undefined)).rejects.toThrow("expo_push_response_invalid");
  });
});
