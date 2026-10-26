import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtensionRequiredModal,
  SmartApplyExtensionBanner,
  SmartApplyExtensionNudge,
} from "./SmartApplyExtensionPrompt";

const originalNavigator = window.navigator;
const originalOpen = window.open;
const STORE_URL = "https://chromewebstore.google.com/detail/jobsage-smart-apply/dnafhjmagedfebkfdackdbgkpgklpokb";

function useDesktopBrowser() {
  vi.stubGlobal("navigator", {
    ...originalNavigator,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0",
    userAgentData: { mobile: false },
    platform: "Linux x86_64",
    maxTouchPoints: 0,
  });
}

function useMobileBrowser() {
  vi.stubGlobal("navigator", {
    ...originalNavigator,
    userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36",
    userAgentData: { mobile: true },
    platform: "Linux armv8l",
    maxTouchPoints: 5,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_CHROME_WEB_STORE_URL", STORE_URL);
  useDesktopBrowser();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.open = originalOpen;
  localStorage.clear();
});

describe("Smart Apply install prompt", () => {
  it("opens the listing in a separate desktop popup from the Add to Chrome action", () => {
    const popup = { opener: window } as unknown as Window;
    window.open = vi.fn(() => popup);

    render(<SmartApplyExtensionBanner />);
    fireEvent.click(screen.getByRole("button", { name: /get the extension/i }));

    const link = screen.getByRole("link", { name: /add to chrome/i });
    expect(link).toHaveAttribute("href", STORE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/opens in a separate window/i)).toBeInTheDocument();
    fireEvent.click(link);

    expect(window.open).toHaveBeenCalledWith(
      STORE_URL,
      "jobsage-chrome-web-store",
      expect.stringContaining(`width=${window.innerWidth}`),
    );
    expect(window.open).toHaveBeenCalledWith(
      STORE_URL,
      "jobsage-chrome-web-store",
      expect.stringContaining(`height=${window.innerHeight}`),
    );
    expect(popup.opener).toBeNull();
  });

  it("uses a desktop-only notice and hides all install actions on mobile", () => {
    useMobileBrowser();

    render(<SmartApplyExtensionBanner />);

    expect(screen.getByText("Smart Apply is available on desktop Chrome")).toBeInTheDocument();
    expect(screen.getByText(/open jobsage on a desktop or laptop/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /get the extension/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add to chrome/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download the extension/i })).not.toBeInTheDocument();
  });

  it("does not show the employer-page install nudge on mobile", () => {
    useMobileBrowser();

    render(<SmartApplyExtensionNudge open onClose={vi.fn()} />);

    expect(screen.queryByText("Applying on an employer site?")).not.toBeInTheDocument();
  });

  it("does not show the extension-required modal on mobile", () => {
    useMobileBrowser();

    render(<ExtensionRequiredModal open onClose={vi.fn()} />);

    expect(screen.queryByText(/install the smart apply extension to apply/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add to chrome/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download the extension/i })).not.toBeInTheDocument();
  });
});
