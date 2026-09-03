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
const SIDEBAR_WIDTH_KEY = "jobsage_sidebar_width";
const SIDEBAR_DEFAULT_WIDTH = 420;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 720;
const SIDEBAR_VIEWPORT_GUTTER = 32;
const SIDEBAR_NARROW_MIN_WIDTH = 240;
const PILL_GRIP_WIDTH = 18;

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
  /** Sidebar width loaded from storage on startup. null = a comfortable default. */
  initialSidebarWidth?: number | null;
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
  onClearAnswerMemory?: () => Promise<number>;
}

const EMPTY_QUESTIONS: DetectedQuestion[] = [];

// ---------------------------------------------------------------------------
// Streaming assistant hook
// ---------------------------------------------------------------------------

type AssistantStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "error"; kind: "auth" | "server" | "network"; status?: number; message?: string }
  | { type: "done" };

export const ASSISTANT_STREAM_TIMEOUT_MS = 55_000;

function errorMessageFor(event: Extract<AssistantStreamEvent, { type: "error" }>): string {
  if (event.kind === "auth") {
    return "Please sign in to JOBSAGE (jobsage.co.uk) in another tab, then try again.";
  }
  if (event.kind === "server") {
    return "JOBSAGE couldn't generate an answer right now. Please try again in a moment.";
  }
  return "Could not reach the JOBSAGE API. Check your internet connection and try again.";
}

function useStreamAnswer() {
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef<((reason: string) => void) | null>(null);

  const cancel = useCallback((reason = "Generation cancelled. You can retry when ready.") => {
    cancelRef.current?.(reason);
  }, []);

  const generate = useCallback((question: string, jobContext: JobContext, detectedQuestion: DetectedQuestion | null = null) => {
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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setStreaming(false);
      if (portRef.current === port) portRef.current = null;
      if (cancelRef.current) cancelRef.current = null;
      port.disconnect();
    };
    cancelRef.current = (reason) => {
      setError(reason);
      finish();
    };
    timeoutRef.current = setTimeout(() => {
      if (finished) return;
      setError("Generation timed out after 55 seconds. Please retry.");
      finish();
    }, ASSISTANT_STREAM_TIMEOUT_MS);

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

    try {
      port.postMessage({
        message: `${question.trim()}\n\nJob context: ${jobContext.jobTitle} at ${jobContext.companyName}. ${jobContext.jobDescription.slice(0, 800)}`,
        questionId: detectedQuestion?.id,
        questionText: detectedQuestion?.question ?? question.trim(),
        wordLimit: detectedQuestion?.wordLimit,
        maxLength: detectedQuestion?.maxLength,
        jobTitle: jobContext.jobTitle,
        employer: jobContext.companyName,
        jobDescription: jobContext.jobDescription.slice(0, 1500),
      });
    } catch {
      finish();
      setError("The JOBSAGE extension was updated or reloaded. Please refresh this page and try again.");
    }
  }, []);

  return { answer, streaming, error, generate, cancel, setAnswer, setError };
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

function pillWidth(compact: boolean, showDismiss: boolean): number {
  if (compact) return PILL_GRIP_WIDTH + (showDismiss ? PILL_W_COMPACT + 31 : PILL_W_COMPACT);
  return PILL_GRIP_WIDTH + (showDismiss ? 179 : 148);
}

function pillHeight(compact: boolean): number {
  return compact ? PILL_H_COMPACT : PILL_H;
}

function clampPosition(position: PillPos, compact: boolean, showDismiss: boolean): PillPos {
  const width = pillWidth(compact, showDismiss);
  const height = pillHeight(compact);
  return {
    left: clamp(position.left, 0, Math.max(0, window.innerWidth - width)),
    top: clamp(position.top, 0, Math.max(0, window.innerHeight - height)),
  };
}

function defaultPos(compact: boolean, showDismiss: boolean): PillPos {
  const w = pillWidth(compact, showDismiss);
  const h = pillHeight(compact);
  return {
    left: window.innerWidth - w - 24,
    top: window.innerHeight - h - 24,
  };
}

export function sidebarWidthBounds(viewportWidth = window.innerWidth) {
  const available = Math.max(SIDEBAR_NARROW_MIN_WIDTH, viewportWidth - SIDEBAR_VIEWPORT_GUTTER);
  const minimum = Math.min(SIDEBAR_MIN_WIDTH, available);
  const maximum = Math.max(minimum, Math.min(SIDEBAR_MAX_WIDTH, available));
  return { minimum, maximum };
}

