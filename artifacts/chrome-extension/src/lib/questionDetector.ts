/**
 * Detects free-text application questions on ATS form pages (NHS Jobs, Trac,
 * Workday and generic sites) so the sidebar can list them and write generated
 * answers back into the right field.
 */

export interface DetectedQuestion {
  /** Stable identity for the field across re-scans. */
  id: string;
  /** The resolved question text shown to the candidate. */
  question: string;
  /** Declared character limit (maxlength), if any. */
  maxLength?: number;
  /** Word limit parsed from nearby hint text ("max 250 words"), if any. */
  wordLimit?: number;
}

type QuestionField = HTMLTextAreaElement | HTMLInputElement;

const FIELD_ID_ATTR = "data-jobsage-qid";
let idCounter = 0;

/** Registry of detected fields so answers can be inserted later. */
const fieldRegistry = new Map<string, WeakRef<QuestionField>>();

// ---------------------------------------------------------------------------
// Filtering heuristics
// ---------------------------------------------------------------------------

/** name/id/autocomplete patterns that mark personal-detail (non-question) fields. */
const PERSONAL_FIELD_PATTERN =
  /\b(first[-_ ]?name|last[-_ ]?name|full[-_ ]?name|surname|forename|middle[-_ ]?name|email|e-mail|phone|tel(ephone)?|mobile|postcode|post[-_ ]?code|zip|address|city|town|county|country|dob|date[-_ ]?of[-_ ]?birth|birth|nationality|ni[-_ ]?number|national[-_ ]?insurance|passport|reference[-_ ]?number|salary|username|password|search|url|website|linkedin|twitter)\b/i;

const PERSONAL_AUTOCOMPLETE = new Set([
  "name", "given-name", "family-name", "additional-name", "honorific-prefix",
  "honorific-suffix", "nickname", "email", "username", "new-password",
  "current-password", "tel", "tel-national", "street-address", "address-line1",
  "address-line2", "address-line3", "address-level1", "address-level2",
  "postal-code", "country", "country-name", "bday", "bday-day", "bday-month",
  "bday-year", "organization", "organization-title", "url",
]);

/** Words that strongly suggest an essay/free-text question. */
const QUESTION_KEYWORD_PATTERN =
  /\b(describe|explain|tell us|tell me|why|how (do|did|would|have)|what (do|did|would|is|are|was|were|makes|motivates)|experience|example|demonstrate|evidence|outline|discuss|supporting (information|statement)|personal statement|statement in support|cover(ing)? letter|motivation|skills? and (experience|knowledge)|suitability|strengths?|achievements?|contribute|situation (where|in which)|time (when|you))\b/i;

/**
 * Long-form fields are named differently by each ATS and frequently do not
 * include a question mark or an essay keyword in their label. Keep these
 * selectors deliberately narrow: they are only enabled on the matching host,
 * and never weaken the generic personal-field exclusions.
 */
export const DEDICATED_SITE_SELECTORS = {
  nhsJobs: [
    "[id*='supporting' i]",
    "[name*='supporting' i]",
    "[id*='personal-statement' i]",
    "[name*='personal_statement' i]",
    "[data-test*='supporting' i]",
    "textarea[id*='statement' i]",
  ],
  trac: [
    "[id*='supporting' i]",
    "[name*='supporting' i]",
    "[id*='personal-statement' i]",
    "[name*='personal_statement' i]",
    "[id*='application-question' i]",
    "[name*='application-question' i]",
    "textarea[id^='question' i]",
    "textarea[name^='question' i]",
  ],
  workday: [
    "[data-automation-id*='question' i]",
    "[data-automation-id*='longtext' i]",
    "[data-automation-id*='long-text' i]",
    "[data-automation-id*='supporting' i]",
    "[data-automation-id*='statement' i]",
  ],
} as const;

function dedicatedSiteForHost(hostname: string): keyof typeof DEDICATED_SITE_SELECTORS | null {
  const host = hostname.toLowerCase();
  if (host.includes("trac.jobs")) return "trac";
  if (host.includes("jobs.nhs") || host.includes("nhsjobs")) return "nhsJobs";
  if (host.includes("myworkdayjobs") || host.includes("workdayjobs") || host.includes("workday.com")) return "workday";
  return null;
}

function isDedicatedField(field: QuestionField, hostname: string): boolean {
  const site = dedicatedSiteForHost(hostname);
  if (!site) return false;
  return DEDICATED_SITE_SELECTORS[site].some((selector) => {
    try {
      return field.matches(selector) || !!field.closest(selector);
    } catch {
      return false;
    }
  });
}

