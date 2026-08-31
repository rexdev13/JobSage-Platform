import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import {
  mountAutomaticConfirmationToast,
  retryTrackedApplicationConfirmation,
  watchForSubmissionConfirmation,
} from "./lib/trackerDetector";
import { createQuestionWatcher } from "./lib/questionDetector";
import { createAnswerMemoryController } from "./lib/answerMemory";
import { ensureBrandFonts } from "./lib/brand";
import type { PillPos } from "./lib/types";
import { prefillPersonalDetails, type CandidateProfile, type PrefillResult } from "./lib/prefill";
import { attachCvToForm, type CandidateCv, type CvAttachResult } from "./lib/cvAttachment";
import { scrapeJobContext, hasApplicationForm, type JobContext } from "./lib/scraper";
import { hideRawPhpRuntimeWarnings, watchRawPhpRuntimeWarnings } from "./lib/pageWarnings";

const JOBSAGE_HOST_ID = "jobsage-extension-root";
const PILL_POSITION_KEY = "jobsage_pill_position";

// Module-level: track whether the sidebar is already mounted and provide a
// handle to open it from outside React (used by the SHOW_SIDEBAR message).
let sidebarMounted = false;
let openSidebarFn: (() => void) | null = null;

/** Hostnames that are part of the JOBSAGE platform itself. */
const JOBSAGE_HOSTNAMES = new Set(["jobsage.co.uk", "www.jobsage.co.uk", "localhost"]);

function isJobSageHost(): boolean {
  const { hostname } = window.location;
  if (JOBSAGE_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".jobsage.co.uk")) return true;
  if (hostname.endsWith(".replit.dev") || hostname.endsWith(".repl.co")) return true;
  return false;
}

function hasJobSageRef(): boolean {
  return new URLSearchParams(window.location.search).get("ref") === "jobsage";
}

const OUTBOUND_APPLICATION_EVENT = "jobsage:outbound-application";

function registerFirstPartyOutboundApplication(): void {
  if (!isJobSageHost()) return;
  window.addEventListener(OUTBOUND_APPLICATION_EVENT, (event: Event) => {
    const applicationUrl = (event as CustomEvent<unknown>).detail;
    if (typeof applicationUrl !== "string") return;
    void sendMessage({ type: "REGISTER_TRACKED_APPLICATION", applicationUrl });
  });
}

function cleanEmployerPageWarnings(): void {
  if (isJobSageHost()) return;
  hideRawPhpRuntimeWarnings();
  watchRawPhpRuntimeWarnings();
}

// ---------------------------------------------------------------------------
// Background messaging helpers
// ---------------------------------------------------------------------------

function sendMessage<T>(msg: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: T) => {
      if (chrome.runtime.lastError) {
        // Service worker woke up but errored — return a safe default
        resolve({} as T);
        return;
      }
      resolve(response);
    });
  });
}

async function checkTabActivation(): Promise<boolean> {
  try {
    const resp = await sendMessage<{ activated?: boolean }>({ type: "CHECK_ACTIVATION" });
    return resp.activated === true;
  } catch {
    return false;
  }
}

async function getTrackingApplicationUrl(): Promise<string | null> {
  try {
    const resp = await sendMessage<{ applicationUrl?: string | null }>({ type: "GET_TRACKING_CONTEXT" });
    return resp.applicationUrl ?? null;
  } catch {
    return null;
  }
}

async function checkSuppression(): Promise<"site" | "session" | null> {
  try {
    const resp = await sendMessage<{ suppressed?: "site" | "session" | null }>({
      type: "GET_SUPPRESSION",
      hostname: location.hostname,
    });
    return resp.suppressed ?? null;
  } catch {
    return null;
  }
}

async function loadPillPosition(): Promise<PillPos | null> {
  try {
    const stored = await chrome.storage.local.get(PILL_POSITION_KEY);
    const p = stored[PILL_POSITION_KEY] as PillPos | undefined;
    if (p && typeof p.left === "number" && typeof p.top === "number") return p;
  } catch {
    // storage unavailable
  }
  return null;
}

// ---------------------------------------------------------------------------
// Application logging (proxied through background)
// ---------------------------------------------------------------------------

