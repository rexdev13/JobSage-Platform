import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: any[]) => any;

function createChromeHarness() {
  const session = new Map<string, unknown>();
  const listeners = {
    connect: [] as Listener[],
    before: [] as Listener[],
    created: [] as Listener[],
    committed: [] as Listener[],
    removed: [] as Listener[],
    messages: [] as Listener[],
  };
  const delayed = { enabled: false };
  const storage = {
    async get(area: "session" | "local" | "sync", key?: string | Record<string, unknown>) {
      if (delayed.enabled) await new Promise((resolve) => setTimeout(resolve, 2));
      const result: Record<string, unknown> = {};
      const keys = typeof key === "string" ? [key] : key ? Object.keys(key) : Array.from(session.keys()).filter((k) => k.startsWith(`${area}:`)).map((k) => k.slice(area.length + 1));
      for (const name of keys) result[name] = session.get(`${area}:${name}`) ?? (typeof key === "object" ? key[name] : undefined);
      return result;
    },
    async set(area: "session" | "local" | "sync", values: Record<string, unknown>) {
      if (delayed.enabled) await new Promise((resolve) => setTimeout(resolve, 2));
      for (const [name, value] of Object.entries(values)) session.set(`${area}:${name}`, value);
    },
    async remove(area: "session" | "local" | "sync", key: string) {
      session.delete(`${area}:${key}`);
    },
  };
  const event = (list: Listener[]) => ({ addListener: (listener: Listener) => list.push(listener) });
  const chrome = {
    cookies: { get: vi.fn(async () => null) },
    downloads: { download: vi.fn() },
    runtime: {
      onConnect: event(listeners.connect),
      onMessage: event(listeners.messages),
      lastError: undefined,
    },
    storage: {
      session: { get: (key: any) => storage.get("session", key), set: (v: any) => storage.set("session", v), remove: (k: any) => storage.remove("session", k) },
      local: { get: (key: any) => storage.get("local", key), set: (v: any) => storage.set("local", v), remove: (k: any) => storage.remove("local", k) },
      sync: { get: (key: any) => storage.get("sync", key), set: (v: any) => storage.set("sync", v), remove: (k: any) => storage.remove("sync", k) },
    },
    tabs: {
      onRemoved: event(listeners.removed),
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
    },
    webNavigation: {
      onBeforeNavigate: event(listeners.before),
      onCreatedNavigationTarget: event(listeners.created),
      onCommitted: event(listeners.committed),
    },
  };
  return { chrome, listeners, session, delayed };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 15));
}

async function loadBackground(harness: ReturnType<typeof createChromeHarness>) {
  vi.resetModules();
  vi.stubGlobal("chrome", harness.chrome);
  await import("../background");
  return harness;
}

async function register(harness: ReturnType<typeof createChromeHarness>, sourceTabId: number, applicationUrl: string) {
  const listener = harness.listeners.messages.at(-1)!;
  let response: unknown;
  listener(
    { type: "REGISTER_TRACKED_APPLICATION", applicationUrl, jobTitle: "Role", employer: "Employer" },
    { tab: { id: sourceTabId }, url: "https://jobsage.co.uk/jobs/1" },
    (value: unknown) => { response = value; },
  );
  await settle();
  return response;
}

function activationKeys(session: Map<string, unknown>) {
  return session.get("session:jobsage_tab_activations") as Record<string, unknown> | undefined;
}

afterEach(() => vi.unstubAllGlobals());

