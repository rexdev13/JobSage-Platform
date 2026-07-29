import { useState, useCallback, useRef, useSyncExternalStore } from "react";
import type { JobContext } from "../lib/scraper";
import type { DetectedQuestion, QuestionWatcher } from "../lib/questionDetector";
import { insertAnswer, highlightField } from "../lib/questionDetector";

const COLORS = {
  bg: "#ffffff",
  border: "#e5e7eb",
  primary: "#1a56db",
  primaryHover: "#1e40af",
  text: "#111827",
  textMuted: "#6b7280",
  inputBg: "#f9fafb",
  successBg: "#f0fdf4",
  successText: "#15803d",
  errorBg: "#fef2f2",
  errorText: "#dc2626",
  pillBg: "#1a56db",
  pillText: "#ffffff",
};

interface SidebarProps {
  jobContext: JobContext;
  /**
   * When true (unrecognized sites), the collapsed launcher renders as a small
   * icon-only badge instead of the labelled pill, so the extension stays
   * unobtrusive during normal browsing.
   */
  minimal?: boolean;
  /** Live watcher over free-text application questions detected on the page. */
  questionWatcher?: QuestionWatcher;
  onLogApplication: (companyName: string, jobTitle: string, pageUrl: string) => Promise<void>;
}

const EMPTY_QUESTIONS: DetectedQuestion[] = [];

type AssistantStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "error"; kind: "auth" | "server" | "network"; status?: number; message?: string }
  | { type: "done" };

function errorMessageFor(event: Extract<AssistantStreamEvent, { type: "error" }>): string {
  if (event.kind === "auth") {
    return "Please sign in to JOBSAGE (jobsage.co.uk) in another tab, then try again.";
  }
  if (event.kind === "server") {
    return event.message
      ? `JOBSAGE couldn't generate an answer: ${event.message}`
      : `JOBSAGE couldn't generate an answer right now (error ${event.status ?? "unknown"}). Please try again in a moment.`;
  }
  return "Could not reach the JOBSAGE API. Check your internet connection and try again.";
}

function useStreamAnswer() {
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  const generate = useCallback(
    (question: string, jobContext: JobContext) => {
      if (!question.trim()) return;
      portRef.current?.disconnect();

      setAnswer("");
      setError(null);
      setStreaming(true);

      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: "assistant-stream" });
      } catch {
        setError("The JOBSAGE extension was updated or reloaded. Please refresh this page and try again.");
        setStreaming(false);
        return;
      }
      portRef.current = port;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        setStreaming(false);
        if (portRef.current === port) portRef.current = null;
        port.disconnect();
      };

      port.onMessage.addListener((event: AssistantStreamEvent) => {
        if (event.type === "chunk") {
          setAnswer((prev) => prev + event.text);
        } else if (event.type === "error") {
          setError(errorMessageFor(event));
          finish();
        } else if (event.type === "done") {
          finish();
        }
      });

      // If the service worker goes away before the stream completes, surface
      // a network-style error rather than spinning forever.
      port.onDisconnect.addListener(() => {
        if (!finished) {
          finished = true;
          setStreaming(false);
          if (portRef.current === port) portRef.current = null;
          setError("Could not reach the JOBSAGE API. Check your internet connection and try again.");
        }
      });

      port.postMessage({
        message: `${question.trim()}\n\nJob context: ${jobContext.jobTitle} at ${jobContext.companyName}. ${jobContext.jobDescription.slice(0, 800)}`,
      });
    },
    []
  );

  return { answer, streaming, error, generate, setAnswer };
}

function limitHint(q: DetectedQuestion): string | null {
  if (q.wordLimit) return `${q.wordLimit} word limit`;
  if (q.maxLength) return `${q.maxLength} character limit`;
  return null;
}

