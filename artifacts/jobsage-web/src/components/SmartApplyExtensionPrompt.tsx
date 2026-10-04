import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui-enhanced";
import { X, Chrome, Download, Sparkles, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { shouldUseAssistedWorkspace } from "@/lib/assistedApplication";

const DISMISS_KEY = "smart-apply-extension-dismissed";
const NUDGE_SHOWN_KEY = "smart-apply-extension-nudge-shown";
// The extension's content script mounts a host element with this id on JOBSAGE pages.
const EXTENSION_MARKER_ID = "jobsage-extension-root";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function setDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // ignore
  }
}

/**
 * Shared state for the Smart Apply extension prompt:
 * - `installed`: the extension's content script marker was found on this page.
 * - `dismissed`: the user has dismissed the prompt before (persisted).
 */
export function useSmartApplyExtension() {
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissedState] = useState(isDismissed);

  useEffect(() => {
    // The content script mounts at document_idle; check a few times before giving up.
    let attempts = 0;
    const check = () => {
      if (document.getElementById(EXTENSION_MARKER_ID)) {
        setInstalled(true);
        return;
      }
      attempts += 1;
      if (attempts < 5) setTimeout(check, 1000);
    };
    check();
  }, []);

  const dismiss = useCallback(() => {
    setDismissed();
    setDismissedState(true);
  }, []);

  return { installed, dismissed, dismiss };
}

/** Synchronous check for the extension's content-script marker element. */
export function isExtensionInstalled(): boolean {
  return !!document.getElementById(EXTENSION_MARKER_ID);
}

