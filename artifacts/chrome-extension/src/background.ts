import { getEnvSettings, activeOrigin, apiBase } from "./lib/env";
import { isConfiguredFirstPartyOrigin } from "./lib/trustedOrigin";
import { createKeyedAsyncQueue } from "./lib/keyedAsyncQueue";
import { takeMatchingRecord } from "./lib/navigationRecords";
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
const PENDING_NAVIGATION_STORAGE_PREFIX = "jobsage_pending_trusted_navigation";
const CREATED_NAVIGATION_STORAGE_PREFIX = "jobsage_created_navigation_target";
const SAME_TAB_NAVIGATION_STORAGE_PREFIX = "jobsage_same_tab_navigation_target";
const TRUSTED_NAVIGATION_WINDOW_MS = 2 * 60 * 1000;

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
type TrustedNavigation = { applicationUrl: string; createdAt: number };
type CreatedNavigationTarget = { tabId: number; url: string; createdAt: number };
type SameTabNavigationTarget = { url: string; createdAt: number };

// These short-lived collections bridge browser navigation events with verified
// first-party registration. A single JOBSAGE tab can launch several roles in
// quick succession, so each exact destination is retained independently.
const pendingTrustedNavigations = new Map<number, TrustedNavigation[]>();
const createdNavigationTargets = new Map<number, CreatedNavigationTarget[]>();
const sameTabNavigationTargets = new Map<number, SameTabNavigationTarget[]>();
const navigationQueue = createKeyedAsyncQueue<number>();

function navigationStorageKey(prefix: string, tabId: number): string {
  return `${prefix}:${tabId}`;
}

async function getFreshNavigationRecords<T extends { createdAt: number }>(
  prefix: string,
  tabId: number,
): Promise<T[]> {
  const key = navigationStorageKey(prefix, tabId);
  const stored = await chrome.storage.session.get(key);
  const value = stored[key] as T | T[] | undefined;
  const records = (Array.isArray(value) ? value : value ? [value] : []).filter(
    (record) => Date.now() - record.createdAt <= TRUSTED_NAVIGATION_WINDOW_MS,
  );
  if (records.length === 0) {
    await chrome.storage.session.remove(key);
  } else if (!Array.isArray(value) || records.length !== value.length) {
    await chrome.storage.session.set({ [key]: records });
  }
  return records;
}

async function storeNavigationRecords<T extends { createdAt: number }>(
  prefix: string,
  tabId: number,
  records: T[],
): Promise<void> {
  const key = navigationStorageKey(prefix, tabId);
  if (records.length === 0) {
    await chrome.storage.session.remove(key);
    return;
  }
  await chrome.storage.session.set({ [key]: records });
}

async function clearNavigationRecord(prefix: string, tabId: number): Promise<void> {
  await chrome.storage.session.remove(navigationStorageKey(prefix, tabId));
}

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
// A destination becomes trusted only after a content script running on the
// first-party JOBSAGE page registered the exact outbound URL. A public
// `?ref=jobsage` parameter is intentionally not sufficient.
// ---------------------------------------------------------------------------

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).toString() === new URL(b).toString();
  } catch {
    return false;
  }
}

function isFreshTrustedNavigation(
  entry: TrustedNavigation | CreatedNavigationTarget | SameTabNavigationTarget,
): boolean {
  return Date.now() - entry.createdAt <= TRUSTED_NAVIGATION_WINDOW_MS;
}

function cleanExpiredNavigationTargets(): void {
  const clean = <T extends { createdAt: number }>(records: Map<number, T[]>) => {
    for (const [tabId, entries] of records) {
      const fresh = entries.filter((entry) => Date.now() - entry.createdAt <= TRUSTED_NAVIGATION_WINDOW_MS);
      if (fresh.length > 0) records.set(tabId, fresh);
      else records.delete(tabId);
    }
  };
  clean(pendingTrustedNavigations);
  clean(createdNavigationTargets);
  clean(sameTabNavigationTargets);
}

async function recordsFor<T extends { createdAt: number }>(
  records: Map<number, T[]>,
  prefix: string,
  tabId: number,
): Promise<T[]> {
  const existing = records.get(tabId);
  if (existing) return existing;
  const restored = await getFreshNavigationRecords<T>(prefix, tabId);
  records.set(tabId, restored);
  return restored;
}

async function persistRecords<T extends { createdAt: number }>(
  records: Map<number, T[]>,
  prefix: string,
  tabId: number,
  entries: T[],
): Promise<void> {
  if (entries.length > 0) records.set(tabId, entries);
  else records.delete(tabId);
  await storeNavigationRecords(prefix, tabId, entries);
}