export function Sidebar({ jobContext, minimal = false, questionWatcher, onLogApplication }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [insertFailed, setInsertFailed] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logDone, setLogDone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { answer, streaming, error, generate, setAnswer } = useStreamAnswer();

  const subscribe = useCallback(
    (listener: () => void) => (questionWatcher ? questionWatcher.subscribe(listener) : () => {}),
    [questionWatcher]
  );
  const getSnapshot = useCallback(
    () => (questionWatcher ? questionWatcher.getSnapshot() : EMPTY_QUESTIONS),
    [questionWatcher]
  );
  const detected = useSyncExternalStore(subscribe, getSnapshot);
  const selectedQuestion = selectedId ? detected.find((q) => q.id === selectedId) ?? null : null;

  const buildPrompt = (q: string, dq: DetectedQuestion | null) => {
    const hint = dq ? limitHint(dq) : null;
    return hint ? `${q.trim()}\n\n(Keep the answer within the ${hint}.)` : q.trim();
  };

  const handleGenerate = () => {
    setInserted(false);
    setInsertFailed(false);
    generate(buildPrompt(question, selectedQuestion), jobContext);
  };

  const handleSelectDetected = (dq: DetectedQuestion) => {
    setSelectedId(dq.id);
    setQuestion(dq.question);
    setInserted(false);
    setInsertFailed(false);
    highlightField(dq.id);
    generate(buildPrompt(dq.question, dq), jobContext);
  };

  const handleInsert = () => {
    if (!answer || !selectedId) return;
    const ok = insertAnswer(selectedId, answer);
    setInserted(ok);
    setInsertFailed(!ok);
    if (ok) {
      highlightField(selectedId);
      setTimeout(() => setInserted(false), 2500);
    }
  };

  const handleCopy = async () => {
    if (!answer) return;
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLog = async () => {
    setLogging(true);
    try {
      await onLogApplication(jobContext.companyName, jobContext.jobTitle, jobContext.pageUrl);
      setLogDone(true);
    } finally {
      setLogging(false);
    }
  };

  // On unrecognized sites the collapsed launcher is a small icon-only badge;
  // on known job boards it's the full labelled pill.
  const compact = minimal && !open;
  const pill = (
    <button
      onClick={() => setOpen((o) => !o)}
      title="JOBSAGE assistant"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 2147483646,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 0 : 8,
        padding: compact ? 0 : "10px 18px",
        width: compact ? 36 : undefined,
        height: compact ? 36 : undefined,
        opacity: compact ? 0.75 : 1,
        background: COLORS.pillBg,
        color: COLORS.pillText,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 14,
        fontWeight: 600,
        border: "none",
        borderRadius: 9999,
        cursor: "pointer",
        boxShadow: compact ? "0 2px 8px rgba(0,0,0,0.2)" : "0 4px 14px rgba(0,0,0,0.25)",
        userSelect: "none",
      }}
      aria-label={open ? "Close JOBSAGE" : "Open JOBSAGE"}
    >
      <svg width={compact ? 16 : 18} height={compact ? 16 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
        <polyline points="16 3 21 3 21 8" />
        <line x1={10} y1={14} x2={21} y2={3} />
      </svg>
      {!compact && "JOBSAGE"}
    </button>
  );

  if (!open) return pill;

  return (
    <>
      {pill}
      <div
        role="dialog"
        aria-label="JOBSAGE Copilot"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          zIndex: 2147483645,
          background: COLORS.bg,
          borderLeft: `1px solid ${COLORS.border}`,
          display: "flex",
          flexDirection: "column",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.primary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
              JOBSAGE Copilot
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {jobContext.jobTitle || "Role detected"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {jobContext.companyName}
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: COLORS.textMuted,
              padding: 4,
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1={18} y1={6} x2={6} y2={18} />
              <line x1={6} y1={6} x2={18} y2={18} />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {detected.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>
                Detected questions
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {detected.map((dq) => {
                  const active = dq.id === selectedId;
                  const hint = limitHint(dq);
                  return (
                    <button
                      key={dq.id}
                      onClick={() => handleSelectDetected(dq)}
                      disabled={streaming}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        background: active ? "#eff6ff" : COLORS.inputBg,
                        border: `1px solid ${active ? COLORS.primary : COLORS.border}`,
                        borderRadius: 8,
                        fontSize: 12,
                        color: COLORS.text,
                        cursor: streaming ? "not-allowed" : "pointer",
                        lineHeight: 1.4,
                        fontFamily: "inherit",
                      }}
                    >
                      {dq.question}
                      {hint && (
                        <span style={{ display: "block", marginTop: 2, fontSize: 11, color: COLORS.textMuted }}>
                          {hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}>
              {detected.length > 0 ? "Or paste a question manually" : "Application question"}
            </label>
            <textarea
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setSelectedId(null);
              }}
              placeholder="Paste the application question here, e.g. 'Describe a time you handled a clinical crisis…'"
              rows={4}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                fontSize: 13,
                color: COLORS.text,
                background: COLORS.inputBg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                resize: "vertical",
                outline: "none",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={streaming || !question.trim()}
            style={{
              padding: "9px 16px",
              background: streaming || !question.trim() ? "#93c5fd" : COLORS.primary,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: streaming || !question.trim() ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {streaming ? (
              <>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Generating…
              </>
            ) : (
              "Generate Answer"
            )}
          </button>

          {error && (
            <div style={{ padding: "10px 12px", background: COLORS.errorBg, color: COLORS.errorText, fontSize: 12, borderRadius: 8, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          {answer && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>Generated answer</div>
              <div
                style={{
                  padding: "10px 12px",
                  background: COLORS.inputBg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  fontSize: 13,
                  color: COLORS.text,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {answer}
              </div>
              {insertFailed && (
                <div style={{ padding: "8px 10px", background: COLORS.errorBg, color: COLORS.errorText, fontSize: 12, borderRadius: 8, lineHeight: 1.5 }}>
                  Couldn't find the form field anymore — it may have changed. Use Copy Answer instead.
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                {selectedId && !streaming && (
                  <button
                    onClick={handleInsert}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: inserted ? COLORS.successBg : COLORS.primary,
                      color: inserted ? COLORS.successText : "#fff",
                      border: `1px solid ${inserted ? "#86efac" : COLORS.primary}`,
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {inserted ? "✓ Inserted!" : "Insert into form"}
                  </button>
                )}
                <button
                  onClick={handleCopy}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    background: copied ? COLORS.successBg : COLORS.inputBg,
                    color: copied ? COLORS.successText : COLORS.text,
                    border: `1px solid ${copied ? "#86efac" : COLORS.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {copied ? "✓ Copied!" : "Copy Answer"}
                </button>
                <button
                  onClick={() => { setAnswer(""); }}
                  style={{
                    padding: "8px 12px",
                    background: "none",
                    color: COLORS.textMuted,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer — log application */}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${COLORS.border}` }}>
          {logDone ? (
            <div style={{ fontSize: 12, color: COLORS.successText, textAlign: "center", fontWeight: 600 }}>
              ✓ Application logged to JOBSAGE
            </div>
          ) : (
            <button
              onClick={handleLog}
              disabled={logging}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "none",
                color: logging ? COLORS.textMuted : COLORS.primary,
                border: `1px solid ${logging ? COLORS.border : COLORS.primary}`,
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: logging ? "not-allowed" : "pointer",
              }}
            >
              {logging ? "Logging…" : "Log this application to JOBSAGE"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