async function logApplication(companyName: string, jobTitle: string, pageUrl: string): Promise<void> {
  const originalApplicationUrl = await getTrackingApplicationUrl();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "API_REQUEST",
        endpoint: "/applications",
        method: "POST",
        // A JOBSAGE-originated application retains the original outbound URL
        // through redirect/confirmation pages. Standalone extension use falls
        // back to mapping pageUrl server-side.
        body: {
          companyName,
          jobTitle,
          applicationUrl: originalApplicationUrl ?? undefined,
          pageUrl,
          applicationType: "website",
          status: "applied",
        },
      },
      (response: { data?: unknown; error?: string }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? "Extension messaging error"));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      },
    );
  });
}

async function confirmTrackedApplication(): Promise<void> {
  const applicationUrl = await getTrackingApplicationUrl();
  if (!applicationUrl) {
    throw new Error("This application was not started from JOBSAGE.");
  }

  const requestConfirmation = () => new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "API_REQUEST",
        endpoint: "/applications/confirm-submission",
        method: "POST",
        body: { applicationUrl },
      },
      (response: { data?: unknown; error?: string }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? "Extension messaging error"));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      },
    );
  });

  // The external tab can load and submit before the first-party click write
  // has committed. The server shares the click lock when it is already in
  // flight; this short retry only covers the inverse ordering and never
  // creates a new application record on its own.
  return retryTrackedApplicationConfirmation(requestConfirmation);
}

async function prefillApplicationDetails(): Promise<PrefillResult> {
  const response = await sendMessage<{ data?: { profile?: CandidateProfile } | CandidateProfile; error?: string }>({
    type: "API_REQUEST",
    endpoint: "/smart-apply/candidate-prefill",
  });
  if (response.error || !response.data) {
    return { filled: [], missing: ["your profile details"], skipped: [] };
  }
  const payload = response.data as { profile?: CandidateProfile };
  return prefillPersonalDetails(payload.profile ?? (response.data as CandidateProfile));
}

