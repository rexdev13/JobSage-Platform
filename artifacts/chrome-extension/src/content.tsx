import { createRoot } from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { scrapeJobContext } from "./lib/scraper";
import { isConfirmationPage, mountConfirmationToast } from "./lib/trackerDetector";

const JOBSAGE_HOST_ID = "jobsage-extension-root";
const API_BASE = "https://jobsage.co.uk/api";

async function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response: { token: string | null }) => {
      resolve(response?.token ?? null);
    });
  });
}

async function logApplication(companyName: string, jobTitle: string, pageUrl: string): Promise<void> {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/applications`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      applicationType: "website",
      companyName,
      notes: jobTitle ? `Applied for: ${jobTitle}` : undefined,
      applicationUrl: pageUrl,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
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