export function clampSidebarWidth(width: number, viewportWidth = window.innerWidth): number {
  const { minimum, maximum } = sidebarWidthBounds(viewportWidth);
  return clamp(width, minimum, maximum);
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
  initialSidebarWidth = null,
  onDismiss,
  startOpen = false,
  onOpen,
  tracked = false,
  onPrefill,
  onAttachCv,
  onClearAnswerMemory,
}: SidebarProps) {
  const [open, setOpen] = useState(startOpen);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(initialSidebarWidth ?? SIDEBAR_DEFAULT_WIDTH),
  );
  const [prefilling, setPrefilling] = useState(false);
  const [prefillResult, setPrefillResult] = useState<PrefillResult | null>(null);
  const [attachingCv, setAttachingCv] = useState(false);
  const [cvResult, setCvResult] = useState<(CvAttachResult & { downloaded?: boolean }) | null>(null);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [memoryClearResult, setMemoryClearResult] = useState<number | null>(null);
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

  const handleClearAnswerMemory = useCallback(async () => {
    if (!onClearAnswerMemory || clearingMemory) return;
    setClearingMemory(true);
    setMemoryClearResult(null);
    try {
      setMemoryClearResult(await onClearAnswerMemory());
    } finally {
      setClearingMemory(false);
    }
  }, [clearingMemory, onClearAnswerMemory]);

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
  const { answer, streaming, error, generate, cancel, setAnswer, setError } = useStreamAnswer();

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
  const showDismiss = !open && !tracked;
  const [pos, setPos] = useState<PillPos | null>(() =>
    initialPosition ? clampPosition(initialPosition, compact, showDismiss) : null,
  );
  const posRef = useRef<PillPos | null>(pos);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    pillLeft: number;
    pillTop: number;
  } | null>(null);
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Dismiss menu
  const [showDismissMenu, setShowDismissMenu] = useState(false);

  // Effective pill position (use stored pos, else compute default)
  const effPos = clampPosition(pos ?? defaultPos(compact, showDismiss), compact, showDismiss);
  const pillLeft = effPos.left;
  const pillTop = effPos.top;
  sidebarWidthRef.current = sidebarWidth;

  useEffect(() => {
    const onResize = () => {
      const current = posRef.current;
      if (!current) return;
      const next = clampPosition(current, compact, showDismiss);
      if (next.left === current.left && next.top === current.top) return;
      posRef.current = next;
      setPos(next);
      void chrome.storage.local.set({ [PILL_POSITION_KEY]: next }).catch(() => {});
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [compact, showDismiss]);

  useEffect(() => {
    if (initialPosition) return;
    try {
      void chrome.storage.local.get(PILL_POSITION_KEY).then((stored) => {
        const saved = stored[PILL_POSITION_KEY] as PillPos | undefined;
        if (!saved || typeof saved.left !== "number" || typeof saved.top !== "number") return;
        const next = clampPosition(saved, compact, showDismiss);
        posRef.current = next;
        setPos(next);
      });
    } catch {
      // Storage can be unavailable in tests or during an extension reload.
    }
  }, [compact, initialPosition, showDismiss]);

  useEffect(() => {
    const onViewportResize = () => {
      setSidebarWidth((current) => {
        const next = clampSidebarWidth(current);
        if (next !== current) {
          sidebarWidthRef.current = next;
          try {
            void chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: next });
          } catch {
            // Storage can be unavailable during an extension reload.
          }
        }
        return next;
      });
    };
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, []);

  useEffect(() => {
    if (initialSidebarWidth !== null) return;
    try {
      void chrome.storage.local.get(SIDEBAR_WIDTH_KEY).then((stored) => {
        const savedWidth = stored[SIDEBAR_WIDTH_KEY];
        if (typeof savedWidth === "number") {
          const next = clampSidebarWidth(savedWidth);
          sidebarWidthRef.current = next;
          setSidebarWidth(next);
        }
      });
    } catch {
      // Storage can be unavailable in tests or while Chrome reloads the extension.
    }
  }, [initialSidebarWidth]);

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (isResizing) return;
      const path = event.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (pillContainerRef.current && path.includes(pillContainerRef.current)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [isResizing, open]);

  function handleGripPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragMovedRef.current = false;
    const current = effPos;
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      pillLeft: current.left,
      pillTop: current.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleGripPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;
    if (!dragMovedRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      dragMovedRef.current = true;
      setIsDragging(true);
      setShowDismissMenu(false); // close menu if open during drag
    }
    if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
    const next = clampPosition(
      {
        left: dragStartRef.current.pillLeft + dx,
        top: dragStartRef.current.pillTop + dy,
      },
      compact,
      showDismiss,
    );
    posRef.current = next;
    setPos(next);
  }

  function handleGripPointerUp() {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    setIsDragging(false);
    const current = posRef.current;
    if (dragMovedRef.current && current) {
      // Persist position to extension storage
      try {
        void chrome.storage.local.set({ [PILL_POSITION_KEY]: current });
      } catch {
        // storage unavailable (e.g. extension context invalidated)
      }
    }
  }

  function openSidebar() {
    setShowDismissMenu(false);
    setOpen(true);
  }

  function persistSidebarWidth(width: number) {
    sidebarWidthRef.current = width;
    setSidebarWidth(width);
    try {
      void chrome.storage.local.set({ [SIDEBAR_WIDTH_KEY]: width });
    } catch {
      // Storage can be unavailable during an extension reload.
    }
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = { pointerX: e.clientX, width: sidebarWidth };
    setIsResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizeStartRef.current) return;
    const nextWidth = clampSidebarWidth(resizeStartRef.current.width + resizeStartRef.current.pointerX - e.clientX);
    sidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
  }

  function handleResizePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizeStartRef.current) return;
    resizeStartRef.current = null;
    setIsResizing(false);
    persistSidebarWidth(sidebarWidthRef.current);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const { minimum, maximum } = sidebarWidthBounds();
    const increment = 24;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = sidebarWidth + increment;
    if (e.key === "ArrowRight") next = sidebarWidth - increment;
    if (e.key === "Home") next = minimum;
    if (e.key === "End") next = maximum;
    if (next === null) return;
    e.preventDefault();
    persistSidebarWidth(clampSidebarWidth(next));
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
    if (selectedQuestion && selectedQuestion.bucket !== "generate") {
      setError(
        selectedQuestion.bucket === "confirmation"
          ? "Review and complete this field yourself. JOBSAGE will not generate or select an answer."
          : "This is a structured application field. Complete it on the form; JOBSAGE will not generate an answer.",
      );
      return;
    }
    generate(buildPrompt(question, selectedQuestion), jobContext, selectedQuestion);
  };

  const handleSelectDetected = (dq: DetectedQuestion) => {
    setSelectedId(dq.id);
    setQuestion(dq.question);
    setInserted(false);
    setInsertFailed(false);
    highlightField(dq.id);
    if (dq.bucket !== "generate") {
      setAnswer("");
      setError(
        dq.bucket === "confirmation"
          ? "Review and complete this field yourself. JOBSAGE will not generate or select an answer."
          : "This is a structured application field. Complete it on the form; JOBSAGE will not generate an answer.",
      );
      return;
    }
    generate(buildPrompt(dq.question, dq), jobContext, dq);
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
  // ---------------------------------------------------------------------------
  // Pill (launcher)
  // ---------------------------------------------------------------------------

  const pill = (
    <div
      ref={pillContainerRef}
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
      <div
        onPointerDown={handleGripPointerDown}
        onPointerMove={handleGripPointerMove}
        onPointerUp={handleGripPointerUp}
        onPointerCancel={handleGripPointerUp}
        title="Drag to move JOBSAGE"
        aria-hidden="true"
        style={{
          width: PILL_GRIP_WIDTH,
          minWidth: PILL_GRIP_WIDTH,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.pillBg,
          color: "rgba(255,255,255,0.78)",
          borderRadius: "9999px 0 0 9999px",
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
          fontSize: 13,
          letterSpacing: -2,
          paddingBottom: 1,
        }}
      >
        ⠿
      </div>
      {/* Main toggle button */}
      <button
        onPointerUp={openSidebar}
        onClick={openSidebar}
        title="Open JOBSAGE"
        aria-label="Open JOBSAGE"
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
          // The drag grip owns the left rounding. The button remains a pure,
          // reliably clickable open action.
          borderRadius: showDismiss ? "0" : "0 9999px 9999px 0",
          cursor: "pointer",
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

       {/* Dismiss separator + button — available whenever the launcher is closed */}
        {showDismiss && (
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
              height: pillHeight(compact),
              background: COLORS.pillBg,
              color: "rgba(255,255,255,0.85)",
              border: "none",
              borderRadius: "0 9999px 9999px 0",
              cursor: "pointer",
              fontSize: 17,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </>
      )}

      {/* Dismiss menu popover */}
        {showDismissMenu && showDismiss && (
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
        ref={panelRef}
        role="dialog"
        aria-label="JOBSAGE Copilot"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: sidebarWidth,
          maxWidth: `calc(100vw - ${SIDEBAR_VIEWPORT_GUTTER}px)`,
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
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize JOBSAGE sidebar"
          aria-valuemin={sidebarWidthBounds().minimum}
          aria-valuemax={sidebarWidthBounds().maximum}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          onKeyDown={handleResizeKeyDown}
          title="Drag to resize JOBSAGE"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: -7,
            width: 14,
            cursor: "col-resize",
            touchAction: "none",
            zIndex: 1,
            outline: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: 5,
              width: 3,
              height: 42,
              transform: "translateY(-50%)",
              borderRadius: 99,
              background: isResizing ? COLORS.primary : COLORS.border,
              boxShadow: isResizing ? `0 0 0 2px ${COLORS.inputBg}` : "none",
            }}
          />
        </div>
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
              Applying for {jobContext.jobTitle || "role detected"}
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
              {jobContext.companyName ? `at ${jobContext.companyName}` : ""}
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
              {onClearAnswerMemory && (
                <>
                  <button
                    onClick={() => void handleClearAnswerMemory()}
                    disabled={clearingMemory}
                    style={{
                      padding: 0,
                      alignSelf: "flex-start",
                      background: "none",
                      color: COLORS.textMuted,
                      border: "none",
                      fontSize: 11,
                      cursor: clearingMemory ? "not-allowed" : "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    {clearingMemory ? "Clearing remembered answers…" : "Clear remembered answers for this page"}
                  </button>
                  {memoryClearResult !== null && (
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>
                      {memoryClearResult > 0
                        ? `Cleared ${memoryClearResult} remembered ${memoryClearResult === 1 ? "answer" : "answers"}.`
                        : "No remembered answers were stored for this page."}
                    </div>
                  )}
                </>
              )}
           </section>
            <section
              style={{
                padding: "10px 12px",
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADIUS,
                background: COLORS.inputBg,
                fontSize: 12,
                color: COLORS.textMuted,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: COLORS.text, display: "block", marginBottom: 2 }}>Employer replies</strong>
              Replies sent to your JOBSAGE communication address are saved in your JOBSAGE Messages inbox.
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
                         {dq.bucket !== "generate" && (
                           <span style={{ display: "block", marginTop: 2, fontSize: 11, color: COLORS.errorText }}>
                              {dq.bucket === "confirmation" ? "Complete this yourself" : "Structured field — no AI generation"}
                           </span>
                         )}
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
            onClick={streaming ? () => cancel() : handleGenerate}
            disabled={!streaming && (!question.trim() || selectedQuestion?.bucket !== "generate" && selectedQuestion !== null)}
            style={{
              padding: "9px 16px",
              background: !streaming && (!question.trim() || selectedQuestion?.bucket !== "generate" && selectedQuestion !== null) ? BRAND.primaryDisabled : COLORS.primary,
              color: "#fff",
              border: "none",
              borderRadius: RADIUS,
              fontSize: 13,
              fontWeight: 600,
              cursor: !streaming && (!question.trim() || selectedQuestion?.bucket !== "generate" && selectedQuestion !== null) ? "not-allowed" : "pointer",
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
                Cancel generation
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
              {!streaming && question.trim() && (!selectedQuestion || selectedQuestion.bucket === "generate") && (
                <button
                  onClick={handleGenerate}
                  style={{
                    display: "block",
                    marginTop: 8,
                    padding: "6px 10px",
                    background: "transparent",
                    color: COLORS.errorText,
                    border: `1px solid ${COLORS.errorText}`,
                    borderRadius: RADIUS,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Retry
                </button>
              )}
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