async function activateTrackedTab(tabId: number, applicationUrl: string): Promise<void> {
  const destination = new URL(applicationUrl);
  const map = await getActivations();
  map[tabId] = {
    etld1: getEtld1(destination.hostname),
    activatedAt: Date.now(),
    applicationUrl,
  };
  await setActivations(map);
  // The destination content script may have already completed its initial
  // activation check before this trusted click was stored. Nudge it directly;
  // if it is not injected yet, the saved context still covers its startup.
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_SIDEBAR" });
  } catch {
    // The destination is still loading or does not permit a content script.
  }
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // main frame only
  void navigationQueue.run(details.tabId, async () => {
    try {
      const url = new URL(details.url);
      if (url.searchParams.get("ref") !== "jobsage") return;
      cleanExpiredNavigationTargets();
      const pending = await recordsFor(
        pendingTrustedNavigations,
        PENDING_NAVIGATION_STORAGE_PREFIX,
        details.tabId,
      );
      const match = takeMatchingRecord(pending, (entry) => sameUrl(entry.applicationUrl, url.toString()));
      if (match) {
        await persistRecords(
          pendingTrustedNavigations,
          PENDING_NAVIGATION_STORAGE_PREFIX,
          details.tabId,
          pending,
        );
        await activateTrackedTab(details.tabId, match.applicationUrl);
        return;
      }
      // The first-party registration message is asynchronous, so navigation can
      // arrive first for same-tab links. Retain only the exact, short-lived
      // tagged destination until a trusted first-party registration confirms it.
      const target = {
        url: url.toString(),
        createdAt: Date.now(),
      };
      const targets = await recordsFor(
        sameTabNavigationTargets,
        SAME_TAB_NAVIGATION_STORAGE_PREFIX,
        details.tabId,
      );
      targets.push(target);
      await persistRecords(
        sameTabNavigationTargets,
        SAME_TAB_NAVIGATION_STORAGE_PREFIX,
        details.tabId,
        targets,
      );
    } catch {
      // invalid URL — ignore
    }
  });
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  void navigationQueue.run(details.sourceTabId, async () => {
    cleanExpiredNavigationTargets();
    const pending = await recordsFor(
      pendingTrustedNavigations,
      PENDING_NAVIGATION_STORAGE_PREFIX,
      details.sourceTabId,
    );
    const match = takeMatchingRecord(pending, (entry) => sameUrl(entry.applicationUrl, details.url));
    if (match) {
      await persistRecords(
        pendingTrustedNavigations,
        PENDING_NAVIGATION_STORAGE_PREFIX,
        details.sourceTabId,
        pending,
      );
      await activateTrackedTab(details.tabId, match.applicationUrl);
      return;
    }
    const target = {
      tabId: details.tabId,
      url: details.url,
      createdAt: Date.now(),
    };
    const targets = await recordsFor(
      createdNavigationTargets,
      CREATED_NAVIGATION_STORAGE_PREFIX,
      details.sourceTabId,
    );
    targets.push(target);
    await persistRecords(
      createdNavigationTargets,
      CREATED_NAVIGATION_STORAGE_PREFIX,
      details.sourceTabId,
      targets,
    );
  });
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const url = new URL(details.url);
    // A verified matching navigation was activated in onBeforeNavigate or
    // onCreatedNavigationTarget — don't immediately clear it.
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
  pendingTrustedNavigations.delete(tabId);
  createdNavigationTargets.delete(tabId);
  sameTabNavigationTargets.delete(tabId);
  await Promise.all([
    clearNavigationRecord(PENDING_NAVIGATION_STORAGE_PREFIX, tabId),
    clearNavigationRecord(CREATED_NAVIGATION_STORAGE_PREFIX, tabId),
    clearNavigationRecord(SAME_TAB_NAVIGATION_STORAGE_PREFIX, tabId),
  ]);
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

interface GetCurrentCvMessage {
  type: "GET_CURRENT_CV";
}

interface DownloadCurrentCvMessage {
  type: "DOWNLOAD_CURRENT_CV";
  cv: { data: string; filename: string; mimeType: string };
}

interface RegisterTrackedApplicationMessage {
  type: "REGISTER_TRACKED_APPLICATION";
  applicationUrl: string;
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
  | ActivateCurrentTabMessage
  | GetCurrentCvMessage
  | DownloadCurrentCvMessage
  | RegisterTrackedApplicationMessage;

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function filenameFromDisposition(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return match ? decodeURIComponent(match[1]!.trim()) : "jobsage-cv.pdf";
}

// ---------------------------------------------------------------------------
// Long-lived port relay for the streaming assistant endpoint
// ---------------------------------------------------------------------------

interface AssistantStreamRequest {
  message: string;
  questionId?: string;
  questionText?: string;
  jobTitle?: string;
  employer?: string;
  jobDescription?: string;
  wordLimit?: number;
  maxLength?: number;
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
          body: JSON.stringify({
            message: request.message,
            questionId: request.questionId,
            questionText: request.questionText,
            jobTitle: request.jobTitle,
            employer: request.employer,
            jobDescription: request.jobDescription,
            wordLimit: request.wordLimit,
            maxLength: request.maxLength,
          }),
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

