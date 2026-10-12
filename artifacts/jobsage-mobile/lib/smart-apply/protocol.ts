import { safeEmployerUrl } from "@workspace/mobile-core";
import type { CandidateProfile, DetectedQuestion, PrefillResult, StructuredFieldDescriptor } from "@workspace/smart-apply-core";
import * as Crypto from "expo-crypto";

export const MAX_RAW_MESSAGE = 200_000;
export const MAX_ANSWER_CHARS = 20_000;

export interface ScanQuestion extends DetectedQuestion {
  answered: boolean;
}

export interface ScanSnapshot {
  context: { jobTitle: string; companyName: string; jobDescription: string; pageUrl: string };
  applicationPage: boolean;
  questions: ScanQuestion[];
  structuredFields: StructuredFieldDescriptor[];
}

export type PageMessage =
  | ({ type: "scan" } & ScanSnapshot)
  | { type: "prefill"; result: PrefillResult }
  | { type: "structured"; filled: number }
  | { type: "inserted"; questionId: string }
  | { type: "cleared" }
  | { type: "cv-attached"; filename: string }
  | { type: "submission"; signal: { source: string } }
  | { type: "error"; message: string };

export type PageCommand =
  | { type: "scan" }
  | { type: "prefill"; profile: CandidateProfile; jobTitle?: string }
  | { type: "insert"; questionId: string; value: string }
  | { type: "structured"; values: Array<{ id: string; value: string }> }
  | { type: "clear"; questionId: string }
  | { type: "clear-page" }
  | { type: "attach-cv"; base64: string; filename: string };

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Fresh nonce per opened application context. */
export function createSmartApplyChannel(): string {
  return toHex(Crypto.getRandomBytes(24));
}

export function configureScript(channel: string, applicationId: number): string {
  const cfg = JSON.stringify({ channel, applicationId });
  return `(function(){try{if(window.top===window&&window.__JOBSAGE_SMART_APPLY__)window.__JOBSAGE_SMART_APPLY__.configure(${cfg});}catch(e){}})();true;`;
}

export function commandScript(command: PageCommand): string {
  // Double JSON encoding: the command is parsed in-page from a string literal,
  // so no candidate text is ever evaluated as code.
  const payload = JSON.stringify(JSON.stringify(command));
  return `(function(){try{if(window.__JOBSAGE_SMART_APPLY__)window.__JOBSAGE_SMART_APPLY__.command(JSON.parse(${payload}));}catch(e){}})();true;`;
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function validQuestion(q: unknown): q is ScanQuestion {
  const x = q as Partial<ScanQuestion>;
  return !!x && str(x.id, 200) && str(x.question, 3000) && typeof x.restricted === "boolean"
    && (x.bucket === "generate" || x.bucket === "structured" || x.bucket === "confirmation")
    && str(x.signature, 1000) && typeof x.required === "boolean" && typeof x.requiredKnown === "boolean"
    && typeof x.answered === "boolean"
    && (x.maxLength === undefined || (typeof x.maxLength === "number" && x.maxLength > 0))
    && (x.wordLimit === undefined || (typeof x.wordLimit === "number" && x.wordLimit > 0));
}

function validField(f: unknown): f is StructuredFieldDescriptor {
  const x = f as Partial<StructuredFieldDescriptor>;
  return !!x && str(x.id, 200) && str(x.label, 3000)
    && ["text", "textarea", "number", "date", "select", "radio"].includes(String(x.controlType))
    && Array.isArray(x.options) && x.options.length <= 200 && x.options.every((o) => str(o, 500));
}

/**
 * Employer pages are untrusted: messages are only accepted for display state
 * and never trigger privileged first-party actions.
 */
export function validatePageMessage(raw: string, opts: {
  /** Actual OS-reported WebView URL (event.nativeEvent.url), never the page's claim alone. */
  channel: string; applicationId: number; navigationUrl: string; now?: number;
}): PageMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_RAW_MESSAGE) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const now = opts.now ?? Date.now();
  if (m.version !== 1 || m.channel !== opts.channel || m.applicationId !== opts.applicationId) return null;
  if (typeof m.timestamp !== "number" || Math.abs(now - m.timestamp) > 60_000) return null;
  if (typeof m.url !== "string" || !safeEmployerUrl(m.url) || !safeEmployerUrl(opts.navigationUrl)) return null;
  if (!/^https:\/\//i.test(opts.navigationUrl) || m.url !== opts.navigationUrl) return null;

  switch (m.type) {
    case "scan": {
      const c = m.context as ScanSnapshot["context"] | undefined;
      if (!c || !str(c.jobTitle ?? "", 500) || !str(c.companyName ?? "", 500) || !str(c.jobDescription ?? "", 12_000)) return null;
      if (!Array.isArray(m.questions) || m.questions.length > 40 || !m.questions.every(validQuestion)) return null;
      if (!Array.isArray(m.structuredFields) || m.structuredFields.length > 40 || !m.structuredFields.every(validField)) return null;
      return {
        type: "scan",
        context: { jobTitle: c.jobTitle ?? "", companyName: c.companyName ?? "", jobDescription: c.jobDescription ?? "", pageUrl: String(c.pageUrl ?? "") },
        applicationPage: m.applicationPage === true,
        questions: m.questions as ScanQuestion[],
        structuredFields: m.structuredFields as StructuredFieldDescriptor[],
      };
    }
    case "prefill": {
      const r = m.result as PrefillResult | undefined;
      if (!r || !Array.isArray(r.filled) || !Array.isArray(r.missing) || !Array.isArray(r.skipped) || typeof r.fieldResults !== "object") return null;
      return { type: "prefill", result: r };
    }
    case "structured":
      return typeof m.filled === "number" ? { type: "structured", filled: m.filled } : null;
    case "inserted":
      return str(m.questionId, 200) ? { type: "inserted", questionId: m.questionId } : null;
    case "cleared":
      return { type: "cleared" };
    case "cv-attached":
      return str(m.filename, 200) ? { type: "cv-attached", filename: m.filename } : null;
    case "submission": {
      const s = m.signal as { source?: unknown } | undefined;
      return s && str(s.source, 60) ? { type: "submission", signal: { source: s.source } } : null;
    }
    case "error":
      return str(m.message, 500) ? { type: "error", message: m.message } : null;
    default:
      return null;
  }
}

