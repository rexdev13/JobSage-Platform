import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: mockRouterPush },
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#ffffff",
    border: "#dddddd",
    foreground: "#111111",
    mutedForeground: "#555555",
    muted: "#f5f5f5",
    accent: "#a51d1d",
    card: "#ffffff",
  }),
}));

const { WorkspaceQuickLinks } = require("../components/WorkspaceQuickLinks") as typeof import("../components/WorkspaceQuickLinks");

describe("candidate workspace quick links", () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
  });

  it("makes core candidate tools reachable with screen-reader labels", async () => {
    const screen = await render(<WorkspaceQuickLinks />);
    for (const id of ["opportunities", "inbox", "calendar", "documents"]) {
      expect(screen.getByTestId(`workspace-shortcut-${id}`)).toBeTruthy();
    }
    expect(screen.getByLabelText("Open Interview calendar in the full JOBSAGE workspace")).toBeTruthy();
    expect(screen.getByLabelText("Open CV and documents")).toBeTruthy();
  });

  it.each([
    ["opportunities", "/opportunities"],
    ["inbox", "/inbox"],
    ["calendar", "/calendar"],
  ])("opens %s through the authenticated full workspace", async (id, path) => {
    const screen = await render(<WorkspaceQuickLinks />);
    fireEvent.press(screen.getByTestId(`workspace-shortcut-${id}`));
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/workspace",
      params: { path },
    });
  });

  it("opens CV and documents in the native companion", async () => {
    const screen = await render(<WorkspaceQuickLinks />);
    fireEvent.press(screen.getByTestId("workspace-shortcut-documents"));
    expect(mockRouterPush).toHaveBeenCalledWith("/companion/documents");
  });
});