    // --- REGISTER_TRACKED_APPLICATION ---
    // Only a content script injected in the first-party JOBSAGE app may
    // register an automatic-prefill destination. The public ref parameter
    // alone is never trusted.
    if (message.type === "REGISTER_TRACKED_APPLICATION") {
      void (async () => {
        const sourceTabId = sender.tab?.id;
        let applicationUrl: URL | null = null;
        try {
          applicationUrl = new URL(message.applicationUrl);
        } catch {
          sendResponse({ error: "invalid tracked application URL" });
          return;
        }
        const configuredOrigin = activeOrigin(await getEnvSettings());
        if (
          sourceTabId === undefined ||
          !isConfiguredFirstPartyOrigin(sender.url, configuredOrigin) ||
          applicationUrl.searchParams.get("ref") !== "jobsage"
        ) {
          sendResponse({ error: "untrusted tracked application registration" });
          return;
        }

        await navigationQueue.run(sourceTabId, async () => {
          cleanExpiredNavigationTargets();
          const sameTabTargets = await recordsFor(
            sameTabNavigationTargets,
            SAME_TAB_NAVIGATION_STORAGE_PREFIX,
            sourceTabId,
          );
          const sameTabTarget = takeMatchingRecord(
            sameTabTargets,
            (target) => sameUrl(target.url, applicationUrl.toString()),
          );
          if (sameTabTarget) {
            await persistRecords(
              sameTabNavigationTargets,
              SAME_TAB_NAVIGATION_STORAGE_PREFIX,
              sourceTabId,
              sameTabTargets,
            );
            await activateTrackedTab(sourceTabId, applicationUrl.toString());
          } else {
            const createdTargets = await recordsFor(
              createdNavigationTargets,
              CREATED_NAVIGATION_STORAGE_PREFIX,
              sourceTabId,
            );
            const createdTarget = takeMatchingRecord(
              createdTargets,
              (target) => sameUrl(target.url, applicationUrl.toString()),
            );
            if (createdTarget) {
              await persistRecords(
                createdNavigationTargets,
                CREATED_NAVIGATION_STORAGE_PREFIX,
                sourceTabId,
                createdTargets,
              );
              await activateTrackedTab(createdTarget.tabId, applicationUrl.toString());
            } else {
              const pending = await recordsFor(
                pendingTrustedNavigations,
                PENDING_NAVIGATION_STORAGE_PREFIX,
                sourceTabId,
              );
              pending.push({
                applicationUrl: applicationUrl.toString(),
                createdAt: Date.now(),
              });
              await persistRecords(
                pendingTrustedNavigations,
                PENDING_NAVIGATION_STORAGE_PREFIX,
                sourceTabId,
                pending,
              );
            }
          }
        });
        sendResponse({ ok: true });
      })().catch((error) => {
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
      return true;
    }

    // --- GET_CURRENT_CV ---
    // The binary download is proxied through the extension service worker so
    // application pages never receive a signed storage URL or session token.
    if (message.type === "GET_CURRENT_CV") {
      (async () => {
        try {
          const settings = await getEnvSettings();
          const token = await getSessionToken(activeOrigin(settings));
          if (!token) {
            sendResponse({ error: "Please sign in to JOBSAGE before using your CV." });
            return;
          }
          const response = await fetch(`${apiBase(settings)}/smart-apply/cv`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) {
            sendResponse({ error: response.status === 404 ? "No CV is available in JOBSAGE yet." : `HTTP ${response.status}` });
            return;
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          sendResponse({
            data: {
              data: bytesToBase64(bytes),
              filename: filenameFromDisposition(response.headers.get("content-disposition")),
              mimeType: response.headers.get("content-type")?.split(";")[0] || "application/pdf",
            },
          });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;
    }

    // --- DOWNLOAD_CURRENT_CV ---
    if (message.type === "DOWNLOAD_CURRENT_CV") {
      (async () => {
        try {
          const { cv } = message;
          const url = `data:${cv.mimeType || "application/pdf"};base64,${cv.data}`;
          await chrome.downloads.download({
            url,
            filename: cv.filename || "jobsage-cv.pdf",
            saveAs: true,
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
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
