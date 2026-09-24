import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: any[]) => any;

function createChromeHarness() {
  const session = new Map<string, unknown>();
  const listeners = {
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
      const keys = typeof key === "string" ? [key] : key ? Object.keys(key) : [];
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
      onConnect: event([]),
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
    await settle();
    expect(activationKeys(h.session)?.["11"]).toMatchObject({ applicationUrl: first });
    expect(activationKeys(h.session)?.["21"]).toMatchObject({ applicationUrl: second });
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