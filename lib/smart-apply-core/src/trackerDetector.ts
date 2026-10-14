
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
  /\/(?:application[-_]?submitted|application[-_]?complete|apply[-_]?success|apply\/success|thank[-_]?you|thankyou)(?:[/?#]|$)/i,
];

const CONFIRMATION_TEXT_PATTERNS = [
  /\byour application (?:has been |was )?(?:submitted|received|sent|completed)\b/i,
  /\bapplication (?:submitted|received|sent|complete)\b/i,
  /\bsuccessfully applied\b/i,
  /\bthank you for (?:your )?application\b/i,
  /\bthank you for applying\b/i,
];

function hasConfirmationText(text: string | null | undefined): boolean {
  return CONFIRMATION_TEXT_PATTERNS.some((pattern) => pattern.test(text ?? ""));
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
  if (CONFIRMATION_URL_PATTERNS.some((pattern) => pattern.test(href))) {
    return { source: "confirmation_url" };
  }

  const headings = Array.from(
    doc.querySelectorAll("h1, h2, h3, [role='heading']"),
  );
  if (headings.some((heading) => hasConfirmationText(heading.textContent))) {
    return { source: "confirmation_heading" };
  }

  const successMessages = Array.from(
    doc.querySelectorAll(
      "[role='alert'], [role='status'], .alert-success, .success, [class*='success' i], [data-automation-id*='success' i]",
    ),
  );
  if (successMessages.some((message) => hasConfirmationText(message.textContent))) {
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

  const evaluate = () => {
    if (completed) return;
    const signal = detectSubmissionSignal(doc);
    if (!signal) return;
    completed = true;
    observer?.disconnect();
    onConfirmed(signal);
  };

  evaluate();
  if (completed || !doc.documentElement) return () => undefined;

  observer = new MutationObserver(evaluate);
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  return () => observer?.disconnect();
}

export interface AutomaticConfirmationToastCallbacks {
  onConfirm: () => Promise<void>;
}

/**
 * Shows the candidate what happened without requiring a manual "Yes, log it"
 * interaction. The tracker is updated only after the API confirms the
 * matching JOBSAGE-originated click record exists.
 */
