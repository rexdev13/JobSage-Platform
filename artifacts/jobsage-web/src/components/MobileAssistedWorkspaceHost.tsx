import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/auth-web";
import {
  useGetMyProfile,
  useGetSmartApplyCandidatePrefill,
  getGetMyProfileQueryKey,
  getGetSmartApplyCandidatePrefillQueryKey,
} from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { refreshApplicationQueries } from "@/lib/applicationQueryRefresh";
import { readDesktopApplicationState } from "@/lib/desktopApplicationReturn";
import {
  ASSISTED_APPLICATION_EVENT,
  beginAssistedApplication,
  confirmAssistedApplication,
  shouldUseAssistedWorkspace,
  type AssistedApplicationEvent,
} from "@/lib/assistedApplication";

const ADVANCED_OK = new Set(["in_progress", "link_clicked"]);
const EXTENSION_CONFIRMATION_GRACE_MS = [300, 700, 1200] as const;

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MobileAssistedWorkspaceHost() {
  const { user } = useAuth();
  const userId = (user as { id?: string } | null | undefined)?.id ?? null;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [ev, setEv] = useState<AssistedApplicationEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pin, setPin] = useState("");
  const [fallback, setFallback] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [stmtError, setStmtError] = useState<string | null>(null);
  const [stmtNote, setStmtNote] = useState<string | null>(null);
  const [stmtPending, setStmtPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const armed = useRef(false);
  const departed = useRef(false);
  const returned = useRef(false);
  const evRef = useRef<AssistedApplicationEvent | null>(null);
  const doneRef = useRef(false);
  const extensionPresentRef = useRef(false);
  const returnGeneration = useRef(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  evRef.current = ev;
  doneRef.current = done;

  const ready = ev?.phase === "ready" && ev.source !== "desktop-outbound";

  const evaluatePrompt = useCallback(() => {
    const cur = evRef.current;
    if (!armed.current || !returned.current || doneRef.current) return;
    if (cur?.phase !== "ready") return;
    const status = cur.application?.status;
    if (status && !ADVANCED_OK.has(status)) return;
    returned.current = false;
    setPrompt(true);
  }, []);

  const reset = useCallback(() => {
    returnGeneration.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStmtPending(false);
    armed.current = false;
    departed.current = false;
    returned.current = false;
    setEv(null);
    setOpen(false);
    setPrompt(false);
    setDone(false);
    setConfirmError(null);
    setPin("");
    setFallback(null);
    setStatement("");
    setStmtError(null);
    setStmtNote(null);
  }, []);

  // Global session listeners
  useEffect(() => {
    async function waitForExtensionConfirmation(applicationUrl: string, generation: number): Promise<void> {
      let state: Awaited<ReturnType<typeof readDesktopApplicationState>> = "not-found";
      for (const delay of [0, ...(extensionPresentRef.current ? EXTENSION_CONFIRMATION_GRACE_MS : [300])]) {
        if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
        if (generation !== returnGeneration.current) return;
        try {
          state = await readDesktopApplicationState(applicationUrl);
        } catch {
          // The user can still confirm; the confirmation endpoint refuses to create
          // a record and reports a retryable error if this click wasn't persisted.
          state = "not-found";
          break;
        }
        if (state === "confirmed") {
          const current = evRef.current;
          if (current?.source === "desktop-outbound" && current.applicationUrl === applicationUrl) {
            const confirmed: AssistedApplicationEvent = {
              ...current,
              application: { ...current.application!, status: "applied" },
            };
            evRef.current = confirmed;
            setEv(confirmed);
            armed.current = false;
            setDone(true);
            void refreshApplicationQueries(queryClient);
          }
          return;
        }
      }
      if (generation !== returnGeneration.current) return;
      const current = evRef.current;
      if (current?.source !== "desktop-outbound" || current.applicationUrl !== applicationUrl) return;
      returned.current = true;
      evaluatePrompt();
    }

    function onDesktopOutbound(e: Event) {
      if (shouldUseAssistedWorkspace()) return;
      const detail = (e as CustomEvent<{
        applicationUrl?: unknown;
        roleId?: unknown;
        jobTitle?: unknown;
        employer?: unknown;
      }>).detail;
      if (
        typeof detail?.applicationUrl !== "string" ||
        typeof detail.roleId !== "number" ||
        detail.roleId <= 0 ||
        typeof detail.jobTitle !== "string" ||
        !detail.jobTitle.trim() ||
        typeof detail.employer !== "string" ||
        !detail.employer.trim()
      ) return;

      returnGeneration.current += 1;
      const next: AssistedApplicationEvent = {
        applicationUrl: detail.applicationUrl,
        source: "desktop-outbound",
        phase: "ready",
        vacancy: { roleId: detail.roleId, title: detail.jobTitle, employer: detail.employer },
        application: { id: 0, status: "link_clicked", appliedAt: new Date().toISOString() },
      };
      extensionPresentRef.current = !!document.getElementById("jobsage-extension-root");
      armed.current = true;
      departed.current = document.visibilityState === "hidden" || !document.hasFocus();
      returned.current = false;
      setDone(false);
      setPrompt(false);
      setConfirmError(null);
      evRef.current = next;
      setEv(next);
      setOpen(false);
    }

    function onEvent(e: Event) {
      const d = (e as CustomEvent<AssistedApplicationEvent>).detail;
      if (!d) return;
      if (d.source === "desktop-outbound") return;
      const prev = evRef.current;
      if (d.phase !== "saving" && prev && prev.applicationUrl !== d.applicationUrl) return;
      const sameApp = prev?.applicationUrl === d.applicationUrl;
      if (d.phase === "saving") {
        armed.current = true;
        departed.current = document.visibilityState === "hidden" || !document.hasFocus();
        returned.current = false;
        setDone(false);
        setPrompt(false);
        setConfirmError(null);
        if (!sameApp) {
          abortRef.current?.abort();
          abortRef.current = null;
          setStmtPending(false);
          setStatement("");
          setStmtError(null);
          setStmtNote(null);
        }
        setOpen(true);
      }
      if (d.phase === "error") {
        armed.current = false;
        setOpen(true);
      }
      setEv(d);
      evRef.current = d;
      if (d.phase === "ready") {
        void refreshApplicationQueries(queryClient);
        evaluatePrompt();
      }
    }
    function leave() {
      if (armed.current) departed.current = true;
    }
    function back() {
      if (document.visibilityState === "hidden") return;
      if (armed.current && departed.current) {
        departed.current = false;
        returned.current = true;
        const current = evRef.current;
        if (current?.source === "desktop-outbound") {
          returned.current = false;
          void waitForExtensionConfirmation(current.applicationUrl, returnGeneration.current);
        } else {
          evaluatePrompt();
        }
      }
    }
    function onVis() {
      if (document.visibilityState === "hidden") leave();
      else back();
    }
    // Some mobile browsers coalesce focus/visibility events around tab launch.
    // Observe the actual state too, and support Safari's resumed-page event.
    const pollFocus = window.setInterval(() => {
      if (!armed.current) return;
      if (document.visibilityState === "hidden" || !document.hasFocus()) leave();
      else back();
    }, 500);
    window.addEventListener(ASSISTED_APPLICATION_EVENT, onEvent);
    window.addEventListener("jobsage:outbound-application", onDesktopOutbound);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    window.addEventListener("pageshow", back);
    return () => {
      window.removeEventListener(ASSISTED_APPLICATION_EVENT, onEvent);
      window.removeEventListener("jobsage:outbound-application", onDesktopOutbound);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      window.removeEventListener("pageshow", back);
      window.clearInterval(pollFocus);
    };
  }, [evaluatePrompt, queryClient]);

  // Reset on auth user change
  const lastUser = useRef(userId);
  useEffect(() => {
    if (lastUser.current !== userId) {
      lastUser.current = userId;
      reset();
    }
  }, [userId, reset]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !prompt) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prompt]);

  const profileQ = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey(), enabled: ready && !!userId },
  });
  const prefillQ = useGetSmartApplyCandidatePrefill({
    query: { queryKey: getGetSmartApplyCandidatePrefillQueryKey(), enabled: ready && !!userId },
  });
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  async function copy(label: string, text: string) {
    if (!text) return;
    if (await writeClipboard(text)) {
      setFallback(null);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
    } else {
      setFallback(text);
      toast({ title: "Copy blocked", description: "Select the text shown below and copy it manually.", variant: "destructive" });
    }
  }

  async function markApplied() {
    if (!ev) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await confirmAssistedApplication(ev.applicationUrl);
      await refreshApplicationQueries(queryClient);
      setDone(true);
      armed.current = false;
      setPrompt(false);
      toast({ title: "Marked as applied", description: `${ev.vacancy.title} at ${ev.vacancy.employer} is now tracked as applied.` });
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Could not confirm. Please retry.");
    } finally {
      setConfirming(false);
    }
  }

  async function retry() {
    if (!ev) return;
    setRetrying(true);
    try {
      await beginAssistedApplication(ev.applicationUrl, ev.vacancy);
    } catch (e) {
      setEv({ ...ev, phase: "error", error: e instanceof Error ? e.message : "Could not retry." });
    } finally {
      setRetrying(false);
    }
  }

  async function runGenerate() {
    if (!ev || !ready || stmtPending) return;
    const { roleId, title, employer } = ev.vacancy;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStmtError(null);
    setStmtNote(null);
    setStatement("");
    setStmtPending(true);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    let acc = "";
    let finished = false;
    try {
      const resp = await fetch(`${base}/api/smart-apply/assistant`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          ...(roleId ? { roleId } : {}),
          jobTitle: title,
          employer,
          message: `Write a coherent supporting statement of 300 to 400 words tailored to the ${title} role at ${employer}. Use only facts known from my profile and CV. Do not invent qualifications, employers, dates or achievements; leave out anything you do not know.`,
          questionText: "Supporting statement",
          wordLimit: 400,
        }),
      });
      if (!resp.ok || !resp.body) throw new Error("Could not generate the statement. Please try again.");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (line: string) => {
        if (!line.startsWith("data: ")) return;
        let p: { text?: string; done?: boolean; error?: string; disclaimer?: string };
        try { p = JSON.parse(line.slice(6)); } catch { return; }
        if (p.error) throw new Error(p.error);
        if (p.text) {
          acc += p.text;
          if (!ctrl.signal.aborted) setStatement(acc);
        }
        if (p.done) {
          finished = true;
          if (p.disclaimer && !ctrl.signal.aborted) setStmtNote(p.disclaimer);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handle);
      }
      buffer += decoder.decode();
      if (buffer) buffer.split("\n").forEach(handle);
      if (ctrl.signal.aborted) return;
      if (!finished) throw new Error(acc ? "The statement stream ended early and may be incomplete. Review it or regenerate." : "The statement stream closed before any text arrived. Please retry.");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setStmtError(e instanceof Error ? e.message : "Could not generate the statement.");
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setStmtPending(false);
      }
    }
  }

  const profile = profileQ.data;
  const cand = prefillQ.data;
  const qual = [profile?.qualificationType, profile?.qualificationYear, profile?.qualificationCountry].filter(Boolean).join(", ");
  const regLabel = profile?.registrationStatus ? profile.registrationStatus.replace(/_/g, " ") : "";
  const chips: { label: string; value: string }[] = [
    { label: "Name", value: cand?.fullName ?? "" },
    { label: "Email alias", value: cand?.email ?? "" },
    { label: "Phone", value: profile?.phone ?? "" },
    { label: "Registration", value: regLabel },
    { label: "Qualification", value: qual },
  ].filter((c) => c.value);

  const label = ev ? `${ev.vacancy.title} at ${ev.vacancy.employer}` : "";
  const desktopReturnPrompt = ev?.source === "desktop-assisted" || ev?.source === "desktop-outbound";

  const ui = (
    <>
      <AnimatePresence>
        {open && ev && (
          <motion.div
            key="wk-overlay"
            className="fixed inset-0 z-[60] flex items-end justify-center bg-foreground/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="assisted-title"
              data-testid="drawer-assisted-workspace"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-lg"
            >
              <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div className="min-w-0">
                  <h2 id="assisted-title" className="text-base font-bold text-foreground">Smart Apply workspace</h2>
                  <p className="truncate text-xs text-muted-foreground">{label}</p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close workspace"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  data-testid="button-close-workspace"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {ev.phase === "saving" && (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4" role="status">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Saving your application</p>
                      <p className="text-xs text-muted-foreground">The employer page opens once tracking is saved.</p>
                    </div>
                  </div>
                )}

                {ev.phase === "error" && (
                  <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/20" role="alert">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      <p className="text-sm text-rose-800 dark:text-rose-300">{ev.error ?? "Could not save your application."}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void retry()}
                      disabled={retrying}
                      className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      data-testid="button-retry-assisted"
                    >
                      {retrying ? "Retrying…" : "Retry"}
                    </button>
                  </div>
                )}

                {ready && (
                  <>
                    <div className={`flex items-start gap-2 rounded-xl border p-3 ${done ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10" : "border-amber-200 bg-amber-50 dark:bg-amber-900/10"}`}>
                      <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${done ? "text-emerald-600" : "text-amber-700"}`} />
                      <p className="text-sm text-foreground" data-testid="text-tracked-status">
                        {done || (ev.application?.status && !ADVANCED_OK.has(ev.application.status))
                          ? "Marked as applied in your tracker."
                          : "Tracked as in progress. It stays in progress until you confirm you submitted."}
                      </p>
                    </div>

                    <a
                      href={ev.applicationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                      data-testid="link-external-form"
                    >
                      <ExternalLink className="h-4 w-4" /> Open employer application form
                    </a>

                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Quick copy from your profile</h3>
                      {(profileQ.isLoading || prefillQ.isLoading) && <p className="text-xs text-muted-foreground">Loading your profile…</p>}
                      {(profileQ.isError || prefillQ.isError) && (
                        <p className="text-xs text-rose-700">
                          Could not load some profile details.{" "}
                          <button type="button" className="underline" onClick={() => { void profileQ.refetch(); void prefillQ.refetch(); }}>Retry</button>
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {chips.map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => void copy(c.label, c.value)}
                            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 text-left text-xs hover:bg-muted"
                            data-testid={`chip-${c.label.toLowerCase().replace(/\s+/g, "-")}`}
                          >
                            <Copy className="h-3 w-3 shrink-0 text-primary" />
                            <span className="min-w-0 truncate"><span className="font-semibold">{c.label}:</span> {c.value}</span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-3">
                        <label htmlFor="assisted-pin" className="mb-1 block text-xs font-medium text-foreground">
                          NMC/GMC PIN (optional, not stored)
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="assisted-pin"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            autoComplete="off"
                            placeholder="Enter your own PIN"
                            className="field-support flex-1"
                            data-testid="input-pin"
                          />
                          <button
                            type="button"
                            disabled={!pin.trim()}
                            onClick={() => void copy("PIN", pin.trim())}
                            className="min-h-11 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-50"
                            data-testid="button-copy-pin"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">Kept only in this open page. It is cleared when you leave or sign out.</p>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-foreground">Tailored supporting statement</h3>
                      {!statement && (
                        <button
                          type="button"
                          onClick={() => void runGenerate()}
                          disabled={stmtPending}
                          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 text-sm font-semibold text-primary disabled:opacity-60"
                          data-testid="button-generate-statement"
                        >
                          {stmtPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          {stmtPending ? "Generating…" : stmtError ? "Retry generate statement" : "Generate statement"}
                        </button>
                      )}
                      {stmtError && <p className="text-xs text-rose-700" role="alert">{stmtError}</p>}
                      {statement && (
                        <>
                          {stmtPending && <p className="text-xs text-muted-foreground" role="status">Writing your statement…</p>}
                          <p className="text-xs text-muted-foreground">{stmtNote ? `${stmtNote} ` : ""}AI drafted from your profile and CV: review for accuracy before you paste it.</p>
                          <textarea
                            value={statement}
                            onChange={(e) => setStatement(e.target.value)}
                            aria-label="Supporting statement"
                            className="field-support min-h-48 w-full resize-y"
                            data-testid="textarea-statement"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void copy("Statement", statement)}
                              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                              data-testid="button-copy-statement"
                            >
                              <Copy className="h-4 w-4" /> Copy to Clipboard
                            </button>
                            <button
                              type="button"
                              onClick={() => void runGenerate()}
                              disabled={stmtPending}
                              className="min-h-11 rounded-xl border border-border px-3 text-sm font-semibold disabled:opacity-60"
                            >
                              Regenerate
                            </button>
                          </div>
                        </>
                      )}
                    </section>

                    {fallback && (
                      <div className="space-y-1 rounded-xl border border-border bg-muted/40 p-3">
                        <p className="text-xs font-semibold text-foreground">Copy manually</p>
                        <textarea
                          readOnly
                          value={fallback}
                          onFocus={(e) => e.currentTarget.select()}
                          aria-label="Text to copy manually"
                          className="field-support min-h-24 w-full"
                          data-testid="textarea-clipboard-fallback"
                        />
                      </div>
                    )}

                    {!done && ADVANCED_OK.has(ev.application?.status ?? "in_progress") && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setPrompt(true)}
                          className="min-h-11 w-full rounded-xl border border-primary/30 px-4 text-sm font-semibold text-primary"
                          data-testid="button-review-submission-status"
                        >
                          Confirm my submission status
                        </button>
                        <p className="text-[11px] text-muted-foreground">
                          JobSage cannot see what happens on the employer site. We will ask when you return; you can also confirm here if your browser misses the return event.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {prompt && ev && (
          <motion.div
            key="wk-prompt"
            className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/50 p-3 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="assisted-prompt-title"
              data-testid="dialog-confirm-submitted"
              initial={{ y: 24 }}
              animate={{ y: 0 }}
              exit={{ y: 24 }}
              className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-background p-5 shadow-lg"
            >
              <h2 id="assisted-prompt-title" className="text-base font-bold text-foreground">
                Did you submit your application for {ev.vacancy.title} at {ev.vacancy.employer}?
              </h2>
              {confirmError && <p className="text-xs text-rose-700" role="alert">{confirmError}</p>}
              <button
                type="button"
                autoFocus
                disabled={confirming}
                onClick={() => void markApplied()}
                className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                data-testid="button-yes-applied"
              >
                {confirming ? "Saving…" : confirmError ? "Retry: Yes, Mark as Applied" : "Yes, Mark as Applied"}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={confirming}
                  onClick={() => { setPrompt(false); setConfirmError(null); }}
                  className="min-h-11 rounded-xl border border-border px-3 text-sm font-semibold"
                  data-testid="button-still-in-progress"
                >
                  {desktopReturnPrompt ? "Still Applying" : "Still in Progress"}
                </button>
                {!desktopReturnPrompt && (
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={() => { setPrompt(false); setConfirmError(null); }}
                    className="min-h-11 rounded-xl border border-border px-3 text-sm font-semibold"
                    data-testid="button-remind-later"
                  >
                    Remind Me Later
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(ui, document.body);
}

export default MobileAssistedWorkspaceHost;
