import { BRAND } from "./brand";

const CONFIRMATION_URL_PATTERNS = [
  /\/confirmation/i,
  /\/application[-_]submitted/i,
  /\/apply[-_]success/i,
  /\/apply\/success/i,
  /\/submitted/i,
  /\/thank[-_]you/i,
  /\/thankyou/i,
];

const CONFIRMATION_HEADING_PATTERNS = [
  /application\s+submitted/i,
  /application\s+received/i,
  /application\s+sent/i,
  /application\s+complete/i,
  /successfully\s+applied/i,
  /thank\s+you\s+for\s+(your\s+)?apply/i,
  /thank\s+you\s+for\s+(your\s+)?application/i,
];

export function isConfirmationPage(): boolean {
  const url = location.href;
  if (CONFIRMATION_URL_PATTERNS.some((p) => p.test(url))) return true;

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
  return headings.some((h) =>
    CONFIRMATION_HEADING_PATTERNS.some((p) => p.test(h.textContent ?? ""))
  );
}

export interface ToastCallbacks {
  onLog: () => Promise<void>;
}

export function mountConfirmationToast(
  shadowRoot: ShadowRoot,
  callbacks: ToastCallbacks
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
    gap: "10px",
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

  const header = document.createElement("div");
  Object.assign(header.style, { display: "flex", alignItems: "flex-start", gap: "8px" });

  const icon = document.createElement("span");
  icon.textContent = "📋";
  icon.style.fontSize = "18px";
  icon.style.flexShrink = "0";

  const textBlock = document.createElement("div");
  textBlock.style.flex = "1";

  const title = document.createElement("div");
  Object.assign(title.style, { fontSize: "13px", fontWeight: "600", color: BRAND.text, lineHeight: "1.4" });
  title.textContent = "Application detected";

  const body = document.createElement("div");
  Object.assign(body.style, { fontSize: "12px", color: BRAND.textMuted, marginTop: "2px", lineHeight: "1.4" });
  body.textContent = "Log this application to JOBSAGE Tracker?";

  textBlock.appendChild(title);
  textBlock.appendChild(body);
  header.appendChild(icon);
  header.appendChild(textBlock);

  const closeBtn = document.createElement("button");
  Object.assign(closeBtn.style, {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: BRAND.textMuted,
    padding: "0",
    flexShrink: "0",
    fontSize: "16px",
    lineHeight: "1",
  });
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.addEventListener("click", () => toast.remove());
  header.appendChild(closeBtn);

  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "flex", gap: "8px" });

  const logBtn = document.createElement("button");
  Object.assign(logBtn.style, {
    flex: "1",
    padding: "7px 12px",
    background: BRAND.primary,
    color: "#ffffff",
    border: "none",
    borderRadius: `${BRAND.radiusSm}px`,
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
  });
  logBtn.textContent = "Yes, Log It";
  logBtn.addEventListener("click", async () => {
    logBtn.textContent = "Logging…";
    logBtn.style.opacity = "0.7";
    logBtn.style.cursor = "not-allowed";
    try {
      await callbacks.onLog();
      title.textContent = "✓ Logged to JOBSAGE!";
      body.textContent = "You can view it in your applications tracker.";
      actions.remove();
      setTimeout(() => toast.remove(), 3000);
    } catch {
      body.textContent = "Could not log. Are you logged in to JOBSAGE?";
      logBtn.textContent = "Retry";
      logBtn.style.opacity = "1";
      logBtn.style.cursor = "pointer";
    }
  });

  const dismissBtn = document.createElement("button");
  Object.assign(dismissBtn.style, {
    padding: "7px 12px",
    background: BRAND.inputBg,
    color: BRAND.text,
    border: `1px solid ${BRAND.border}`,
    borderRadius: `${BRAND.radiusSm}px`,
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
  });
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => toast.remove());

  actions.appendChild(logBtn);
  actions.appendChild(dismissBtn);

  toast.appendChild(header);
  toast.appendChild(actions);
  shadowRoot.appendChild(toast);
}
