import { EXTENSION_AI_CONSENT_VERSION } from "@workspace/smart-apply-core/privacy";

export { EXTENSION_AI_CONSENT_VERSION };

export async function requestAiConsent(): Promise<boolean> {
  let current: { accepted?: boolean };
  try { current = await chrome.runtime.sendMessage({ type: "GET_AI_CONSENT" }); }
  catch { return false; }
  if (current?.accepted === true) return true;
  // One decision per mounted page, with no AI request before an affirmative action.
  return new Promise((resolve) => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const panel = document.createElement("dialog");
    panel.setAttribute("aria-label", "Choose whether to use AI assistance");
    panel.style.cssText = "max-width:490px;padding:24px;border:1px solid #d8c9c9;border-radius:12px;font:15px/1.5 system-ui;color:#1c1917";
    const heading = document.createElement("h2");
    heading.textContent = "Allow AI application assistance?";
    const text = document.createElement("p");
    text.textContent = "JOBSAGE will send your application question, field labels/options, job context and selected professional profile facts to OpenAI through Replit AI Integrations to map fields and draft answers. Your raw CV and private profile notes are not sent by this extension AI flow. Do not include health, financial, identity-document or other sensitive details in AI questions. You can refuse and still use basic profile fill, CV attachment and tracking.";
    const note = document.createElement("p");
    note.textContent = "Allowing applies to this tab for this browser session. Use “Turn off AI assistance” in the helper to withdraw. Filling fields or attaching a CV makes that information available to the employer site, which may autosave before submission.";
    const link = document.createElement("a");
    link.href = "https://jobsage.co.uk/extension-privacy";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Read the privacy policy";
    const finish = async (accepted: boolean) => {
      let saved = false;
      try {
        const result = await chrome.runtime.sendMessage({ type: "SET_AI_CONSENT", accepted });
        saved = accepted && result?.accepted === true;
      } catch {
        saved = false;
      } finally {
        panel.close();
        host.remove();
        resolve(saved);
      }
    };
    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:12px;margin-top:20px";
    for (const [label, accepted] of [["Not now", false], ["Allow AI assistance", true]] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.cssText = "padding:10px 14px;border-radius:8px;border:1px solid #952323;cursor:pointer;background:" + (accepted ? "#952323;color:white" : "white;color:#952323");
      button.onclick = () => { for (const child of buttons.children) (child as HTMLButtonElement).disabled = true; void finish(accepted); };
      buttons.append(button);
    }
    panel.addEventListener("cancel", (event) => { event.preventDefault(); void finish(false); });
    panel.append(heading, text, note, link, buttons);
    root.append(panel);
    document.documentElement.append(host);
    panel.showModal();
  });
}
