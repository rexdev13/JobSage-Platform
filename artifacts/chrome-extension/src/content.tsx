import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import {
  mountAutomaticConfirmationToast,
  retryTrackedApplicationConfirmation,
  watchForSubmissionConfirmation,
} from "./lib/trackerDetector";
import {
  createQuestionWatcher,
  fillStructuredField,
  getStructuredFieldDescriptors,
  type DetectedQuestion,
} from "./lib/questionDetector";
import { createAnswerMemoryController } from "./lib/answerMemory";
import { ensureBrandFonts } from "./lib/brand";
import type { PillPos } from "./lib/types";
import {
  isConfidentAuthenticatedAccountPage,
  prefillPersonalDetails,
  type CandidateProfile,
  type PrefillResult,
} from "./lib/prefill";
import { attachCvToForm, type CandidateCv, type CvAttachResult } from "./lib/cvAttachment";
import { scrapeJobContext, hasApplicationForm, type JobContext } from "./lib/scraper";
import { hideRawPhpRuntimeWarnings, watchRawPhpRuntimeWarnings } from "./lib/pageWarnings";
import { isJobSageFirstPartyPage } from "./lib/trustedOrigin";

const JOBSAGE_HOST_ID = "jobsage-extension-root";
const PILL_POSITION_KEY = "jobsage_pill_position";

// Module-level: track whether the sidebar is already mounted and provide a
// handle to open it from outside React (used by the SHOW_SIDEBAR message).
let sidebarMounted = false;
let openSidebarFn: (() => void) | null = null;

function isJobSageHost(): boolean {
  return isJobSageFirstPartyPage(window.location.href);
}

function hasJobSageRef(): boolean {
  return new URLSearchParams(window.location.search).get("ref") === "jobsage";
}

const OUTBOUND_APPLICATION_EVENT = "jobsage:outbound-application";

interface TrackedApplicationContext {
  applicationUrl: string;
  canonicalUrl?: string;
  jobTitle?: string;
  employer?: string;
  roleId?: number;
}

function registerFirstPartyOutboundApplication(): void {
  if (!isJobSageHost()) return;
  window.addEventListener(OUTBOUND_APPLICATION_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    const context: TrackedApplicationContext | null =
      typeof detail === "string"
        ? { applicationUrl: detail }
        : detail && typeof detail === "object" && typeof (detail as Record<string, unknown>)["applicationUrl"] === "string"
          ? detail as TrackedApplicationContext
          : null;
    if (!context) return;
    void sendMessage({ type: "REGISTER_TRACKED_APPLICATION", ...context });
  });
}

