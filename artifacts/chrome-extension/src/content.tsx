import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { scrapeJobContext, isRecognizedJobBoard } from "./lib/scraper";
import { isConfirmationPage, mountConfirmationToast } from "./lib/trackerDetector";

const JOBSAGE_HOST_ID = "jobsage-extension-root";

async function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response: { token: string | null }) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response?.token ?? null);
    });
  });
}

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
      }
    );
  });
}

function mountSidebar(): ShadowRoot {
  const existing = document.getElementById(JOBSAGE_HOST_ID);
  if (existing) return existing.shadowRoot!;

  const host = document.createElement("div");
  host.id = JOBSAGE_HOST_ID;
  host.style.all = "initial";

  const shadowRoot = host.attachShadow({ mode: "open" });

  const container = document.createElement("div");
  shadowRoot.appendChild(container);

  document.body.appendChild(host);

  const jobContext = scrapeJobContext();

  createRoot(container).render(
    <Sidebar
      jobContext={jobContext}
      minimal={!isRecognizedJobBoard()}
      onGetToken={getToken}
      onLogApplication={logApplication}
    />
  );

  return shadowRoot;
}

function init(): void {
  const shadowRoot = mountSidebar();

  if (isConfirmationPage()) {
    const jobContext = scrapeJobContext();
    mountConfirmationToast(shadowRoot, {
      onLog: () => logApplication(jobContext.companyName, jobContext.jobTitle, jobContext.pageUrl),
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