/** Parses a complete SSE body of `data: {...}` frames. */
export function parseSseAnswer(body: string): { text: string; error: string | null; done: boolean } {
  let text = "";
  let error: string | null = null;
  let done = false;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const frame = JSON.parse(data) as { text?: unknown; done?: unknown; error?: unknown };
      if (typeof frame.text === "string") text += frame.text;
      if (frame.done) done = true;
      if (typeof frame.error === "string") error = frame.error;
    } catch {
      // ignore malformed frame
    }
  }
  return { text, error, done };
}

export function wordCount(value: string): number {
  const t = value.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function charLimit(q: Pick<DetectedQuestion, "maxLength">): number {
  return Math.min(q.maxLength ?? MAX_ANSWER_CHARS, MAX_ANSWER_CHARS);
}

export function limitProblem(q: Pick<DetectedQuestion, "maxLength" | "wordLimit">, value: string): string | null {
  if (value.length > charLimit(q)) return `Over the ${charLimit(q)} character limit.`;
  if (q.wordLimit && wordCount(value) > q.wordLimit) return `Over the ${q.wordLimit} word limit.`;
  return null;
}

/** Only non-restricted free-text questions may use AI drafting or insertion. */
export function canDraft(q: Pick<DetectedQuestion, "restricted" | "bucket">): boolean {
  return !q.restricted && q.bucket === "generate";
}

export type SseFrame = { text?: string; done?: boolean; error?: string };

/** Incremental SSE parser: feed decoded chunks, receive complete frames. */
export function createSseStreamParser(onFrame: (f: SseFrame) => void) {
  let buffer = "";
  const flushLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const f = JSON.parse(data) as Record<string, unknown>;
      onFrame({
        text: typeof f.text === "string" ? f.text : undefined,
        done: f.done ? true : undefined,
        error: typeof f.error === "string" ? f.error : undefined,
      });
    } catch {
      // ignore malformed frame
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      if (buffer.length > 400_000) throw new Error("The draft response was too large.");
      let i: number;
      while ((i = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(buffer[i] === "\r" ? i + 2 : i + 1);
        flushLine(line);
      }
    },
    end() {
      if (buffer) flushLine(buffer);
      buffer = "";
    },
  };
}
