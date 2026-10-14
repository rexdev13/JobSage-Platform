import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

const {
  mockGetPrivacySettings,
  mockRegisterPushDevice,
  mockRevokePushDevices,
  mockGetPermissions,
  mockRequestPermissions,
  mockGetExpoPushToken,
  mockAddResponseListener,
  mockGetLastResponse,
  mockClearLastResponse,
  mockSetChannel,
  mockSecureGet,
  mockSecureSet,
  mockSecureDelete,
  setSavedRegistration,
  getSavedRegistration,
} = (() => {
  let savedRegistration: string | null = null;
  const shared = {
    mockGetPrivacySettings: jest.fn<() => Promise<any>>(),
    mockRegisterPushDevice: jest.fn<(...args: any[]) => Promise<any>>(),
    mockRevokePushDevices: jest.fn<(...args: any[]) => Promise<any>>(),
    mockGetPermissions: jest.fn<() => Promise<{ granted: boolean; canAskAgain: boolean }>>(),
    mockRequestPermissions: jest.fn<() => Promise<{ granted: boolean; canAskAgain: boolean }>>(),
    mockGetExpoPushToken: jest.fn<() => Promise<{ data: string }>>(),
    mockAddResponseListener: jest.fn<() => { remove: () => void }>(),
    mockGetLastResponse: jest.fn<() => Promise<null>>(),
    mockClearLastResponse: jest.fn<() => Promise<void>>(),
    mockSetChannel: jest.fn<() => Promise<void>>(),
    mockSecureGet: jest.fn<(...args: any[]) => Promise<string | null>>(),
    mockSecureSet: jest.fn<(...args: any[]) => Promise<void>>(),
    mockSecureDelete: jest.fn<(...args: any[]) => Promise<void>>(),
    setSavedRegistration(value: string | null) {
      savedRegistration = value;
    },
    getSavedRegistration() {
      return savedRegistration;
    },
  };
  return shared;
})();

const mockAuth = {
  user: { id: "candidate-1", role: "candidate" },
  token: "fixture-session-token",
};

jest.mock("@workspace/api-client-react", () => ({
  getPrivacySettings: mockGetPrivacySettings,
  registerPushDevice: mockRegisterPushDevice,
  revokePushDevices: mockRevokePushDevices,
}));

jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  addNotificationResponseReceivedListener: mockAddResponseListener,
  clearLastNotificationResponseAsync: mockClearLastResponse,
  getExpoPushTokenAsync: mockGetExpoPushToken,
  getLastNotificationResponseAsync: mockGetLastResponse,
  getPermissionsAsync: mockGetPermissions,
  requestPermissionsAsync: mockRequestPermissions,
  setNotificationChannelAsync: mockSetChannel,
}));

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
  getItemAsync: mockSecureGet,
  setItemAsync: mockSecureSet,
  deleteItemAsync: mockSecureDelete,
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { easConfig: { projectId: "fixture-project-id" }, expoConfig: { extra: {} } },
}));

jest.mock("expo-router", () => ({
  router: { replace: jest.fn() },
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#ffffff",
    border: "#dddddd",
    foreground: "#111111",
    mutedForeground: "#555555",
    accent: "#a51d1d",
    accentForeground: "#ffffff",
  }),
}));

const { PushNotifications } = require("../components/PushNotifications") as typeof import("../components/PushNotifications");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPushNotifications(showSettings = true) {
  let screen!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    screen = await render(<PushNotifications showSettings={showSettings} />);
    await Promise.resolve();
  });
  return screen;
}

async function pressAndFlush(screen: Awaited<ReturnType<typeof render>>, testId: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testId));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