function isVisible(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  // jsdom reports 0 rects for everything; only trust rect checks when layout exists.
  if (typeof el.getClientRects === "function") {
    const rects = el.getClientRects();
    const doc = el.ownerDocument;
    const hasLayout = doc.body && doc.body.getClientRects().length > 0;
    if (hasLayout && rects.length === 0) return false;
  }
  return true;
}

function isTextArea(el: Element): el is HTMLTextAreaElement {
  return el.tagName === "TEXTAREA";
}

function isCandidateField(el: Element): el is QuestionField {
  if (isTextArea(el)) {
    if (el.disabled || el.readOnly) return false;
    return isVisible(el);
  }
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    if (input.disabled || input.readOnly) return false;
    if (input.type !== "text") return false;
    const el2 = input;
    // Only "long" text inputs qualify (essay-style single-line is rare).
    const maxLen = el2.maxLength > 0 ? el2.maxLength : undefined;
    const size = el2.size > 0 ? el2.size : undefined;
    const long = (maxLen !== undefined && maxLen >= 200) || (size !== undefined && size >= 60);
    if (!long) return false;
    return isVisible(el2);
  }
  return false;
}

function isPersonalField(field: QuestionField): boolean {
  const meta = `${field.name} ${field.id} ${field.getAttribute("data-automation-id") ?? ""}`;
  if (PERSONAL_FIELD_PATTERN.test(meta)) return true;
  const auto = field.getAttribute("autocomplete")?.toLowerCase().trim();
  if (auto && PERSONAL_AUTOCOMPLETE.has(auto)) return true;
  return false;
}

/** Does this text read like a genuine free-text question? */
function isQuestionLike(text: string, field: QuestionField): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (PERSONAL_FIELD_PATTERN.test(t) && t.length < 40) return false;
  if (QUESTION_KEYWORD_PATTERN.test(t)) return true;
  if (t.endsWith("?")) return true;
  // Long labels on textareas are almost always essay prompts.
  if (isTextArea(field) && t.length >= 25) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Label / question-text resolution
// ---------------------------------------------------------------------------

function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
}

