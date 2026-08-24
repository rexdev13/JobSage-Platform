import { getEnvSettings, activeOrigin, apiBase } from "./lib/env";
import {
  isTrackingContextFresh,
  nextTrackingContext,
  type TabTrackingContext,
} from "./lib/trackingContext";

const SESSION_COOKIE_NAME = "sid";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const ACTIVATION_SESSION_KEY = "jobsage_tab_activations";
const SITE_SUPPRESSIONS_KEY = "jobsage_site_suppressions";
const SESSION_SUPPRESSIONS_KEY = "jobsage_session_suppressions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSessionToken(cookieUrl: string): Promise<string | null> {
  const cookie = await chrome.cookies.get({
    url: cookieUrl,
    name: SESSION_COOKIE_NAME,
  });
  return cookie?.value ?? null;
}

/**
 * Return the eTLD+1 for a hostname so we can compare cross-page activations.
 * Handles common UK second-level TLDs (.co.uk, .org.uk, .nhs.uk, etc.).
 */
function getEtld1(hostname: string): string {
  const parts = hostname.replace(/^www\./, "").split(".");
  const ukSld = ["co", "org", "me", "net", "ac", "gov", "nhs", "ltd", "plc"];
  if (parts.length >= 3 && parts[parts.length - 1] === "uk" && ukSld.includes(parts[parts.length - 2])) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

type TabActivation = TabTrackingContext;

async function getActivations(): Promise<Record<string, TabActivation>> {
  const stored = await chrome.storage.session.get(ACTIVATION_SESSION_KEY);
  return (stored[ACTIVATION_SESSION_KEY] ?? {}) as Record<string, TabActivation>;
}

async function setActivations(map: Record<string, TabActivation>): Promise<void> {
  await chrome.storage.session.set({ [ACTIVATION_SESSION_KEY]: map });
}

async function getSiteSuppressions(): Promise<string[]> {
  const stored = await chrome.storage.local.get(SITE_SUPPRESSIONS_KEY);
  return (stored[SITE_SUPPRESSIONS_KEY] ?? []) as string[];
}

async function getSessionSuppressions(): Promise<string[]> {
  const stored = await chrome.storage.session.get(SESSION_SUPPRESSIONS_KEY);
  return (stored[SESSION_SUPPRESSIONS_KEY] ?? []) as string[];
}

// ---------------------------------------------------------------------------
// Tab activation tracking
// Marks a tab as "JOBSAGE-activated" when it navigates to a URL with
// ?ref=jobsage (before any redirect strips the param).
// Expires when the tab moves to a clearly different domain.
// ---------------------------------------------------------------------------

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // main frame only
  try {
    const url = new URL(details.url);
    if (url.searchParams.get("ref") !== "jobsage") return;
    const etld1 = getEtld1(url.hostname);
    const map = await getActivations();
    map[details.tabId] = { etld1, activatedAt: Date.now(), applicationUrl: url.toString() };
    await setActivations(map);
  } catch {
    // invalid URL — ignore
  }
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const url = new URL(details.url);
    // If this navigation itself carries ?ref=jobsage, activation was just
    // (re)set in onBeforeNavigate — don't immediately clear it.
    if (url.searchParams.get("ref") === "jobsage") return;

    const map = await getActivations();
    const entry = map[details.tabId];
    if (!entry) return;

    const next = nextTrackingContext(entry, getEtld1(url.hostname), details);
    if (next !== entry) {
      if (next) {
        map[details.tabId] = next;
      } else {
        delete map[details.tabId];
      }
      await setActivations(map);
    }
  } catch {
    // ignore
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getActivations();
  if (map[tabId]) {
    delete map[tabId];
    await setActivations(map);
  }
});

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface ApiRequestMessage {
  type: "API_REQUEST";
  endpoint: string;
  method?: string;
  body?: unknown;
}

interface GetTokenMessage {
  type: "GET_TOKEN";
}

interface CheckActivationMessage {
  type: "CHECK_ACTIVATION";
  tabId?: number; // optional; background resolves from sender when omitted
}

interface GetTrackingContextMessage {
  type: "GET_TRACKING_CONTEXT";
}

interface GetSuppressionMessage {
  type: "GET_SUPPRESSION";
  hostname: string;
}

interface SetSuppressionMessage {
  type: "SET_SUPPRESSION";
  hostname: string;
  scope: "site" | "session";
}

interface ClearSuppressionMessage {
  type: "CLEAR_SUPPRESSION";
  hostname: string;
}

