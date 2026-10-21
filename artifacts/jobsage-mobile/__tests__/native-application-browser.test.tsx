import React from "react";
import { Platform } from "react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import type { MobileApplicationContext } from "@workspace/api-client-react";

const mockInject = jest.fn();
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ token: "fixture-session", user: { id: "fixture-candidate" } }),
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff", foreground: "#111", mutedForeground: "#666", border: "#ddd",
    accent: "#900", accentForeground: "#fff", card: "#fff", radius: 12, destructive: "#c00",
  }),
}));
jest.mock("@/lib/native-download", () => ({
  DownloadError: class extends Error {},
  downloadAndShare: jest.fn(),
}));
jest.mock("@/lib/external-links", () => ({
  safeLinkLogContext: () => ({ scheme: "https", host: "employer.example.org" }),
  classifyEmployerWindowTarget: () => ({ kind: "blocked" }),
  classifyUrl: () => "blocked",
  openExternal: jest.fn(),
  showInAppContactLink: jest.fn(),
}));
jest.mock("@/lib/smart-apply/protocol", () => ({
  createSmartApplyChannel: () => "fixture-channel",
  configureScript: () => "configure-assistant",
  commandScript: (command: { type: string }) => `command:${command.type}`,
  validatePageMessage: () => null,
}));
jest.mock("@workspace/smart-apply-core/native-script", () => ({
  nativeSmartApplyScript: "assistant-bootstrap",
}));
jest.mock("@/components/SmartApplyAssistant", () => ({
  SmartApplyAssistant: () => {
    const React = require("react");
    const { View } = require("react-native");
    return React.createElement(View, { testID: "smart-apply-panel" });
  },
}));
jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: React.forwardRef((props: object, ref: React.ForwardedRef<unknown>) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
      return React.createElement(View, { ...props, testID: "employer-webview" });
    }),
  };
});

import { NativeApplicationBrowser } from "@/components/NativeApplicationBrowser";

afterEach(() => {
  jest.restoreAllMocks();
  mockInject.mockClear();
});

describe("Android Smart Apply browser", () => {
  it("shows a readable access-denied state for a main-page 403 and lets the candidate retry", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const context = {
      id: 73, applicationUrl: "https://employer.example.org/apply",
      jobTitle: "Staff nurse", companyName: "Example Trust",
    } as MobileApplicationContext;
    const screen = await render(<NativeApplicationBrowser context={context} visible onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId("app-browser-assistant"));
    await fireEvent(screen.getByTestId("employer-webview"), "httpError", {
      nativeEvent: { url: context.applicationUrl, statusCode: 403 },
    });
    expect(screen.getByText("Website refused access")).toBeTruthy();
    expect(screen.getByText(/HTTP 403/)).toBeTruthy();
    expect(screen.queryByTestId("employer-webview")).toBeNull();
    expect(screen.queryByTestId("smart-apply-panel")).toBeNull();
    expect(screen.getByTestId("app-browser-assistant").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText("Retry"));
    expect(screen.getByTestId("employer-webview").props.source.uri).toBe(context.applicationUrl);
    expect(screen.queryByText("Website refused access")).toBeNull();
  });

  it("does not replace the application page when a subresource returns 403", async () => {
    const context = {
      id: 73, applicationUrl: "https://employer.example.org/apply",
      jobTitle: "Staff nurse", companyName: "Example Trust",
    } as MobileApplicationContext;
    const screen = await render(<NativeApplicationBrowser context={context} visible onClose={jest.fn()} />);
    await fireEvent(screen.getByTestId("employer-webview"), "httpError", {
      nativeEvent: { url: "https://employer.example.org/logo.png", statusCode: 403 },
    });
    expect(screen.getByTestId("employer-webview")).toBeTruthy();
    expect(screen.queryByText("Website refused access")).toBeNull();
  });

  it("injects the assistant, permits safely handled async pop-ups, and opens its labeled control", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const context = {
      id: 73, applicationUrl: "https://employer.example.org/apply",
      jobTitle: "Staff nurse", companyName: "Example Trust",
    } as MobileApplicationContext;
    const screen = await render(
      <NativeApplicationBrowser context={context} visible onClose={jest.fn()} />,
    );
    const browser = screen.getByTestId("employer-webview");
    expect(browser.props.injectedJavaScript).toContain("assistant-bootstrap");
    expect(browser.props.javaScriptCanOpenWindowsAutomatically).toBe(true);
    expect(typeof browser.props.onOpenWindow).toBe("function");
    expect(screen.getByText("Smart Apply")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("app-browser-assistant"));
    expect(screen.getByTestId("smart-apply-panel")).toBeTruthy();
    expect(mockInject).toHaveBeenCalledWith("command:scan");
  });
});
