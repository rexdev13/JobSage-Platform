import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui-enhanced";
import { X, Chrome, Download, Sparkles, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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

/** Returns true if the one-time post-apply nudge should show, marking it as shown. */
export function shouldShowExtensionNudge(): boolean {
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
