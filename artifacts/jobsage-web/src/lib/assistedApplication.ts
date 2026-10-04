import type { TrackedVacancyContext } from "./trackedOutbound";

export const ASSISTED_APPLICATION_EVENT = "jobsage:assisted-application";
export interface AssistedApplicationEvent {
  applicationUrl: string;
  vacancy: TrackedVacancyContext;
  phase: "saving" | "ready" | "error";
  source?: "assisted" | "desktop-assisted" | "desktop-outbound";
  error?: string;
  application?: { id: number; status: string; appliedAt: string };
}

export function shouldUseAssistedWorkspace(): boolean {
  return window.matchMedia?.("(max-width: 767px), (pointer: coarse)").matches === true
    || !document.getElementById("jobsage-extension-root");
}

function publish(detail: AssistedApplicationEvent) {
  window.dispatchEvent(new CustomEvent(ASSISTED_APPLICATION_EVENT, { detail }));
}

/** Reserve the tab during the gesture, but never navigate until tracking commits. */
export async function beginAssistedApplication(applicationUrl: string, vacancy: TrackedVacancyContext, onTracked?: () => void): Promise<void> {
  const source = window.matchMedia?.("(min-width: 768px)").matches ? "desktop-assisted" : "assisted";
  const detail: AssistedApplicationEvent = { applicationUrl, vacancy, phase: "saving", source };
  try {
    const target = new URL(applicationUrl);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error();
  } catch {
    publish({ ...detail, phase: "error", error: "This vacancy has no valid application URL." });
    return;
  }
  // Arm the return listener BEFORE window.open can synchronously blur/hide
  // this tab. Checking hasFocus after opening can miss that transition.
  publish(detail);
  let tab: Window | null = null;
  try {
    tab = window.open("about:blank", "_blank");
    if (tab) {
      tab.opener = null;
      // Mobile browsers may show this reserved tab while the server commits.
      // Use plain text, never employer HTML or scripts in the JobSage origin.
      if (tab.document) {
        tab.document.title = "Saving your application";
        tab.document.body.textContent = "Saving this application in JobSage before opening the employer form. If the form does not open, return to JobSage to retry.";
      }
    }
  } catch {
    tab = null; // The saved drawer's direct link remains available if popups are blocked.
  }
  try {
    const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/applications`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationType: "website", status: "in_progress", applicationUrl,
        roleId: vacancy.roleId, companyName: vacancy.employer, jobTitle: vacancy.title,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save your application. Please retry.");
    publish({ ...detail, phase: "ready", application: result });
    onTracked?.();
    if (tab) tab.location.replace(applicationUrl);
  } catch (error) {
    tab?.close();
    publish({ ...detail, phase: "error", error: error instanceof Error ? error.message : "Could not save your application." });
  }
}

export async function confirmAssistedApplication(applicationUrl: string): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/applications/confirm-submission`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationUrl }),
  });
  if (!response.ok) throw new Error("Could not confirm your application. Please retry.");
}

export function isRecentInProgress(application: { status: string; appliedAt: string }): boolean {
  const elapsed = Date.now() - new Date(application.appliedAt).getTime();
  return application.status === "in_progress" && elapsed >= 0 && elapsed <= 48 * 60 * 60 * 1000;
}