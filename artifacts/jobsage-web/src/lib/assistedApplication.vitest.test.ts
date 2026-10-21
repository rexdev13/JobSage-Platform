import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSISTED_APPLICATION_EVENT, beginAssistedApplication, isRecentInProgress, shouldUseAssistedWorkspace } from "./assistedApplication";

describe("assisted application tracking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.__JOBSAGE_NATIVE__;
    delete window.ReactNativeWebView;
    document.body.innerHTML = "";
  });

  it("opens native Smart Apply exactly once after tracking commits, without a React relay or pop-up", async () => {
    const postMessage = vi.fn();
    window.__JOBSAGE_NATIVE__ = { version: 1, channel: "a".repeat(48), challenge: "b".repeat(64) };
    window.ReactNativeWebView = { postMessage };
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = beginAssistedApplication("https://board.example.org/jobs/41", {
      title: "Nurse", employer: "Trust", roleId: 41,
    });
    expect(postMessage).not.toHaveBeenCalled();
    finish(new Response(JSON.stringify({ id: 73, status: "in_progress" }), { status: 201 }));
    await pending;
    expect(open).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledOnce();
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({ type: "application", applicationId: 73 });
  });

  it("does not hand an unsuccessful native application to the employer browser", async () => {
    const postMessage = vi.fn();
    window.__JOBSAGE_NATIVE__ = { version: 1, channel: "a".repeat(48), challenge: "b".repeat(64) };
    window.ReactNativeWebView = { postMessage };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Please retry" }), { status: 503 }),
    ));
    await beginAssistedApplication("https://board.example.org/jobs/41", { roleId: 41 });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("uses assisted flow on phones even with an extension marker, and on extensionless desktop", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(shouldUseAssistedWorkspace()).toBe(true);
    document.body.innerHTML = '<div id="jobsage-extension-root"></div>';
    expect(shouldUseAssistedWorkspace()).toBe(false);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(shouldUseAssistedWorkspace()).toBe(true);
  });

  it("commits in_progress before navigating the reserved tab", async () => {
    const replace = vi.fn();
    const tab = { opener: window, location: { replace }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const events = vi.fn();
    window.addEventListener(ASSISTED_APPLICATION_EVENT, events);
    const pending = beginAssistedApplication("https://employer.example/apply?ref=jobsage", { title: "Nurse", employer: "Trust", roleId: 41 });
    expect(replace).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).status).toBe("in_progress");
    finish(new Response(JSON.stringify({ id: 1, status: "in_progress", appliedAt: new Date().toISOString() }), { status: 201 }));
    await pending;
    expect(replace).toHaveBeenCalledWith("https://employer.example/apply?ref=jobsage");
    expect(tab.opener).toBe(null);
    expect(events.mock.calls.map(call => call[0].detail.phase)).toEqual(["saving", "ready"]);
    expect(events.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(window.open).mock.invocationCallOrder[0]!);
    window.removeEventListener(ASSISTED_APPLICATION_EVENT, events);
  });

  it("tags an extensionless desktop assisted flow so it uses desktop prompt wording", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px)",
    }));
    const tab = { location: { replace: vi.fn() }, close: vi.fn(), opener: null };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 2, status: "in_progress", appliedAt: new Date().toISOString() }), { status: 201 }),
    ));
    const events = vi.fn();
    window.addEventListener(ASSISTED_APPLICATION_EVENT, events);
    await beginAssistedApplication("https://employer.example/apply", { title: "Nurse", employer: "Trust", roleId: 41 });
    expect(events.mock.calls[0]![0].detail).toMatchObject({ source: "desktop-assisted", phase: "saving" });
    expect(events.mock.calls.at(-1)![0].detail).toMatchObject({ source: "desktop-assisted", phase: "ready" });
    window.removeEventListener(ASSISTED_APPLICATION_EVENT, events);
  });

  it("never navigates on tracking failure and surfaces retryable error", async () => {
    const tab = { location: { replace: vi.fn() }, close: vi.fn(), opener: null };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Offline" }), { status: 503 })));
    const events = vi.fn();
    window.addEventListener(ASSISTED_APPLICATION_EVENT, events);
    await beginAssistedApplication("https://employer.example/apply", { title: "Nurse", employer: "Trust" });
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(tab.close).toHaveBeenCalledOnce();
    expect(events.mock.calls.at(-1)![0].detail).toMatchObject({ phase: "error", error: "Offline" });
    window.removeEventListener(ASSISTED_APPLICATION_EVENT, events);
  });

  it("reminds only about pending applications within 48 hours", () => {
    const now = new Date().toISOString();
    expect(isRecentInProgress({ status: "in_progress", appliedAt: now })).toBe(true);
    expect(isRecentInProgress({ status: "applied", appliedAt: now })).toBe(false);
    expect(isRecentInProgress({ status: "in_progress", appliedAt: new Date(Date.now() - 49 * 3600000).toISOString() })).toBe(false);
  });
});