interface GetAllSuppressionsMessage {
  type: "GET_ALL_SUPPRESSIONS";
}

interface ActivateCurrentTabMessage {
  type: "ACTIVATE_CURRENT_TAB";
}

type IncomingMessage =
  | ApiRequestMessage
  | GetTokenMessage
  | CheckActivationMessage
  | GetTrackingContextMessage
  | GetSuppressionMessage
  | SetSuppressionMessage
  | ClearSuppressionMessage
  | GetAllSuppressionsMessage
  | ActivateCurrentTabMessage;

interface ApiResponseSuccess { data: unknown }
interface ApiResponseError { error: string }
interface TokenResponse { token: string | null }
interface ActivationResponse { activated: boolean }
interface TrackingContextResponse { applicationUrl: string | null }
interface SuppressionResponse { suppressed: "site" | "session" | null }
interface SuppressionListResponse { hostnames: string[] }
interface OkResponse { ok: true }

type AnyResponse =
  | ApiResponseSuccess
  | ApiResponseError
  | TokenResponse
  | ActivationResponse
  | TrackingContextResponse
  | SuppressionResponse
  | SuppressionListResponse
  | OkResponse;

// ---------------------------------------------------------------------------
// Long-lived port relay for the streaming assistant endpoint
// ---------------------------------------------------------------------------

interface AssistantStreamRequest {
  message: string;
}

type AssistantStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "error"; kind: "auth" | "server" | "network"; status?: number; message?: string }
  | { type: "done" };

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "assistant-stream") return;

  let aborted = false;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => {
    aborted = true;
    controller.abort();
  });

  const post = (event: AssistantStreamEvent) => {
    if (!aborted) {
      try {
        port.postMessage(event);
      } catch {
        aborted = true;
      }
    }
  };

  port.onMessage.addListener((request: AssistantStreamRequest) => {
    (async () => {
      const settings = await getEnvSettings();
      const token = await getSessionToken(activeOrigin(settings));
      if (!token) {
        post({ type: "error", kind: "auth" });
        return;
      }

      let response: Response;
      try {
        response = await fetch(`${apiBase(settings)}/smart-apply/assistant`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: request.message }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          post({ type: "error", kind: "network", message: (err as Error).message });
        }
        return;
      }

      if (response.status === 401 || response.status === 403) {
        post({ type: "error", kind: "auth", status: response.status });
        return;
      }
      if (!response.ok || !response.body) {
        let message: string | undefined;
        try {
          const parsed = (await response.json()) as { error?: string };
          message = parsed.error;
        } catch {
          // non-JSON error body
        }
        post({ type: "error", kind: "server", status: response.status, message });
        return;
      }

      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6)) as { text?: string; error?: string };
              if (payload.error) {
                post({ type: "error", kind: "server", message: payload.error });
              } else if (payload.text) {
                post({ type: "chunk", text: payload.text });
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
        post({ type: "done" });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          post({ type: "error", kind: "network", message: (err as Error).message });
        }
      }
    })();
  });
});

