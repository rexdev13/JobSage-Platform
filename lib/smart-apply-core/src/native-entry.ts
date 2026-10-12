import { scrapeJobContext, hasApplicationForm } from "./scraper";
import {
  detectQuestions, getStructuredFieldDescriptors, isQuestionAnswered,
  setQuestionFieldValue, getQuestionField, fillStructuredField,
} from "./questionDetector";
import { prefillPersonalDetails, type CandidateProfile } from "./prefill";
import { detectSubmissionSignal } from "./trackerDetector";
import { hasUnchangedExtensionValue } from "./fieldWriteProvenance";

interface NativePageConfig { channel: string; applicationId: number; }
type Command =
  | { type: "scan" }
  | { type: "prefill"; profile: CandidateProfile; jobTitle?: string }
  | { type: "insert"; questionId: string; value: string }
  | { type: "structured"; values: Array<{ id: string; value: string }> }
  | { type: "clear"; questionId: string }
  | { type: "clear-page" }
  | { type: "attach-cv"; base64: string; filename: string };
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __JOBSAGE_SMART_APPLY__?: {
      configure(config: NativePageConfig): void;
      command(command: Command): void;
      stop(): void;
    };
  }
}

// This bundle runs only in the employer WebView, never in the Expo JS runtime.
// It contains no API client, credentials, Chrome runtime or storage access.
window.__JOBSAGE_SMART_APPLY__?.stop();
let config: NativePageConfig | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;
let submitted = false;
function scheduleScan() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(scan, 450);
}
function send(type: string, payload: Record<string, unknown>) {
  if (!config || window.top !== window) return;
  window.ReactNativeWebView?.postMessage(JSON.stringify({
    type, ...payload, ...config, version: 1, url: location.href, timestamp: Date.now(),
  }));
}
function scan() {
  const questions = detectQuestions().slice(0, 40);
  const context = scrapeJobContext();
  send("scan", {
    context: { ...context, jobDescription: context.jobDescription.slice(0, 12000) },
    applicationPage: hasApplicationForm(),
    questions: questions.map(question => ({
      ...question, question: question.question.slice(0, 3000),
      answered: isQuestionAnswered(question.id),
    })),
    structuredFields: getStructuredFieldDescriptors(questions).slice(0, 40),
  });
  const signal = detectSubmissionSignal();
  if (signal && !submitted) {
    submitted = true;
    // Evidence is advisory. Native checks active tracked context and asks the
    // candidate to confirm before updating; it never presses final Submit.
    send("submission", { signal });
  }
}
function clearWritten(id: string) {
  const field = getQuestionField(id);
  if (field && hasUnchangedExtensionValue(field)) setQuestionFieldValue(id, "");
}

window.__JOBSAGE_SMART_APPLY__ = {
  configure(value) {
    if (!value || value.channel.length < 20 || !Number.isSafeInteger(value.applicationId)) return;
    config = value;
    scan();
    observer = new MutationObserver(scheduleScan);
    document.addEventListener("input", scheduleScan, true);
    document.addEventListener("change", scheduleScan, true);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  },
  command(command) {
    if (!config || !command) return;
    if (JSON.stringify(command).length > (command.type === "attach-cv" ? 14_000_000 : 100_000)) {
      send("error", { message: "This action is too large. Use the employer's manual file picker." }); return;
    }
    try {
      if (command.type === "scan") scan();
      else if (command.type === "prefill") {
        const result = prefillPersonalDetails(command.profile, document, { jobTitle: command.jobTitle });
        send("prefill", { result });
        scan();
      } else if (command.type === "structured") {
        const permitted = new Set(detectQuestions().filter(question => !question.restricted
          && question.bucket === "structured").map(question => question.id));
        let filled = 0;
        for (const entry of command.values.slice(0, 40)) {
          if (permitted.has(entry.id) && entry.value.length <= 8000 && fillStructuredField(entry.id, entry.value)) filled++;
        }
        send("structured", { filled }); scan();
      } else if (command.type === "insert") {
        const question = detectQuestions().find(item => item.id === command.questionId);
        if (!question || question.restricted || question.bucket !== "generate") throw new Error("This field must be completed manually.");
        if (command.value.length > Math.min(question.maxLength ?? 20000, 20000)
          || (question.wordLimit && command.value.trim().split(/\s+/).length > question.wordLimit)) throw new Error("This answer exceeds the field limit.");
        if (!setQuestionFieldValue(question.id, command.value)) throw new Error("The field changed. Scan the page again.");
        send("inserted", { questionId: question.id }); scan();
      } else if (command.type === "clear") {
        clearWritten(command.questionId); send("cleared", {}); scan();
      } else if (command.type === "clear-page") {
        for (const question of detectQuestions()) clearWritten(question.id);
        send("cleared", {}); scan();
      } else if (command.type === "attach-cv") {
        if (command.base64.length > 14_000_000) throw new Error("Use native file selection for this CV.");
        const candidates = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='file']"))
          .filter(input => !input.disabled && /(?:\bcv\b|curriculum|resume|résumé)/i.test(
            [input.name, input.id, input.getAttribute("aria-label"),
              ...Array.from(input.labels ?? []).map(label => label.textContent)].join(" "))
            && (!input.accept || /pdf|application\/\*/i.test(input.accept)));
        if (candidates.length !== 1 || typeof DataTransfer === "undefined") {
          throw new Error("Automatic attachment is unavailable. Save My CV and choose it using the employer's file picker.");
        }
        const raw = atob(command.base64);
        const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
        const file = new File([bytes], command.filename.replace(/[\/\\]/g, ""), { type: "application/pdf" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        candidates[0].files = transfer.files;
        candidates[0].dispatchEvent(new Event("input", { bubbles: true }));
        candidates[0].dispatchEvent(new Event("change", { bubbles: true }));
        send("cv-attached", { filename: file.name });
      }
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : "Could not update this field." });
    }
  },
  stop() {
    observer?.disconnect();
    document.removeEventListener("input", scheduleScan, true);
    document.removeEventListener("change", scheduleScan, true);
    if (timer) clearTimeout(timer);
  },
};