describe("native push opt-in", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.user = { id: "candidate-1", role: "candidate" };
    mockAuth.token = "fixture-session-token";
    mockGetPrivacySettings.mockResolvedValue({ notifications: { jobAlerts: true } });
    mockRegisterPushDevice.mockResolvedValue({ success: true });
    mockRevokePushDevices.mockResolvedValue({ success: true });
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
    mockGetExpoPushToken.mockResolvedValue({ data: "ExponentPushToken[fixture-device-token]" });
    mockAddResponseListener.mockReturnValue({ remove: jest.fn() });
    mockGetLastResponse.mockResolvedValue(null);
    mockClearLastResponse.mockResolvedValue(undefined);
    mockSetChannel.mockResolvedValue(undefined);
    setSavedRegistration(null);
    mockSecureGet.mockImplementation(async () => getSavedRegistration());
    mockSecureSet.mockImplementation(async (_key: string, value: string) => {
      setSavedRegistration(value);
    });
    mockSecureDelete.mockImplementation(async () => {
      setSavedRegistration(null);
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not request operating-system permission until the candidate presses Enable", async () => {
    const screen = await renderPushNotifications();
    await waitFor(() => expect(mockGetPrivacySettings).toHaveBeenCalled());
    expect(screen.getByTestId("enable-push-notifications")).toBeTruthy();
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();

    await pressAndFlush(screen, "enable-push-notifications");

    expect(mockRegisterPushDevice).toHaveBeenCalled();
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Notifications enabled")).toBeTruthy();
  });

  it("keeps notification routing listeners active without rendering a workspace banner", async () => {
    const screen = await renderPushNotifications(false);
    await waitFor(() => expect(mockGetPrivacySettings).toHaveBeenCalled());

    expect(screen.queryByText("Get JOBSAGE updates")).toBeNull();
    expect(screen.queryByTestId("enable-push-notifications")).toBeNull();
    expect(mockAddResponseListener).toHaveBeenCalledTimes(1);
  });

  it("keeps the opt-in hidden when every notification category is disabled", async () => {
    mockGetPrivacySettings.mockResolvedValue({ notifications: { jobAlerts: false, messages: false } });
    const screen = await renderPushNotifications();
    await waitFor(() => expect(mockGetPrivacySettings).toHaveBeenCalled());
    expect(screen.queryByTestId("enable-push-notifications")).toBeNull();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it("shows preference-check failures instead of silently hiding notifications", async () => {
    mockGetPrivacySettings.mockRejectedValue(new Error("fixture failure"));
    const screen = await renderPushNotifications();
    expect(await screen.findByText("Notification preferences could not be checked.")).toBeTruthy();
    expect(screen.queryByTestId("enable-push-notifications")).toBeNull();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it("offers device settings after permission becomes non-requestable", async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    mockRequestPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    const screen = await renderPushNotifications();
    await waitFor(() => expect(mockGetPrivacySettings).toHaveBeenCalled());
    await pressAndFlush(screen, "enable-push-notifications");
    expect(await screen.findByTestId("open-push-settings")).toBeTruthy();
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  });

  it("rechecks permission when the candidate returns from device settings", async () => {
    mockSecureGet.mockResolvedValue(JSON.stringify({
      accountId: "candidate-1",
      pushToken: "ExponentPushToken[fixture-device-token]",
    }));
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    const appStateSpy = jest.spyOn(AppState, "addEventListener");
    const screen = await renderPushNotifications();
    expect(await screen.findByTestId("open-push-settings")).toBeTruthy();
    const onStateChange = appStateSpy.mock.calls
      .find(([eventName]) => eventName === "change")?.[1];
    expect(onStateChange).toBeDefined();

    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: false });
    await act(async () => {
      onStateChange?.("active");
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    expect(screen.getByText("Notifications enabled")).toBeTruthy();
  });

  it("restores the current device registration without asking for permission again", async () => {
    mockSecureGet.mockResolvedValue(JSON.stringify({
      accountId: "candidate-1",
      pushToken: "ExponentPushToken[fixture-device-token]",
    }));
    mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: false });
    const screen = await renderPushNotifications();
    expect(await screen.findByTestId("disable-push-notifications")).toBeTruthy();
    expect(mockGetPermissions).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it("revokes this device only when the candidate explicitly turns notifications off", async () => {
    const screen = await renderPushNotifications();
    await pressAndFlush(screen, "enable-push-notifications");
    expect(mockRevokePushDevices).not.toHaveBeenCalled();

    await pressAndFlush(screen, "disable-push-notifications");

    expect(mockRevokePushDevices).toHaveBeenCalledWith(
      { confirmed: true, token: "ExponentPushToken[fixture-device-token]" },
      expect.objectContaining({
        headers: expect.objectContaining({ "x-jobsage-privacy-account": "candidate-1" }),
      }),
    );
    expect(await screen.findByText("Notifications are off on this device. You can enable them again any time.")).toBeTruthy();
    expect(mockSecureDelete).toHaveBeenCalled();
  });

  it("keeps the server registration when this UI unmounts", async () => {
    const screen = await renderPushNotifications();
    await pressAndFlush(screen, "enable-push-notifications");
    screen.unmount();
    expect(mockRevokePushDevices).not.toHaveBeenCalled();
    expect(mockSecureSet).toHaveBeenCalled();
  });

  it("keeps a disable option when a registration request has an uncertain result", async () => {
    mockRegisterPushDevice.mockRejectedValueOnce(new Error("network interrupted"));
    const screen = await renderPushNotifications();
    await pressAndFlush(screen, "enable-push-notifications");

    expect(await screen.findByTestId("retry-push-notifications")).toBeTruthy();
    expect(screen.getByTestId("disable-push-notifications")).toBeTruthy();
    expect(screen.getByText("Push setup needs attention")).toBeTruthy();

    await pressAndFlush(screen, "disable-push-notifications");
    expect(mockRevokePushDevices).toHaveBeenCalledWith(
      { confirmed: true, token: "ExponentPushToken[fixture-device-token]" },
      expect.any(Object),
    );
  });

  it("revokes an in-flight registration with the original account if the account changes", async () => {
    let finishRegistration!: () => void;
    mockRegisterPushDevice.mockImplementationOnce(() => new Promise((resolve) => {
      finishRegistration = () => resolve({ success: true });
    }));
    const screen = await renderPushNotifications();
    await waitFor(() => expect(mockGetPrivacySettings).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId("enable-push-notifications"));
    await waitFor(() => expect(mockRegisterPushDevice).toHaveBeenCalled());

    await act(async () => {
      mockAuth.user = { id: "candidate-2", role: "candidate" };
      mockAuth.token = "new-account-session-token";
      screen.rerender(<PushNotifications />);
      await Promise.resolve();
    });
    await act(async () => {
      finishRegistration();
      await new Promise<void>((resolve) => setImmediate(resolve));
    });

    await waitFor(() => expect(mockRevokePushDevices).toHaveBeenCalledWith(
      { confirmed: true, token: "ExponentPushToken[fixture-device-token]" },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fixture-session-token",
          "x-jobsage-privacy-account": "candidate-1",
        }),
      }),
    ));
    expect(getSavedRegistration()).toBeNull();
  });
});