// ---------------------------------------------------------------------------
// One-shot message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: AnyResponse) => void,
  ) => {
    // --- GET_TOKEN ---
    if (message.type === "GET_TOKEN") {
      getEnvSettings()
        .then((settings) => getSessionToken(activeOrigin(settings)))
        .then((token) => sendResponse({ token }));
      return true;
    }

    // --- CHECK_ACTIVATION ---
    if (message.type === "CHECK_ACTIVATION") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ activated: false });
        return false;
      }
      getActivations()
        .then(async (map) => {
          const activation = map[tabId];
          if (activation && !isTrackingContextFresh(activation)) {
            delete map[tabId];
            await setActivations(map);
            sendResponse({ activated: false });
            return;
          }
          sendResponse({ activated: !!activation });
        })
        .catch(() => sendResponse({ activated: false }));
      return true;
    }

    // --- GET_TRACKING_CONTEXT ---
    if (message.type === "GET_TRACKING_CONTEXT") {
      const tabId = sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ applicationUrl: null });
        return false;
      }
      getActivations()
        .then(async (map) => {
          const activation = map[tabId];
          if (activation && !isTrackingContextFresh(activation)) {
            delete map[tabId];
            await setActivations(map);
            sendResponse({ applicationUrl: null });
            return;
          }
          sendResponse({ applicationUrl: activation?.applicationUrl ?? null });
        })
        .catch(() => sendResponse({ applicationUrl: null }));
      return true;
    }

    // --- GET_SUPPRESSION ---
    if (message.type === "GET_SUPPRESSION") {
      const { hostname } = message;
      Promise.all([getSiteSuppressions(), getSessionSuppressions()])
        .then(([site, session]) => {
          if (site.includes(hostname)) {
            sendResponse({ suppressed: "site" });
          } else if (session.includes(hostname)) {
            sendResponse({ suppressed: "session" });
          } else {
            sendResponse({ suppressed: null });
          }
        })
        .catch(() => sendResponse({ suppressed: null }));
      return true;
    }

    // --- SET_SUPPRESSION ---
    if (message.type === "SET_SUPPRESSION") {
      const { hostname, scope } = message;
      if (scope === "site") {
        getSiteSuppressions()
          .then((list) => {
            if (!list.includes(hostname)) {
              return chrome.storage.local.set({ [SITE_SUPPRESSIONS_KEY]: [...list, hostname] });
            }
          })
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: true }));
      } else {
        getSessionSuppressions()
          .then((list) => {
            if (!list.includes(hostname)) {
              return chrome.storage.session.set({ [SESSION_SUPPRESSIONS_KEY]: [...list, hostname] });
            }
          })
          .then(() => sendResponse({ ok: true }))
          .catch(() => sendResponse({ ok: true }));
      }
      return true;
    }

    // --- CLEAR_SUPPRESSION ---
    if (message.type === "CLEAR_SUPPRESSION") {
      const { hostname } = message;
      Promise.all([
        getSiteSuppressions().then((list) =>
          chrome.storage.local.set({ [SITE_SUPPRESSIONS_KEY]: list.filter((h) => h !== hostname) }),
        ),
        getSessionSuppressions().then((list) =>
          chrome.storage.session.set({ [SESSION_SUPPRESSIONS_KEY]: list.filter((h) => h !== hostname) }),
        ),
      ])
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: true }));
      return true;
    }

    // --- GET_ALL_SUPPRESSIONS ---
    if (message.type === "GET_ALL_SUPPRESSIONS") {
      Promise.all([getSiteSuppressions(), getSessionSuppressions()])
        .then(([site, session]) => {
          const all = Array.from(new Set([...site, ...session]));
          sendResponse({ hostnames: all });
        })
        .catch(() => sendResponse({ hostnames: [] }));
      return true;
    }

    // --- ACTIVATE_CURRENT_TAB ---
    // Called by the popup "Use JOBSAGE on this page" button. Marks the active
    // tab as activated (so the sidebar persists across soft navigations) and
    // sends SHOW_SIDEBAR to the content script already injected on that tab.
    if (message.type === "ACTIVATE_CURRENT_TAB") {
      (async () => {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0];
          if (!tab?.id || !tab.url) {
            sendResponse({ error: "no active tab" });
            return;
          }
          const tabId = tab.id;
          // Mark the tab as activated so it persists through same-domain
          // navigations (e.g. redirect after form submit).
          try {
            const etld1 = getEtld1(new URL(tab.url).hostname);
            const map = await getActivations();
            map[tabId] = { etld1, activatedAt: Date.now() };
            await setActivations(map);
          } catch {
            // Storage write failure is non-fatal — sidebar will still show now.
          }
          // Signal the content script already injected on the page.
          try {
            await chrome.tabs.sendMessage(tabId, { type: "SHOW_SIDEBAR" });
          } catch {
            // Content script not yet ready (e.g. page still loading). Activation
            // is persisted above so the sidebar will mount on DOMContentLoaded.
          }
          sendResponse({ ok: true });
        } catch {
          sendResponse({ error: "unexpected error" });
        }
      })();
      return true;
    }

    // --- API_REQUEST ---
    if (message.type !== "API_REQUEST") {
      return false;
    }

    const { endpoint, method = "GET", body } = message;

    (async () => {
      try {
        const settings = await getEnvSettings();
        const token = await getSessionToken(activeOrigin(settings));

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const fetchOptions: RequestInit = { method, headers };

        if (body !== undefined && method !== "GET" && method !== "HEAD") {
          fetchOptions.body = JSON.stringify(body);
        }

        const url = `${apiBase(settings)}${endpoint}`;
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const text = await response.text();
          sendResponse({ error: `HTTP ${response.status}: ${text}` });
          return;
        }

        const data = await response.json();
        sendResponse({ data });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ error: msg });
      }
    })();

    return true;
  },
);
