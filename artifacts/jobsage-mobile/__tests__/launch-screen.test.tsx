import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { LaunchScreen } from "../components/LaunchScreen";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

afterEach(() => { jest.restoreAllMocks(); });

describe("splash handoff spinner", () => {
  it("keeps the spinner centered and accessible", async () => {
    const screen = await render(<LaunchScreen testID="launch" />);
    const root = screen.getByTestId("launch");
    const spinner = screen.getByTestId("launch-spinner");
    const rootStyle = StyleSheet.flatten(root.props.style);
    expect(rootStyle).toMatchObject({
      backgroundColor: "#fdfcfc", alignItems: "center", justifyContent: "center",
      top: 0, bottom: 0, left: 0, right: 0,
    });
    expect(root.props.accessibilityRole).toBe("progressbar");
    expect(root.props.accessibilityLabel).toBe("Loading JOBSAGE workspace");
    expect(spinner.props.size).toBe("large");
    expect(screen.getByText("JOBSAGE")).toBeTruthy();
  });

  it("waits for layout and reports readiness only once", async () => {
    const ready = jest.fn();
    const screen = await render(<LaunchScreen onReady={ready} testID="launch" />);
    expect(ready).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("launch"), "layout", layout);
    expect(ready).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId("launch"), "layout", layout);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