function markExtensionInstalled(): void {
  if (document.getElementById(JOBSAGE_HOST_ID)) return;
  const marker = document.createElement("span");
  marker.id = JOBSAGE_HOST_ID;
  marker.hidden = true;
  marker.dataset.jobsageExtensionMarker = "installed";
  document.documentElement.appendChild(marker);
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
    try {
      chrome.runtime.sendMessage(msg, (response: T) => {
        try {
          if (chrome.runtime.lastError) {
            // Service worker woke up but errored — return a safe default
            resolve({} as T);
            return;
          }
          resolve(response);
        } catch {
          // The extension can be reloaded while an old content script remains
          // in a tab. Treat that invalidated context like a disconnected worker.
          resolve({} as T);
        }
      });
    } catch {
      // sendMessage itself throws synchronously for an invalidated extension
      // context, so this must be caught outside the callback.
      resolve({} as T);
    }
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

async function getTrackingContext(): Promise<TrackedApplicationContext | null> {
  try {
    const resp = await sendMessage<Partial<TrackedApplicationContext>>({ type: "GET_TRACKING_CONTEXT" });
    return resp.applicationUrl ? resp as TrackedApplicationContext : null;
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
  const trackingContext = await getTrackingContext();
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
          applicationUrl: trackingContext?.applicationUrl,
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
  const applicationUrl = (await getTrackingContext())?.applicationUrl;
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

async function prefillApplicationDetails(questions: DetectedQuestion[] = []): Promise<PrefillResult> {
  const response = await sendMessage<{ data?: { profile?: CandidateProfile } | CandidateProfile; error?: string }>({
    type: "API_REQUEST",
    endpoint: "/smart-apply/candidate-prefill",
  });
  if (response.error || !response.data) {
    return {
      filled: [],
      missing: ["your profile details"],
      skipped: [],
      fieldResults: {},
      warning: "Could not load your JOBSAGE profile. Check your connection and try again.",
    };
  }
  const payload = response.data as { profile?: CandidateProfile };
  const trackingContext = await getTrackingContext();
  const preserveExistingEmail =
    !hasApplicationForm()
    && isConfidentAuthenticatedAccountPage(document, window.location.href);
  const result = prefillPersonalDetails(
    payload.profile ?? (response.data as CandidateProfile),
    document,
    { jobTitle: trackingContext?.jobTitle, preserveExistingEmail },
  );
  const fields = getStructuredFieldDescriptors(questions);
  if (fields.length === 0) return result;
  const mapped = await sendMessage<{
    data?: { values?: Array<{ id: string; value: string | null }> };
    error?: string;
  }>({
    type: "API_REQUEST",
    endpoint: "/smart-apply/structured-prefill",
    method: "POST",
    body: {
      fields,
      jobTitle: trackingContext?.jobTitle,
      employer: trackingContext?.employer,
      roleId: trackingContext?.roleId,
    },
  });
  const values = new Map((mapped.data?.values ?? []).map((entry) => [entry.id, entry.value]));
  if (mapped.error) {
    result.warning = "JOBSAGE could not map your saved profile and CV details right now. Nothing was changed; please try again.";
  }
  for (const field of fields) {
    const value = values.get(field.id);
    if (value && fillStructuredField(field.id, value)) {
      result.filled.push(field.label);
      result.fieldResults[field.id] = { status: "filled", message: "Filled from your JOBSAGE profile or CV" };
    } else {
      result.missing.push(field.label);
      result.fieldResults[field.id] = {
        status: "missing",
        message: mapped.error ? "Not filled because mapping is temporarily unavailable" : "Not found in your JOBSAGE profile or CV",
      };
    }
  }
  result.filled = Array.from(new Set(result.filled));
  result.missing = Array.from(new Set(result.missing));
  return result;
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
  trustedContext: TrackedApplicationContext | null = null,
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
    if (trustedContext?.jobTitle) jobContext.jobTitle = trustedContext.jobTitle;
    if (trustedContext?.employer) jobContext.companyName = trustedContext.employer;
    if (trustedContext?.roleId) jobContext.roleId = trustedContext.roleId;
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
  // First-party JOBSAGE pages own their UI. Only the lightweight outbound
  // application event bridge and installation marker remain active there.
  if (firstParty) {
    markExtensionInstalled();
    return;
  }

  const [activated, trackingContext, suppression, pillPosition] = await Promise.all([
    checkTabActivation(),
    getTrackingContext(),
    checkSuppression(),
    loadPillPosition(),
  ]);
  const tracked = !!trackingContext?.applicationUrl;

  // Only activate if this is the first-party host or the tab was previously
  // marked by the background worker (survives redirect stripping). A public
  // ref query parameter by itself is deliberately not trusted.
  if (!firstParty && !tracked && !activated) return;

  // A tracked application must always retain a minimizable helper so a
  // previous site-wide launcher dismissal cannot break an in-progress apply.
  if (!firstParty && !tracked && (suppression === "site" || suppression === "session")) return;

  const shadowRoot = mountSidebar(
    pillPosition,
    makeDismissHandler(tracked),
    /* startOpen */ isJobSageHost() || tracked,
    tracked,
    trackingContext,
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
    if (isJobSageHost()) {
      sendResponse({ ok: false, reason: "first-party" });
      return;
    }
    const [suppression, trackingContext] = await Promise.all([checkSuppression(), getTrackingContext()]);
    const tracked = !!trackingContext?.applicationUrl;
    if (!isJobSageHost() && !tracked && (suppression === "site" || suppression === "session")) {
      sendResponse({ ok: false, reason: "suppressed" });
      return;
    }
    const pillPosition = await loadPillPosition();
    mountSidebar(pillPosition, makeDismissHandler(tracked), /* startOpen */ true, tracked, trackingContext);
    sendResponse({ ok: true });
  })();
  return true; // keep channel open for async sendResponse
});

registerFirstPartyOutboundApplication();
if (!isJobSageHost()) cleanEmployerPageWarnings();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