async function attachApplicationCv(): Promise<CvAttachResult & { downloaded?: boolean }> {
  const response = await sendMessage<{ data?: CandidateCv; error?: string }>({ type: "GET_CURRENT_CV" });
  const cv = response.data;
  if (response.error || !cv) {
    return { attached: false, reason: "no-input", filename: "your JOBSAGE CV" };
  }

  const result = attachCvToForm(cv);
  if (result.attached) return result;

  const download = await sendMessage<{ ok?: boolean }>({ type: "DOWNLOAD_CURRENT_CV", cv });
  return { ...result, downloaded: download.ok === true };
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mountSidebar(
  initialPosition: PillPos | null,
  onDismiss: (scope: "site" | "session") => void,
  startOpen = false,
  tracked = false,
): ShadowRoot {
  const existing = document.getElementById(JOBSAGE_HOST_ID);
  if (existing) {
    // Already mounted — just open it.
    existing.style.display = "";
    openSidebarFn?.();
    return existing.shadowRoot!;
  }

  const host = document.createElement("div");
  host.id = JOBSAGE_HOST_ID;
  host.style.all = "initial";

  const shadowRoot = host.attachShadow({ mode: "open" });

  ensureBrandFonts();

  const style = document.createElement("style");
  style.textContent = "@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
  shadowRoot.appendChild(style);

  const container = document.createElement("div");
  shadowRoot.appendChild(container);

  document.body.appendChild(host);

  let jobContext: JobContext = {
    jobTitle: "",
    companyName: "",
    jobDescription: "",
    pageUrl: location.href,
  };
  try {
    jobContext = scrapeJobContext();
  } catch (error) {
    console.warn("[JOBSAGE] Could not scrape job context; opening the helper without page details.", error);
  }

  let questionWatcher: ReturnType<typeof createQuestionWatcher> | undefined;
  let answerMemory: ReturnType<typeof createAnswerMemoryController> | undefined;
  try {
    questionWatcher = createQuestionWatcher();
    answerMemory = createAnswerMemoryController(questionWatcher);
  } catch (error) {
    console.warn("[JOBSAGE] Could not start question detection; opening the helper without detected questions.", error);
  }

  let formDetected = false;
  try {
    formDetected = hasApplicationForm();
  } catch (error) {
    console.warn("[JOBSAGE] Could not inspect the page form; opening the helper in compact mode.", error);
  }

  container.dataset.jobsageRenderState = "starting";
  createRoot(container, {
    onUncaughtError(error) {
      console.error("[JOBSAGE] Sidebar render failed.", error);
      container.dataset.jobsageRenderState = "failed";
      container.dataset.jobsageRenderError = error instanceof Error ? error.message : String(error);
      container.textContent = "JOBSAGE helper could not load. Refresh this page and try again.";
    },
  }).render(
    <Sidebar
      jobContext={jobContext}
      minimal={!isJobSageHost() && !formDetected && !tracked}
      questionWatcher={questionWatcher}
      onLogApplication={logApplication}
      initialPosition={initialPosition}
      onDismiss={onDismiss}
      startOpen={startOpen}
      tracked={tracked}
      onPrefill={prefillApplicationDetails}
      onAttachCv={attachApplicationCv}
      onClearAnswerMemory={() => answerMemory?.clearPage() ?? Promise.resolve(0)}
      onOpen={(fn) => { openSidebarFn = fn; }}
    />,
  );
  container.dataset.jobsageRenderState = "scheduled";

  sidebarMounted = true;
  return shadowRoot;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

// Shared dismiss handler — used by both init() and the SHOW_SIDEBAR path.
function makeDismissHandler(tracked = false): (scope: "site" | "session") => void {
  return (scope) => {
    if (tracked) return;
    void sendMessage({ type: "SET_SUPPRESSION", hostname: location.hostname, scope });
    const host = document.getElementById(JOBSAGE_HOST_ID);
    if (host) host.style.display = "none";
  };
}

async function init(): Promise<void> {
  const firstParty = isJobSageHost();
  // The main JOBSAGE site must not wait for background-worker messaging before
  // the assistant is visible. A cold or temporarily stalled service worker
  // should never make candidates reach for the extension toolbar.
  const firstPartyShadowRoot = firstParty
    ? mountSidebar(null, makeDismissHandler(false), /* startOpen */ true, false)
    : null;

  const [activated, trackingUrl, suppression, pillPosition] = await Promise.all([
    checkTabActivation(),
    getTrackingApplicationUrl(),
    checkSuppression(),
    loadPillPosition(),
  ]);
  const tracked = !!trackingUrl;

  // Only activate if this is the first-party host or the tab was previously
  // marked by the background worker (survives redirect stripping). A public
  // ref query parameter by itself is deliberately not trusted.
  if (!firstParty && !tracked && !activated) return;

  // A tracked application must always retain a minimizable helper so a
  // previous site-wide launcher dismissal cannot break an in-progress apply.
  if (!firstParty && !tracked && (suppression === "site" || suppression === "session")) return;

  if (firstParty) {
    // The visible assistant is already mounted above. Only wire submission
    // confirmation when this first-party page also carries a trusted context.
    if (tracked && firstPartyShadowRoot) {
      watchForSubmissionConfirmation(() => {
        mountAutomaticConfirmationToast(firstPartyShadowRoot, {
          onConfirm: confirmTrackedApplication,
        });
      });
    }
    return;
  }

  const shadowRoot = mountSidebar(
    pillPosition,
    makeDismissHandler(tracked),
    /* startOpen */ isJobSageHost() || tracked,
    tracked,
  );

  if (tracked) {
    watchForSubmissionConfirmation(() => {
      mountAutomaticConfirmationToast(shadowRoot, {
        onConfirm: confirmTrackedApplication,
      });
    });
  }
}

// Listen for explicit activation from the popup "Use JOBSAGE on this page"
// button. This fires even when init() returned early (unrecognised host),
// letting the user opt-in on any job application page without a page reload.
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (typeof msg !== "object" || !msg || (msg as Record<string, unknown>)["type"] !== "SHOW_SIDEBAR") {
    return false;
  }
  (async () => {
    const [suppression, trackingUrl] = await Promise.all([checkSuppression(), getTrackingApplicationUrl()]);
    const tracked = !!trackingUrl;
    if (!isJobSageHost() && !tracked && (suppression === "site" || suppression === "session")) {
      sendResponse({ ok: false, reason: "suppressed" });
      return;
    }
    const pillPosition = await loadPillPosition();
    mountSidebar(pillPosition, makeDismissHandler(tracked), /* startOpen */ true, tracked);
    sendResponse({ ok: true });
  })();
  return true; // keep channel open for async sendResponse
});

registerFirstPartyOutboundApplication();
cleanEmployerPageWarnings();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