describe("background trusted navigation listeners", () => {
  it("correlates placeholder target when registration arrives after onCreated/onBefore", async () => {
    const h = await loadBackground(createChromeHarness());
    const url = "https://ats.example/apply/one?ref=jobsage";
    h.listeners.created[0]({ sourceTabId: 1, tabId: 2, url: "about:blank" });
    await settle();
    h.listeners.before[0]({ frameId: 0, tabId: 2, url });
    await settle();
    await register(h, 1, url);
    expect(activationKeys(h.session)?.["2"]).toMatchObject({ applicationUrl: url });
  });

  it("correlates registration before placeholder target navigation", async () => {
    const h = await loadBackground(createChromeHarness());
    const url = "https://ats.example/apply/two?ref=jobsage";
    await register(h, 3, url);
    h.listeners.created[0]({ sourceTabId: 3, tabId: 4, url: "about:blank" });
    await settle();
    h.listeners.before[0]({ frameId: 0, tabId: 4, url });
    await settle();
    expect(activationKeys(h.session)?.["4"]).toMatchObject({ applicationUrl: url });
  });

  it("survives worker restart with delayed session storage and preserves both tabs", async () => {
    const h = createChromeHarness();
    h.delayed.enabled = true;
    await loadBackground(h);
    const first = "https://ats.example/apply/first?ref=jobsage";
    const second = "https://ats.example/apply/second?ref=jobsage";
    h.listeners.created[0]({ sourceTabId: 10, tabId: 11, url: "about:blank" });
    h.listeners.created[0]({ sourceTabId: 20, tabId: 21, url: "about:blank" });
    await settle();
    await loadBackground(h);
    await Promise.all([register(h, 10, first), register(h, 20, second)]);
    h.listeners.before[0]({ frameId: 0, tabId: 11, url: first });
    h.listeners.before[0]({ frameId: 0, tabId: 21, url: second });
    // Wait for both persisted writes, not a wall-clock assumption that breaks
    // when the suite runs several DOM workers in parallel.
    await vi.waitFor(() => {
      expect(activationKeys(h.session)?.["11"]).toMatchObject({ applicationUrl: first });
      expect(activationKeys(h.session)?.["21"]).toMatchObject({ applicationUrl: second });
    }, { timeout: 1000, interval: 10 });
  });

  it("clears tracked context for an unrelated cross-origin ref-only commit", async () => {
    const h = await loadBackground(createChromeHarness());
    const url = "https://ats.example/apply/three?ref=jobsage";
    await register(h, 30, url);
    h.listeners.created[0]({ sourceTabId: 30, tabId: 31, url });
    await settle();
    expect(activationKeys(h.session)?.["31"]).toBeDefined();
    h.listeners.committed[0]({
      frameId: 0,
      tabId: 31,
      url: "https://other.example/not-the-application?ref=jobsage",
      transitionType: "link",
      transitionQualifiers: [],
    });
    await settle();
    expect(activationKeys(h.session)?.["31"]).toBeUndefined();
  });

  it("never activates an unregistered ref-only destination", async () => {
    const h = await loadBackground(createChromeHarness());
    h.listeners.before[0]({
      frameId: 0,
      tabId: 99,
      url: "https://ats.example/untrusted?ref=jobsage",
    });
    await settle();
    expect(activationKeys(h.session)?.["99"]).toBeUndefined();
  });
});

describe("background AI request safeguards", () => {
  async function message(h: ReturnType<typeof createChromeHarness>, payload: unknown, url = "https://ats.example/apply") {
    return new Promise<any>((resolve) => {
      const result = h.listeners.messages.at(-1)!(payload, { tab: { id: 61 }, url }, resolve);
      if (result === false) resolve(undefined);
    });
  }

  it("allows mapping without a consent prompt and retains the endpoint allowlist", async () => {
    const h = await loadBackground(createChromeHarness());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ values: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = { type: "API_REQUEST", endpoint: "/smart-apply/structured-prefill", method: "POST", body: { fields: [] } };
    expect((await message(h, request)).data).toEqual({ values: [] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://jobsage.co.uk/api/smart-apply/extension/structured-prefill");
    expect((await message(h, { ...request, endpoint: "/smart-apply/assistant" })).error).toContain("not available");
  });

  it("still blocks sensitive content before making an AI mapping request", async () => {
    const h = await loadBackground(createChromeHarness());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await message(h, {
      type: "API_REQUEST", endpoint: "/smart-apply/structured-prefill", method: "POST",
      body: { fields: [{ id: "bank", label: "My bank account number" }] },
    });
    expect(response.error).toContain("Sensitive information");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a streaming AI request without authentication", async () => {
    const h = await loadBackground(createChromeHarness());
    const listeners: Listener[] = [];
    const port = {
      name: "assistant-stream", sender: { tab: { id: 61 }, url: "https://ats.example/apply" },
      onDisconnect: { addListener: vi.fn() },
      onMessage: { addListener: (f: Listener) => listeners.push(f) },
      postMessage: vi.fn(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    h.listeners.connect[0](port);
    listeners[0]({ message: "Why this role?", questionText: "Why this role?" });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error", kind: "auth" }));
  });
});