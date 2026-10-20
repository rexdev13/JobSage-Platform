import { describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { executionEnvironment: "storeClient" },
}));

jest.mock("expo-notifications", () => {
  throw new Error("Expo Go must never evaluate the remote push module");
});

describe("Expo Go notification bootstrap", () => {
  it("does not evaluate expo-notifications in Expo Go", () => {
    const { getNativeNotifications } = require("../lib/notification-runtime");
    expect(getNativeNotifications()).toBeNull();
  });
});
