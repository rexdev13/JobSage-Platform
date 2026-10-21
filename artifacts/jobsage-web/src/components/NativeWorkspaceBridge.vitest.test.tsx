import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeWorkspaceBridge } from "./NativeWorkspaceBridge";

const browserOpen = window.open;
const fixture = vi.hoisted(() => ({
  postMessage: vi.fn(),
  grant: vi.fn(),
}));
vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({ user: { id: "native-candidate" } }),
}));
vi.mock("@workspace/api-client-react", () => ({
  createMobileSessionGrant: (...args: unknown[]) => fixture.grant(...args),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/opportunities"],
}));

function installMarker() {
  window.ReactNativeWebView = { postMessage: fixture.postMessage };
  window.__JOBSAGE_NATIVE__ = { version: 1, channel: "a".repeat(48), challenge: "b".repeat(64) };
}

beforeEach(() => {
  fixture.postMessage.mockClear();
  fixture.grant.mockReset().mockResolvedValue({ code: "c".repeat(64) });
});
afterEach(() => {
  cleanup();
  delete window.__JOBSAGE_NATIVE__;
  delete window.ReactNativeWebView;
  vi.restoreAllMocks();
  window.open = browserOpen;
  document.body.innerHTML = "";
});

describe("native workspace Android recovery", () => {
  it("activates session handoff when native bootstrap arrives after React mounts", async () => {
    render(<NativeWorkspaceBridge />);
    expect(fixture.grant).not.toHaveBeenCalled();
    act(() => {
      installMarker();
      window.dispatchEvent(new Event("jobsage:native-ready"));
    });
    await waitFor(() => expect(fixture.postMessage.mock.calls.some(
      ([raw]) => JSON.parse(raw).type === "session",
    )).toBe(true));
    expect(fixture.grant).toHaveBeenCalledWith({ challenge: "b".repeat(64), audience: "native" });
    act(() => window.dispatchEvent(new Event("jobsage:native-ready")));
    expect(fixture.grant).toHaveBeenCalledOnce();
  });

  it("routes programmatic pop-ups and new-tab anchors without Android window.open support", async () => {
    installMarker();
    // The app deliberately replaces this function; a spy's accessor can hide
    // the replacement in JSDOM. Use the same writable property as a WebView.
    const originalOpen = vi.fn(() => null);
    window.open = originalOpen;
    const { unmount } = render(<NativeWorkspaceBridge />);
    await waitFor(() => expect(window.open).not.toBe(originalOpen));
    fixture.postMessage.mockClear();
    expect(window.open("https://ats.example.org/apply", "_blank", "noopener")).toBeNull();
    expect(originalOpen).not.toHaveBeenCalled();
    expect(JSON.parse(fixture.postMessage.mock.calls[0][0])).toMatchObject({
      type: "open-url", destination: "https://ats.example.org/apply",
    });
    const anchor = document.createElement("a");
    anchor.href = "https://employer.example.org/careers";
    anchor.target = "_blank";
    anchor.innerHTML = "<span>Employer website</span>";
    document.body.appendChild(anchor);
    fireEvent.click(anchor.firstChild!);
    expect(JSON.parse(fixture.postMessage.mock.calls[1][0])).toMatchObject({
      type: "open-url", destination: "https://employer.example.org/careers",
    });
    window.open("/applications", "_self");
    expect(originalOpen).toHaveBeenCalledWith("/applications", "_self", undefined);
    unmount();
    expect(window.open).toBe(originalOpen);
  });

  it("does not enable native behavior for a normal browser or a forged readiness event", () => {
    const originalOpen = window.open;
    render(<NativeWorkspaceBridge />);
    act(() => window.dispatchEvent(new Event("jobsage:native-ready")));
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(window.open).toBe(originalOpen);
  });
});
