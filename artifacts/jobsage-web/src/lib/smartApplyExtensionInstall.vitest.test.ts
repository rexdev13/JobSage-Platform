import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDesktopSmartApplyInstallAvailable,
  openChromeWebStorePopup,
} from "./smartApplyExtensionInstall";

const originalNavigator = window.navigator;
const originalOpen = window.open;
const originalMatchMedia = window.matchMedia;

function setNavigator(overrides: Partial<Navigator> & { userAgent: string }) {
  vi.stubGlobal("navigator", {
    ...originalNavigator,
    userAgentData: undefined,
    userAgent: overrides.userAgent,
    platform: overrides.platform ?? "Linux x86_64",
    maxTouchPoints: overrides.maxTouchPoints ?? 0,
    ...overrides,
  });
}

beforeEach(() => {
  setNavigator({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.open = originalOpen;
  window.matchMedia = originalMatchMedia;
});

describe("Smart Apply desktop install eligibility", () => {
  it("allows desktop Chrome", () => {
    setNavigator({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0" });

    expect(isDesktopSmartApplyInstallAvailable()).toBe(true);
  });

  it.each([
    ["Android Chrome", "Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile Safari/537.36"],
    ["iPhone Chrome", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130.0.0.0 Mobile/15E148"],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1"],
  ])("blocks the install flow on %s", (_device, userAgent) => {
    setNavigator({ userAgent });

    expect(isDesktopSmartApplyInstallAvailable()).toBe(false);
  });

  it("blocks iPadOS when it reports a desktop Mac user agent", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    });

    expect(isDesktopSmartApplyInstallAvailable()).toBe(false);
  });

  it("blocks touch-first devices even when they request a desktop user agent", () => {
    setNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0",
      userAgentData: { mobile: false } as Navigator["userAgentData"],
    });
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);

    expect(isDesktopSmartApplyInstallAvailable()).toBe(false);
  });
});

describe("Chrome Web Store popup", () => {
  it("opens a page-sized popup from a primary click and severs the opener", () => {
    const popup = { opener: window } as unknown as Window;
    window.open = vi.fn(() => popup);
    const link = document.createElement("a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const storeUrl = "https://chromewebstore.google.com/detail/jobsage-smart-apply/example";

    openChromeWebStorePopup(event as unknown as React.MouseEvent<HTMLAnchorElement>, storeUrl);

    expect(window.open).toHaveBeenCalledTimes(1);
    const [url, name, features] = vi.mocked(window.open).mock.calls[0];
    expect(url).toBe(storeUrl);
    expect(name).toBe("jobsage-chrome-web-store");
    expect(features).toContain("popup=yes");
    expect(features).toContain(`width=${window.innerWidth}`);
    expect(features).toContain(`height=${window.innerHeight}`);
    expect(event.defaultPrevented).toBe(true);
    expect(popup.opener).toBeNull();
    expect(link).toBeTruthy();
  });

  it("leaves the anchor's new-tab fallback active when the browser blocks the popup", () => {
    window.open = vi.fn(() => null);
    const link = document.createElement("a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    openChromeWebStorePopup(
      event as unknown as React.MouseEvent<HTMLAnchorElement>,
      "https://chromewebstore.google.com/detail/jobsage-smart-apply/example",
    );

    expect(event.defaultPrevented).toBe(false);
  });

  it("preserves normal modified-click behavior", () => {
    window.open = vi.fn(() => ({ opener: window }) as unknown as Window);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });

    openChromeWebStorePopup(
      event as unknown as React.MouseEvent<HTMLAnchorElement>,
      "https://chromewebstore.google.com/detail/jobsage-smart-apply/example",
    );

    expect(window.open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