function resolveQuestionText(field: QuestionField): string {
  const doc = field.ownerDocument;

  // 1. <label for="...">
  if (field.id) {
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(field.id)
        : field.id.replace(/["\\]/g, "\\$&");
    const label = doc.querySelector(`label[for="${escaped}"]`);
    const t = cleanText(label?.textContent);
    if (t) return t;
  }

  // 2. Wrapping <label>
  const wrapping = field.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, textarea, select").forEach((e) => e.remove());
    const t = cleanText(clone.textContent);
    if (t) return t;
  }

  // 3. aria-labelledby
  const labelledBy = field.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = cleanText(
      labelledBy
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? "")
        .join(" ")
    );
    if (t) return t;
  }

  // 4. aria-label
  const ariaLabel = cleanText(field.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  // 5. Workday: label inside the same data-automation-id container
  const wdContainer = field.closest("[data-automation-id]");
  if (wdContainer) {
    const wdLabel = wdContainer.querySelector("label, [data-automation-id*='label' i], legend");
    const t = cleanText(wdLabel?.textContent);
    if (t) return t;
  }

  // 6. Fieldset legend
  const legend = field.closest("fieldset")?.querySelector("legend");
  const legendText = cleanText(legend?.textContent);
  if (legendText) return legendText;

  // 7. Nearest preceding heading/paragraph/label within the form group
  const group = field.closest("div, li, td, section, fieldset");
  if (group) {
    const candidates = Array.from(
      group.querySelectorAll("h1, h2, h3, h4, h5, h6, p, label, legend, span[class*='label' i]")
    ).filter(
      (el) =>
        !el.contains(field) &&
        field.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
    );
    for (let i = candidates.length - 1; i >= 0; i--) {
      const t = cleanText(candidates[i].textContent);
      if (t.length >= 4) return t;
    }
  }

  // 8. Preceding sibling walk (generic forms without grouping wrappers)
  let node: Element | null = field.parentElement;
  let hops = 0;
  while (node && hops < 4) {
    let sib: Element | null = (hops === 0 ? field : node).previousElementSibling;
    while (sib) {
      if (/^(H[1-6]|P|LABEL|LEGEND|DIV|SPAN)$/.test(sib.tagName)) {
        const t = cleanText(sib.textContent);
        if (t.length >= 4 && t.length <= 500) return t;
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
    hops++;
  }

  // 9. Placeholder as last resort
  return cleanText(field.getAttribute("placeholder"));
}

function dedicatedQuestionText(field: QuestionField): string {
  const text = cleanText(
    field.getAttribute("aria-label") ||
      field.getAttribute("placeholder") ||
      field.name ||
      field.id,
  );
  if (!text) return "Supporting statement";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b(textarea|longtext|long text|answer|response)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || "Supporting statement";
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

function resolveWordLimit(field: QuestionField): number | undefined {
  const group = field.closest("div, li, fieldset, section");
  const text = cleanText(group?.textContent).slice(0, 2000);
  const m =
    text.match(/(?:max(?:imum)?|up to|limit(?:ed)? (?:to|of)|no more than)\s*(?:of\s*)?(\d{2,5})\s*words/i) ??
    text.match(/(\d{2,5})\s*[-\s]*word\s*(?:limit|max(?:imum)?|count)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 10 && n <= 10000) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function ensureId(field: QuestionField): string {
  let id = field.getAttribute(FIELD_ID_ATTR);
  if (!id) {
    id = `jsq-${++idCounter}`;
    field.setAttribute(FIELD_ID_ATTR, id);
  }
  fieldRegistry.set(id, new WeakRef(field));
  return id;
}

function scanRoot(root: Document | Element, hostname: string): DetectedQuestion[] {
  const results: DetectedQuestion[] = [];
  const fields = Array.from(root.querySelectorAll("textarea, input[type='text'], input:not([type])"));

  for (const el of fields) {
    if (!isCandidateField(el)) continue;
    const field = el;
    if (isPersonalField(field)) continue;

    const dedicated = isDedicatedField(field, hostname);
    const question = resolveQuestionText(field) || (dedicated ? dedicatedQuestionText(field) : "");
    if (!question || (!dedicated && !isQuestionLike(question, field))) continue;

    const maxLength = field.maxLength > 0 ? field.maxLength : undefined;
    results.push({
      id: ensureId(field),
      question: question.length > 300 ? `${question.slice(0, 300)}…` : question,
      maxLength,
      wordLimit: resolveWordLimit(field),
    });
  }
  return results;
}

/**
 * Detect free-text application questions in the document and any accessible
 * same-origin iframes. Cross-origin frames are skipped silently.
 */
export function detectQuestions(doc: Document = document, hostname = doc.location?.hostname ?? ""): DetectedQuestion[] {
  const results = scanRoot(doc, hostname);

  for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      const innerDoc = iframe.contentDocument;
      if (innerDoc?.body) results.push(...scanRoot(innerDoc, innerDoc.location?.hostname ?? hostname));
    } catch {
      // Cross-origin — browser security prevents access; skip.
    }
  }

  // De-duplicate by question text (repeated hidden clones etc.) keeping first.
  const seen = new Set<string>();
  return results.filter((q) => {
    const key = q.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Write an answer into the originating field, dispatching the events React /
 * Angular ATS forms need to register the change. Returns false if the field
 * is no longer on the page.
 */
export function insertAnswer(questionId: string, answer: string): boolean {
  const field = fieldRegistry.get(questionId)?.deref();
  if (!field || !field.isConnected) return false;

  const proto =
    isTextArea(field)
      ? (field.ownerDocument.defaultView ?? window).HTMLTextAreaElement.prototype
      : (field.ownerDocument.defaultView ?? window).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(field, answer);
  } else {
    field.value = answer;
  }

  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  field.focus?.();
  return true;
}

/** Scroll the field into view and briefly highlight it. */
export function highlightField(questionId: string): void {
  const field = fieldRegistry.get(questionId)?.deref();
  if (!field || !field.isConnected) return;
  field.scrollIntoView?.({ behavior: "smooth", block: "center" });
  const prev = field.style.outline;
  field.style.outline = "2px solid #1a56db";
  setTimeout(() => {
    field.style.outline = prev;
  }, 1600);
}

// ---------------------------------------------------------------------------
// Live re-scanning
// ---------------------------------------------------------------------------

export interface QuestionWatcher {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DetectedQuestion[];
  stop(): void;
}

function sameQuestions(a: DetectedQuestion[], b: DetectedQuestion[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (q, i) =>
      q.id === b[i].id &&
      q.question === b[i].question &&
      q.maxLength === b[i].maxLength &&
      q.wordLimit === b[i].wordLimit
  );
}

/**
 * Watch the page with a debounced MutationObserver so the detected-question
 * list stays current on multi-step wizards and SPA navigation. Listeners are
 * only notified when the list actually changes (no flicker).
 */
export function createQuestionWatcher(doc: Document = document): QuestionWatcher {
  let snapshot = detectQuestions(doc);
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const rescan = () => {
    timer = null;
    const next = detectQuestions(doc);
    if (!sameQuestions(snapshot, next)) {
      snapshot = next;
      listeners.forEach((l) => l());
    }
  };

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations caused solely by our own id-stamping attribute.
    if (mutations.every((m) => m.type === "attributes" && m.attributeName === FIELD_ID_ATTR)) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(rescan, 400);
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "disabled", "style", "class", "aria-hidden"],
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    stop() {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    },
  };
}
