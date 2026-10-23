import React from "react";
import { Platform, StyleSheet } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { LaunchScreen } from "../components/LaunchScreen";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

afterEach(() => { jest.restoreAllMocks(); });

describe("splash handoff artwork", () => {
  it("keeps the existing full asset contained, centered, and seam-free", async () => {
    const screen = await render(<LaunchScreen testID="launch" />);
    const root = screen.getByTestId("launch");
    const image = screen.getByTestId("launch-logo");
    const rootStyle = StyleSheet.flatten(root.props.style);
    const imageStyle = StyleSheet.flatten(image.props.style);
    expect(image.props.source).toEqual(require("../assets/images/splash-logo.png"));
    expect(image.props.resizeMode).toBe("contain");
    expect(image.props.fadeDuration).toBe(0);
    expect(rootStyle).toMatchObject({
      backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center",
      top: 0, bottom: 0, left: 0, right: 0,
    });
    expect(imageStyle.width / imageStyle.height).toBeCloseTo(1600 / 351);
  });

  it("waits for image decode after layout, and reports readiness only once", async () => {
    const ready = jest.fn();
    const screen = await render(<LaunchScreen onReady={ready} testID="launch" />);
    await fireEvent(screen.getByTestId("launch"), "layout", layout);
    expect(ready).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("launch-logo"), "load");
    expect(ready).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId("launch"), "layout", layout);
    await fireEvent(screen.getByTestId("launch-logo"), "load");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("also waits for layout when the image loads first", async () => {
    const ready = jest.fn();
    const screen = await render(<LaunchScreen onReady={ready} testID="launch" />);
    await fireEvent(screen.getByTestId("launch-logo"), "load");
    expect(ready).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("launch"), "layout", layout);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("reports asset failures rather than trapping the user on the splash", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    const ready = jest.fn();
    const screen = await render(<LaunchScreen onReady={ready} testID="launch" />);
    await fireEvent(screen.getByTestId("launch"), "layout", layout);
    await fireEvent(screen.getByTestId("launch-logo"), "error", { nativeEvent: { error: "Decode failed" } });
    expect(warning).toHaveBeenCalled();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("keeps Android's complete lockup within the 192dp safe circle", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const screen = await render(<LaunchScreen testID="launch" />);
    const { width, height } = StyleSheet.flatten(screen.getByTestId("launch-logo").props.style);
    expect(width).toBe(184);
    expect(Math.hypot(width, height)).toBeLessThan(192);
  });
});
