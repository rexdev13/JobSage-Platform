import { BRAND } from "./brand";
export {
  detectSubmissionSignal,
  retryTrackedApplicationConfirmation,
  watchForSubmissionConfirmation,
  type SubmissionSignal,
  type SubmissionSignalSource,
} from "@workspace/smart-apply-core/trackerDetector";

export interface AutomaticConfirmationToastCallbacks {
  onConfirm: () => Promise<void>;
}

/**
 * Shows the candidate what happened without requiring a manual "Yes, log it"
 * interaction. The tracker is updated only after the API confirms the
 * matching JOBSAGE-originated click record exists.
 */
export function mountAutomaticConfirmationToast(
  shadowRoot: ShadowRoot,
  callbacks: AutomaticConfirmationToastCallbacks,
): void {
  const existing = shadowRoot.getElementById("jobsage-toast");
  if (existing) return;

  const toast = document.createElement("div");
  toast.id = "jobsage-toast";
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "90px",
    right: "24px",
    zIndex: "2147483647",
    background: BRAND.surface,
    border: `1px solid ${BRAND.border}`,
    borderRadius: `${BRAND.radius}px`,
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
    padding: "14px 16px",
    width: "300px",
    fontFamily: BRAND.fontSans,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    animation: "slideUp 0.25s ease",
  });

  const style = document.createElement("style");
  style.textContent = `
    @keyframes slideUp {
      from { transform: translateY(16px); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }
  `;
  shadowRoot.appendChild(style);

  const title = document.createElement("div");
  Object.assign(title.style, { fontSize: "13px", fontWeight: "600", color: BRAND.text, lineHeight: "1.4" });
  title.textContent = "Application submission detected";

  const body = document.createElement("div");
  Object.assign(body.style, { fontSize: "12px", color: BRAND.textMuted, lineHeight: "1.4" });
  body.textContent = "Saving it to your JOBSAGE tracker…";

  toast.append(title, body);
  shadowRoot.appendChild(toast);

  void callbacks.onConfirm().then(
    () => {
      title.textContent = "✓ Application saved to JOBSAGE";
      body.textContent = "Your tracker has been updated automatically.";
      setTimeout(() => toast.remove(), 3500);
    },
    () => {
      title.textContent = "We couldn't confirm this application";
      body.textContent = "Use “Log this application to JOBSAGE” in the sidebar after reviewing the form.";
    },
  );
}
