import { describe, expect, it, jest } from "@jest/globals";
import {
  createPushPrivacyHeaders,
  hasEnabledNotificationCategory,
  registerNativePushToken,
  revokeNativePushToken,
} from "../lib/native-push";

const token = "ExponentPushToken[abcdefgh12345678]";

describe("native push registration boundaries", () => {
  it("requires an explicitly enabled notification category", () => {
    expect(hasEnabledNotificationCategory({ messages: false, interviews: false })).toBe(false);
    expect(hasEnabledNotificationCategory({ messages: true })).toBe(true);
    expect(hasEnabledNotificationCategory(undefined)).toBe(false);
  });

  it("binds privacy actions to the active account and bearer session", () => {
    expect(createPushPrivacyHeaders("account-1", "session-token")).toEqual({
      Authorization: "Bearer session-token",
      "x-jobsage-privacy-account": "account-1",
    });
  });

  it("registers only a structurally valid Expo token", async () => {
    const register = jest.fn(async () => ({ success: true }));
    await registerNativePushToken({ token, platform: "ios" }, {
      accountId: "account-1",
      authToken: "session-token",
      register,
    });
    expect(register).toHaveBeenCalledWith(
      { token, platform: "ios" },
      { headers: createPushPrivacyHeaders("account-1", "session-token") },
    );
    await expect(registerNativePushToken({ token: "not-a-token", platform: "android" }, {
      accountId: "account-1",
      authToken: "session-token",
      register,
    })).rejects.toThrow("invalid push registration");
  });

  it("supports exact-device revocation and rejects malformed tokens", async () => {
    const revoke = jest.fn(async () => ({ success: true }));
    await revokeNativePushToken({ confirmed: true, token }, {
      accountId: "account-1",
      authToken: "session-token",
      revoke,
    });
    expect(revoke).toHaveBeenCalledWith(
      { confirmed: true, token },
      { headers: createPushPrivacyHeaders("account-1", "session-token") },
    );
    await expect(revokeNativePushToken({ confirmed: true, token: "bad" }, {
      accountId: "account-1",
      authToken: "session-token",
      revoke,
    })).rejects.toThrow("invalid push registration");
  });
});
