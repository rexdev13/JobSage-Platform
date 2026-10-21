
export type SubmissionSignalSource =
  | "confirmation_url"
  | "confirmation_heading"
  | "success_message";

export interface SubmissionSignal {
  source: SubmissionSignalSource;
}

const CONFIRMATION_RETRY_DELAYS_MS = [200, 500, 1_000];

export async function retryTrackedApplicationConfirmation(
  requestConfirmation: () => Promise<void>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  for (let attempt = 0; attempt <= CONFIRMATION_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await requestConfirmation();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("HTTP 404") || attempt === CONFIRMATION_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await wait(CONFIRMATION_RETRY_DELAYS_MS[attempt]);
    }
  }
}

const CONFIRMATION_URL_PATTERNS = [
  /\/(?:application[-_]?submitted|application[-_]?complete|application\/submitted|apply[-_]?success|apply\/success)(?:\/|$)/i,
];

const CONFIRMATION_TEXT_PATTERNS = [
  /\byour application (?:has been |was )?(?:submitted|received|sent|completed)\b/i,
  /\bapplication (?:submitted|received|sent|complete)\b/i,
  /\bsuccessfully applied\b/i,
  /\bthank you for (?:your )?application\b/i,
  /\bthank you for applying\b/i,
  /\bwe (?:have |have successfully )?received your application\b/i,
  /\byour application has (?:now )?been successfully submitted\b/i,
  /\byou have successfully submitted your application\b/i,
];

function hasConfirmationText(text: string | null | undefined): boolean {
  return (text ?? "").split(/[.!?\n]+/).some((sentence) =>
    !/\b(?:not|never|failed|unsuccessful|once|when|before|until|will be|would be|can be)\b/i.test(sentence)
    && CONFIRMATION_TEXT_PATTERNS.some((pattern) => pattern.test(sentence)),
  );
}

function isVisibleConfirmation(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches("[hidden], [aria-hidden='true'], template, script")) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

/**
 * Return a high-confidence submission signal from the accessible top-level
 * page. We deliberately do not treat a submit click, validation message, or
 * generic "success" text as enough evidence to mark an application applied.
 */
export function detectSubmissionSignal(
  doc: Document = document,
  href: string = location.href,
): SubmissionSignal | null {
  let pathname = "";
  try { pathname = new URL(href).pathname; } catch { /* rely on page evidence */ }
  if (CONFIRMATION_URL_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return { source: "confirmation_url" };
  }

  const headings = Array.from(
    doc.querySelectorAll("h1, h2, h3, [role='heading']"),
  );
  if (headings.some((heading) => isVisibleConfirmation(heading) && hasConfirmationText(heading.textContent))) {
    return { source: "confirmation_heading" };
  }

  const successMessages = Array.from(
    doc.querySelectorAll(
      "[role='alert'], [role='status'], [aria-live='polite'], [aria-live='assertive'], .alert-success, .success, [class*='success' i], [data-automation-id*='success' i]",
    ),
  );
  if (successMessages.some((message) => isVisibleConfirmation(message) && hasConfirmationText(message.textContent))) {
    return { source: "success_message" };
  }

  return null;
}

/**
 * Watches pages that update in place after a form submission (common in ATS
 * wizards). The callback runs at most once and only after a trusted signal
 * appears. Cross-origin frames remain inaccessible by browser design.
 */
export function watchForSubmissionConfirmation(
  onConfirmed: (signal: SubmissionSignal) => void,
  doc: Document = document,
): () => void {
  let completed = false;
  let observer: MutationObserver | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    observer?.disconnect();
    if (interval !== null) clearInterval(interval);
    doc.defaultView?.removeEventListener("pagehide", stop);
    doc.defaultView?.removeEventListener("popstate", evaluate);
  };

  const evaluate = () => {
    if (completed) return;
    const signal = detectSubmissionSignal(doc, doc.location?.href ?? location.href);
    if (!signal) return;
    completed = true;
    stop();
    onConfirmed(signal);
  };

  evaluate();
  if (completed || !doc.documentElement) return () => undefined;

  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  observer = new Observer(evaluate);
  observer.observe(doc.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "class", "style", "role"],
  });
  // pushState/replaceState do not emit popstate and may change no DOM.
  interval = setInterval(evaluate, 1000);
  doc.defaultView?.addEventListener("popstate", evaluate);
  doc.defaultView?.addEventListener("pagehide", stop);
  return stop;
}

export interface AutomaticConfirmationToastCallbacks {
  onConfirm: () => Promise<void>;
}

/**
 * Shows the candidate what happened without requiring a manual "Yes, log it"
 * interaction. The tracker is updated only after the API confirms the
 * matching JOBSAGE-originated click record exists.
 */
