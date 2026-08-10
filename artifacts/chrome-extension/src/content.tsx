import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { scrapeJobContext, isRecognizedJobBoard } from "./lib/scraper";
import { isConfirmationPage, mountConfirmationToast } from "./lib/trackerDetector";
import { createQuestionWatcher } from "./lib/questionDetector";
import { ensureBrandFonts } from "./lib/brand";
import type { PillPos } from "./lib/types";

const JOBSAGE_HOST_ID = "jobsage-extension-root";
const PILL_POSITION_KEY = "jobsage_pill_position";

/** Hostnames that are part of the JOBSAGE platform itself. */
const JOBSAGE_HOSTNAMES = new Set(["jobsage.co.uk", "www.jobsage.co.uk", "localhost"]);

function isJobSageHost(): boolean {
  const { hostname } = window.location;
  if (JOBSAGE_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".replit.dev") || hostname.endsWith(".repl.co")) return true;
  return false;
}

function hasJobSageRef(): boolean {
  return new URLSearchParams(window.location.search).get("ref") === "jobsage";
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
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "API_REQUEST",
        endpoint: "/applications",
        method: "POST",
        body: { companyName, jobTitle, pageUrl, applicationType: "website" },
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

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mountSidebar(initialPosition: PillPos | null, onDismiss: (scope: "site" | "session") => void): ShadowRoot {
  const existing = document.getElementById(JOBSAGE_HOST_ID);
  if (existing) return existing.shadowRoot!;

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

  const jobContext = scrapeJobContext();
  const questionWatcher = createQuestionWatcher();

  createRoot(container).render(
    <Sidebar
      jobContext={jobContext}
      minimal={!isRecognizedJobBoard()}
      questionWatcher={questionWatcher}
      onLogApplication={logApplication}
      initialPosition={initialPosition}
      onDismiss={onDismiss}
    />,
  );

  return shadowRoot;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const [activated, suppression, pillPosition] = await Promise.all([
    checkTabActivation(),
    checkSuppression(),
    loadPillPosition(),
  ]);

  // Only activate if: JOBSAGE host, or URL carries ?ref=jobsage, or tab was
  // previously marked by the background worker (survives redirect stripping).
  if (!isJobSageHost() && !hasJobSageRef() && !activated) return;

  // Respect the candidate's suppression choice.
  if (suppression === "site" || suppression === "session") return;

  const onDismiss = (scope: "site" | "session") => {
    // Notify background to persist the suppression choice.
    void sendMessage({ type: "SET_SUPPRESSION", hostname: location.hostname, scope });
    // Remove the host element from the page — no React unmount needed.
    const host = document.getElementById(JOBSAGE_HOST_ID);
    if (host) host.style.display = "none";
  };

  const shadowRoot = mountSidebar(pillPosition, onDismiss);

  if (isConfirmationPage()) {
    const jobContext = scrapeJobContext();
    mountConfirmationToast(shadowRoot, {
      onLog: () => logApplication(jobContext.companyName, jobContext.jobTitle, jobContext.pageUrl),
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