async function waitForExtensionMarker(timeoutMs = 4_000): Promise<boolean> {
  if (isExtensionInstalled()) return true;
  const startedAt = Date.now();
  return await new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (isExtensionInstalled()) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

function downloadUrl(): string {
  return `${import.meta.env.BASE_URL}jobsage-smart-apply-extension.zip`;
}

function InstallInstructions() {
  return (
    <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
      <li>
        <a href={downloadUrl()} download className="text-primary font-medium hover:underline inline-flex items-center gap-1">
          Download the extension <Download className="w-3 h-3" />
        </a>{" "}
        and unzip it on your computer.
      </li>
      <li>
        Open <span className="font-mono bg-muted px-1 py-0.5 rounded">chrome://extensions</span> in Chrome and turn on{" "}
        <span className="font-medium text-foreground">Developer mode</span> (top right).
      </li>
      <li>
        Click <span className="font-medium text-foreground">Load unpacked</span> and select the unzipped folder.
      </li>
      <li>That&apos;s it — the JOBSAGE assistant will appear automatically on supported employer sites.</li>
    </ol>
  );
}

/**
 * Dismissible banner for the Opportunities page introducing the Smart Apply
 * Chrome extension. Hidden if previously dismissed or the extension is detected.
 */
export function SmartApplyExtensionBanner() {
  const { installed, dismissed, dismiss } = useSmartApplyExtension();
  const [expanded, setExpanded] = useState(false);

  if (installed || dismissed) return null;

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Chrome className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">Apply faster on employer sites with the Smart Apply extension</p>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-primary/10 text-primary font-semibold uppercase tracking-wide">Free</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Our Chrome assistant follows you to NHS Jobs, Trac and other employer sites — helping you fill in applications
            with your JOBSAGE profile and automatically logging them in your tracker.
          </p>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setExpanded((v) => !v)}>
              <Sparkles className="w-3.5 h-3.5" /> Get the extension
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
            <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={dismiss}>
              No thanks
            </button>
          </div>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 p-3 rounded-xl bg-background border border-border">
                  <p className="text-xs font-semibold text-foreground mb-2">Install in under a minute:</p>
                  <InstallInstructions />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={dismiss}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * One-time floating nudge shown right after a candidate clicks through to an
 * external employer site — the moment the extension is most useful.
 * Call `maybeShowExtensionNudge()` to trigger; renders nothing if the user
 * dismissed the prompt, has the extension, or has already seen the nudge.
 */
export function SmartApplyExtensionNudge({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { installed, dismissed, dismiss } = useSmartApplyExtension();
  const [showInstructions, setShowInstructions] = useState(false);

  if (!open || installed || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-background border border-border rounded-2xl shadow-2xl p-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Chrome className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Applying on an employer site?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The free JOBSAGE Smart Apply extension helps you fill in applications there using your profile — and logs
              them in your tracker automatically.
            </p>
            {!showInstructions ? (
              <div className="mt-2 flex items-center gap-3">
                <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowInstructions(true)}>
                  <Download className="w-3.5 h-3.5" /> Install it
                </Button>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    dismiss();
                    onClose();
                  }}
                >
                  Don&apos;t show again
                </button>
              </div>
            ) : (
              <div className="mt-2">
                <InstallInstructions />
                <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Once installed, this prompt disappears automatically.
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Blocking modal shown when a user tries to apply without the Smart Apply
 * extension installed. Applying requires the extension so every outbound
 * application is tracked in the user's JOBSAGE tracker.
 *
 * `onProceed` is called after a successful re-check (extension detected) so
 * the caller can resume the apply action the user originally intended.
 */
export function ExtensionRequiredModal({
  open,
  onClose,
  onProceed,
}: {
  open: boolean;
  onClose: () => void;
  onProceed?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);

  if (!open) return null;

  async function handleRecheck() {
    setChecking(true);
    setNotFound(false);
    const installed = await waitForExtensionMarker();
    setChecking(false);
    if (installed) {
      onClose();
      onProceed?.();
    } else {
      setNotFound(true);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-md bg-background border border-border rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Chrome className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Install the Smart Apply extension to apply</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          JOBSAGE uses the free Smart Apply Chrome extension to track every application you make — on employer sites,
          job boards, and here on JOBSAGE — so nothing gets lost from your tracker. Applying requires it to be
          installed.
        </p>
        <div className="p-3 rounded-xl bg-muted/40 border border-border mb-4">
          <p className="text-xs font-semibold text-foreground mb-2">Install in under a minute:</p>
          <InstallInstructions />
        </div>
        {notFound && (
          <p className="text-xs text-destructive mb-3">
            We still can&apos;t detect the extension. After installing, refresh this page and try again.
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button className="flex-1 gap-2" onClick={handleRecheck} disabled={checking}>
            <CheckCircle2 className="w-4 h-4" />
            {checking ? "Checking…" : "I've installed it — re-check"}
          </Button>
          <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={onClose}>
            Not now
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Gate hook for apply flows: `requireExtension(action)` runs `action` only if
 * the extension is detected; otherwise it opens the install-required modal and
 * resumes `action` after a successful re-check. Render `gateModal` once.
 */
export function useExtensionGate() {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [gateOpen, setGateOpen] = useState(false);

  const requireExtension = useCallback((action: () => void) => {
    if (isExtensionInstalled() || shouldUseAssistedWorkspace()) {
      action();
    } else {
      setPendingAction(() => action);
      setGateOpen(true);
    }
  }, []);

  const gateModal = (
    <ExtensionRequiredModal
      open={gateOpen}
      onClose={() => setGateOpen(false)}
      onProceed={() => {
        pendingAction?.();
        setPendingAction(null);
      }}
    />
  );

  return { requireExtension, gateModal };
}

/** Returns true if the one-time post-apply nudge should show, marking it as shown. */
export function shouldShowExtensionNudge(): boolean {
  if (shouldUseAssistedWorkspace()) return false;
  try {
    if (localStorage.getItem(DISMISS_KEY) === "1") return false;
    if (localStorage.getItem(NUDGE_SHOWN_KEY) === "1") return false;
    if (document.getElementById(EXTENSION_MARKER_ID)) return false;
    localStorage.setItem(NUDGE_SHOWN_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
