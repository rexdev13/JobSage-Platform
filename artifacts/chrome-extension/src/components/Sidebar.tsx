import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import type { JobContext } from "../lib/scraper";
import type { DetectedQuestion, QuestionWatcher } from "../lib/questionDetector";
import { insertAnswer, highlightField } from "../lib/questionDetector";
import { BRAND } from "../lib/brand";
import type { PillPos } from "../lib/types";
import type { PrefillResult } from "../lib/prefill";
import type { CvAttachResult } from "../lib/cvAttachment";

const COLORS = {
  bg: BRAND.bg,
  border: BRAND.border,
  primary: BRAND.primary,
  primaryHover: BRAND.primaryHover,
  text: BRAND.text,
  textMuted: BRAND.textMuted,
  inputBg: BRAND.inputBg,
  successBg: BRAND.successBg,
  successText: BRAND.successText,
  errorBg: BRAND.errorBg,
  errorText: BRAND.errorText,
  pillBg: BRAND.primary,
  pillText: "#ffffff",
};

const RADIUS = BRAND.radiusSm;
const PILL_POSITION_KEY = "jobsage_pill_position";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SidebarProps {
  jobContext: JobContext;
  /**
   * When true (unrecognized sites), the collapsed launcher renders as a small
   * icon-only badge instead of the labelled pill. It is fully hidden when
   * minimal AND no questions are detected AND the sidebar is closed.
   */
  minimal?: boolean;
  questionWatcher?: QuestionWatcher;
  onLogApplication: (companyName: string, jobTitle: string, pageUrl: string) => Promise<void>;
  /** Pill position loaded from storage on startup. null = default bottom-right. */
  initialPosition?: PillPos | null;
  /** Called when the candidate dismisses the launcher for this site or session. */
  onDismiss: (scope: "site" | "session") => void;
  /** When true the sidebar panel starts open (used when activated via popup button). */
  startOpen?: boolean;
  /** Receives a callback that external code can call to imperatively open the sidebar. */
  onOpen?: (openFn: () => void) => void;
  /** This tab originated from a JOBSAGE opportunity. */
  tracked?: boolean;
  onPrefill?: () => Promise<PrefillResult>;
  onAttachCv?: () => Promise<CvAttachResult & { downloaded?: boolean }>;
}

const EMPTY_QUESTIONS: DetectedQuestion[] = [];

// ---------------------------------------------------------------------------
// Streaming assistant hook
// ---------------------------------------------------------------------------

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

  const generate = useCallback((question: string, jobContext: JobContext) => {
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
  }, []);

  return { answer, streaming, error, generate, setAnswer };
}

function limitHint(q: DetectedQuestion): string | null {
  if (q.wordLimit) return `${q.wordLimit} word limit`;
  if (q.maxLength) return `${q.maxLength} character limit`;
  return null;
}

// ---------------------------------------------------------------------------
// Draggable pill helpers
// ---------------------------------------------------------------------------

const PILL_H = 42;
const PILL_W_COMPACT = 36;
const PILL_H_COMPACT = 36;

function clamp(val: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, val));
}

function defaultPos(compact: boolean): PillPos {
  const w = compact ? PILL_W_COMPACT : 148; // approximate full pill width
  const h = compact ? PILL_H_COMPACT : PILL_H;
  return {
    left: window.innerWidth - w - 24,
    top: window.innerHeight - h - 24,
  };
}

// ---------------------------------------------------------------------------
// Sidebar component
// ---------------------------------------------------------------------------

