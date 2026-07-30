import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { scrapeJobContext, isRecognizedJobBoard } from "./lib/scraper";
import { isConfirmationPage, mountConfirmationToast } from "./lib/trackerDetector";
import { createQuestionWatcher } from "./lib/questionDetector";
import { ensureBrandFonts } from "./lib/brand";

const JOBSAGE_HOST_ID = "jobsage-extension-root";

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

  // @font-face is document-scoped, so load the brand fonts into the host
  // document; text inside the shadow root can then use them. Falls back to
  // system fonts if the host page's CSP blocks the stylesheet.
  ensureBrandFonts();

  // Keyframes used by the sidebar's spinner live inside the shadow root so
  // they neither leak out nor depend on host-page styles.
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
