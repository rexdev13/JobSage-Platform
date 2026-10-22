import type { QuestionWatcher } from "./questionDetector";
import { isConfidentAuthenticatedAccountPage, prefillCandidateEmail } from "./prefill";
import { hasApplicationForm } from "./scraper";

/**
 * Follow multi-step application forms without rerunning CV/AI mapping.
 * Each actual DOM control is handled once, so candidate edits are not fought.
 * The alias stays in page memory only and never comes from the ATS itself.
 */
export function startAutomaticEmailPrefill(
  watcher: QuestionWatcher,
  loadEmail: () => Promise<string | null>,
  doc: Document = document,
): () => void {
  const handled = new WeakSet<Element>();
  let alias: string | null = null;
  let running = false;
  let pending = false;
  let stopped = false;

  const scan = async () => {
    if (stopped) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        alias = alias ?? await loadEmail();
        if (stopped || !alias) break;
        prefillCandidateEmail(alias, doc, {
          preserveExistingEmail: !hasApplicationForm()
            && isConfidentAuthenticatedAccountPage(doc, doc.location?.href ?? ""),
          shouldFill(field) {
            if (handled.has(field)) return false;
            handled.add(field);
            return true;
          },
        });
      } while (pending && !stopped);
    } catch {
      // The existing manual profile fill reports connection/auth failures.
      // A subsequent form-step notification can retry; never spin or log PII.
    } finally {
      running = false;
    }
  };
  const unsubscribe = watcher.subscribe(() => { void scan(); });
  void scan();
  return () => {
    stopped = true;
    unsubscribe();
    alias = null;
  };
}