export function Sidebar({
  jobContext,
  minimal = false,
  questionWatcher,
  onLogApplication,
  initialPosition = null,
  onDismiss,
  startOpen = false,
  onOpen,
  tracked = false,
  onPrefill,
  onAttachCv,
}: SidebarProps) {
  const [open, setOpen] = useState(startOpen);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillResult, setPrefillResult] = useState<PrefillResult | null>(null);
  const [attachingCv, setAttachingCv] = useState(false);
  const [cvResult, setCvResult] = useState<(CvAttachResult & { downloaded?: boolean }) | null>(null);
  const autoPrefilledRef = useRef(false);

  // Expose an imperative open handle so the content script can open the
  // sidebar when the user clicks "Use JOBSAGE on this page" in the popup.
  // useEffect keeps the callback fresh without re-registering on every render.
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  useEffect(() => {
    onOpen?.(() => setOpenRef.current(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpen]);

  const handlePrefill = useCallback(async () => {
    if (!onPrefill || prefilling) return;
    setPrefilling(true);
    setPrefillResult(null);
    try {
      setPrefillResult(await onPrefill());
    } finally {
      setPrefilling(false);
    }
  }, [onPrefill, prefilling]);

  const handleAttachCv = useCallback(async () => {
    if (!onAttachCv || attachingCv) return;
    setAttachingCv(true);
    setCvResult(null);
    try {
      setCvResult(await onAttachCv());
    } finally {
      setAttachingCv(false);
    }
  }, [onAttachCv, attachingCv]);

  useEffect(() => {
    if (tracked && onPrefill && !autoPrefilledRef.current) {
      autoPrefilledRef.current = true;
      void handlePrefill();
    }
  }, [tracked, onPrefill, handlePrefill]);
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [insertFailed, setInsertFailed] = useState(false);
  const [logging, setLogging] = useState(false);
  const [logDone, setLogDone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { answer, streaming, error, generate, setAnswer } = useStreamAnswer();

  // Question detection
  const subscribe = useCallback(
    (listener: () => void) => (questionWatcher ? questionWatcher.subscribe(listener) : () => {}),
    [questionWatcher],
  );
  const getSnapshot = useCallback(
    () => (questionWatcher ? questionWatcher.getSnapshot() : EMPTY_QUESTIONS),
    [questionWatcher],
  );
  const detected = useSyncExternalStore(subscribe, getSnapshot);
  const selectedQuestion = selectedId ? detected.find((q) => q.id === selectedId) ?? null : null;

  // ---------------------------------------------------------------------------
  // Draggable pill state
  // ---------------------------------------------------------------------------
  const compact = minimal && !open;
  const [pos, setPos] = useState<PillPos | null>(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const hasDraggedRef = useRef(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    pillLeft: number;
    pillTop: number;
  } | null>(null);
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const dismissBtnRef = useRef<HTMLButtonElement>(null);

  // Dismiss menu
  const [showDismissMenu, setShowDismissMenu] = useState(false);

  // Effective pill position (use stored pos, else compute default)
  const effPos = pos ?? defaultPos(compact);
  const pillLeft = effPos.left;
  const pillTop = effPos.top;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Don't initiate drag when clicking the dismiss button
    if (dismissBtnRef.current && dismissBtnRef.current.contains(e.target as Node)) return;
    hasDraggedRef.current = false;
    const current = pos ?? defaultPos(compact);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      pillLeft: current.left,
      pillTop: current.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;
    if (!hasDraggedRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      hasDraggedRef.current = true;
      setIsDragging(true);
      setShowDismissMenu(false); // close menu if open during drag
    }
    if (!hasDraggedRef.current) return;
    const pillW = compact ? PILL_W_COMPACT : 148;
    const pillH = compact ? PILL_H_COMPACT : PILL_H;
    const newLeft = clamp(dragStartRef.current.pillLeft + dx, 0, window.innerWidth - pillW);
    const newTop = clamp(dragStartRef.current.pillTop + dy, 0, window.innerHeight - pillH);
    setPos({ left: newLeft, top: newTop });
  }

  function handlePointerUp() {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setIsDragging(false);
    if (hasDraggedRef.current && pos) {
      // Persist position to extension storage
      try {
        void chrome.storage.local.set({ [PILL_POSITION_KEY]: pos });
      } catch {
        // storage unavailable (e.g. extension context invalidated)
      }
    }
    // hasDraggedRef.current intentionally left true — checked in click handler below
  }

  function handlePillClick() {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false; // reset so next click works normally
      return; // was a drag, not a tap — don't toggle sidebar
    }
    setShowDismissMenu(false);
    setOpen((o) => !o);
  }

  // ---------------------------------------------------------------------------
  // Application question handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Render — fully hidden when minimal + closed + no detected questions
  // ---------------------------------------------------------------------------

  if (minimal && !open && detected.length === 0) {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Pill (launcher)
  // ---------------------------------------------------------------------------

  const pill = (
    <div
      ref={pillContainerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: "fixed",
        left: pillLeft,
        top: pillTop,
        zIndex: 2147483646,
        userSelect: "none",
        touchAction: "none",
        cursor: isDragging ? "grabbing" : "grab",
        display: "inline-flex",
        alignItems: "stretch",
        borderRadius: 9999,
        boxShadow: compact
          ? "0 2px 8px rgba(0,0,0,0.2)"
          : "0 4px 14px rgba(0,0,0,0.25)",
      }}
    >
      {/* Main toggle button */}
      <button
        onClick={handlePillClick}
        title={open ? "Close JOBSAGE" : "Open JOBSAGE"}
        aria-label={open ? "Close JOBSAGE" : "Open JOBSAGE"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: compact ? 0 : 8,
          padding: compact ? 0 : "0 14px",
          width: compact ? PILL_W_COMPACT : undefined,
          height: compact ? PILL_H_COMPACT : PILL_H,
          opacity: compact ? 0.8 : 1,
          background: COLORS.pillBg,
          color: COLORS.pillText,
          fontFamily: BRAND.fontSans,
          fontSize: 14,
          fontWeight: 600,
          border: "none",
          // Left side is always rounded; right side is only rounded when there
          // is no dismiss button (compact or sidebar is open)
          borderRadius: !compact && !open ? "9999px 0 0 9999px" : 9999,
          cursor: isDragging ? "grabbing" : "pointer",
          pointerEvents: isDragging ? "none" : "auto",
        }}
      >
        <svg
          width={compact ? 16 : 18}
          height={compact ? 16 : 18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
          <polyline points="16 3 21 3 21 8" />
          <line x1={10} y1={14} x2={21} y2={3} />
        </svg>
        {!compact && "JOBSAGE"}
      </button>

      {/* Dismiss separator + button — visible only on full pill when sidebar is closed */}
       {!compact && !open && !tracked && (
        <>
          {/* 1 px hairline divider */}
          <div
            style={{
              width: 1,
              background: "rgba(255,255,255,0.25)",
              flexShrink: 0,
            }}
          />
          <button
            ref={dismissBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowDismissMenu((s) => !s);
            }}
            aria-label="Dismiss JOBSAGE launcher"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: PILL_H,
              background: COLORS.pillBg,
              color: "rgba(255,255,255,0.85)",
              border: "none",
              borderRadius: "0 9999px 9999px 0",
              cursor: isDragging ? "grabbing" : "pointer",
              fontSize: 17,
              lineHeight: 1,
              padding: 0,
              pointerEvents: isDragging ? "none" : "auto",
            }}
          >
            ×
          </button>
        </>
      )}

      {/* Dismiss menu popover */}
       {showDismissMenu && !tracked && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            background: BRAND.bg,
            border: `1px solid ${BRAND.border}`,
            borderRadius: RADIUS,
            boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
            zIndex: 2147483647,
            overflow: "hidden",
            minWidth: 220,
          }}
        >
          <div
            style={{
              padding: "8px 12px 4px",
              fontSize: 11,
              fontWeight: 600,
              color: BRAND.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontFamily: BRAND.fontSans,
            }}
          >
            Hide JOBSAGE launcher
          </div>
          {(["site", "session"] as const).map((scope) => (
            <button
              key={scope}
              onClick={() => {
                setShowDismissMenu(false);
                onDismiss(scope);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "9px 12px",
                background: "none",
                border: "none",
                borderTop: `1px solid ${BRAND.border}`,
                fontSize: 12,
                color: BRAND.text,
                cursor: "pointer",
                fontFamily: BRAND.fontSans,
                lineHeight: 1.4,
              }}
            >
              {scope === "site"
                ? `On ${location.hostname}`
                : "For this session"}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!open) return pill;

  // ---------------------------------------------------------------------------
  // Full sidebar panel
  // ---------------------------------------------------------------------------

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
          fontFamily: BRAND.fontSans,
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
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: COLORS.primary,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 2,
              }}
            >
              JOBSAGE Copilot
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: COLORS.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {jobContext.jobTitle || "Role detected"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: COLORS.textMuted,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
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
           <section
             style={{
               padding: "10px 12px",
               border: `1px solid ${COLORS.border}`,
               borderRadius: RADIUS,
               background: COLORS.inputBg,
               display: "flex",
               flexDirection: "column",
               gap: 8,
             }}
           >
             <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>Your application details</div>
             <button
               onClick={() => void handlePrefill()}
               disabled={!onPrefill || prefilling}
               style={{
                 padding: "8px 10px",
                 background: COLORS.primary,
                 color: "#fff",
                 border: "none",
                 borderRadius: RADIUS,
                 fontSize: 12,
                 fontWeight: 600,
                 cursor: !onPrefill || prefilling ? "not-allowed" : "pointer",
                 opacity: !onPrefill || prefilling ? 0.65 : 1,
               }}
             >
               {prefilling ? "Prefilling…" : "Prefill my details"}
             </button>
             {prefillResult && (
               <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.45 }}>
                 {prefillResult.filled.length > 0
                   ? `Filled: ${prefillResult.filled.join(", ")}. `
                   : "No empty, safe details were filled. "}
                 {prefillResult.missing.length > 0 && (
                   <span>Complete {prefillResult.missing.join(", ")} in JOBSAGE to prefill it.</span>
                 )}
               </div>
             )}
             <button
               onClick={() => void handleAttachCv()}
               disabled={!onAttachCv || attachingCv}
               style={{
                 padding: "8px 10px",
                 background: "transparent",
                 color: COLORS.primary,
                 border: `1px solid ${COLORS.primary}`,
                 borderRadius: RADIUS,
                 fontSize: 12,
                 fontWeight: 600,
                 cursor: !onAttachCv || attachingCv ? "not-allowed" : "pointer",
                 opacity: !onAttachCv || attachingCv ? 0.65 : 1,
               }}
             >
               {attachingCv ? "Getting CV…" : "Attach my JOBSAGE CV"}
             </button>
             {cvResult && (
               <div style={{ fontSize: 12, color: cvResult.attached ? COLORS.successText : COLORS.textMuted, lineHeight: 1.45 }}>
                 {cvResult.attached
                   ? `Attached ${cvResult.filename}.`
                   : cvResult.downloaded
                   ? `Downloaded ${cvResult.filename}. Upload this file on the form.`
                   : "No CV upload field was found on this page. Use the button again to download your CV."}
               </div>
             )}
           </section>
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
                        background: active ? BRAND.primarySoftActive : COLORS.inputBg,
                        border: `1px solid ${active ? COLORS.primary : COLORS.border}`,
                        borderRadius: RADIUS,
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
            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 6 }}
            >
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
                borderRadius: RADIUS,
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
              background: streaming || !question.trim() ? BRAND.primaryDisabled : COLORS.primary,
              color: "#fff",
              border: "none",
              borderRadius: RADIUS,
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
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Generating…
              </>
            ) : (
              "Generate Answer"
            )}
          </button>

          {error && (
            <div
              style={{
                padding: "10px 12px",
                background: COLORS.errorBg,
                color: COLORS.errorText,
                fontSize: 12,
                borderRadius: RADIUS,
                lineHeight: 1.5,
              }}
            >
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
                  borderRadius: RADIUS,
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
                <div
                  style={{
                    padding: "8px 10px",
                    background: COLORS.errorBg,
                    color: COLORS.errorText,
                    fontSize: 12,
                    borderRadius: RADIUS,
                    lineHeight: 1.5,
                  }}
                >
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
                      border: `1px solid ${inserted ? BRAND.successBorder : COLORS.primary}`,
                      borderRadius: RADIUS,
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
                    border: `1px solid ${copied ? BRAND.successBorder : COLORS.border}`,
                    borderRadius: RADIUS,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {copied ? "✓ Copied!" : "Copy Answer"}
                </button>
                <button
                  onClick={() => setAnswer("")}
                  style={{
                    padding: "8px 12px",
                    background: "none",
                    color: COLORS.textMuted,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: RADIUS,
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
                borderRadius: RADIUS,
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
