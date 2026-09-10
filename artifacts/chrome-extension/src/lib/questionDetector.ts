/**
 * Detects free-text application questions on ATS form pages (NHS Jobs, Trac,
 * Workday and generic sites) so the sidebar can list them and write generated
 * answers back into the right field.
 */
import { isPinpointPage, isWorkdayHostname } from "./scraper";
import { runExtensionFieldWrite } from "./fieldWriteProvenance";

export type QuestionBucket = "generate" | "structured" | "confirmation";
export type RequiredSource =
  | "dom"
  | "aria"
  | "label"
  | "hint"
  | "group"
  | "api"
  | "heuristic"
  | "unknown";

export interface DetectedQuestion {
  /** Stable identity for the field across re-scans. */
  id: string;
  /** The resolved question text shown to the candidate. */
  question: string;
  /** Declared character limit (maxlength), if any. */
  maxLength?: number;
  /** Word limit parsed from nearby hint text ("max 250 words"), if any. */
  wordLimit?: number;
  /** Declaration-style prompts must be reviewed and answered by the candidate. */
  restricted: boolean;
  /** Controls whether this row may call AI, is structured data, or needs personal confirmation. */
  bucket: QuestionBucket;
  /** Stable label/name/id signature used for page-scoped answer memory. */
  signature: string;
  /** True only when the current page exposes affirmative required evidence. */
  required: boolean;
  /** Strongest source used to determine requiredness. */
  requiredSource: RequiredSource;
  /** Confidence in the requiredness decision, from 0 to 1. */
  requiredConfidence: number;
  /** False means requiredness is unknown, not that the field is optional. */
  requiredKnown: boolean;
}

export interface StructuredFieldDescriptor {
  id: string;
  label: string;
  controlType: "text" | "textarea" | "number" | "date" | "select" | "radio";
  options: string[];
}

type QuestionField = HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement;

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

const CANDIDATE_CONFIRMATION_PATTERN =
  /\b(caution(?:s)?|criminal|conviction|convicted|criminal record|asbo|disclosure|dbs|declaration|consent|agree(?:ment)?|payroll|tax declaration|health|medical|disab(?:ility|led)|ethnic(?:ity| group)?|sex|religion|sexual orientation|gender|trans(?:gender)?|diversity|equal opportunit(?:y|ies)|national insurance|ni number|passport|date of birth|dob|birth date|right to work|rtw|work permit|require(?:s|d)? sponsorship|sponsorship required|currently work|current employee|bank account|sort code|marital|dependant|next of kin)\b/i;

const STRUCTURED_CONTEXT_PATTERN =
  /\b(training|course|qualification|education|employment|work history|current\s*\/?\s*last job|previous job|career history)\b/i;
const STRUCTURED_FIELD_PATTERN =
  /\b(course title|tutored by|trainer|number of days|days|year attended|qualification|employer|job title|position|start date|end date|from date|to date|duties)\b/i;
const LEAVE_ALONE_PATTERN =
  /\b(add fields?|remove fields?|find address|search|linkedin|save|submit|upload)\b/i;

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
  if (isWorkdayHostname(host)) return "workday";
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

function isInput(el: Element): el is HTMLInputElement {
  return el.tagName === "INPUT";
}

function isSelect(el: Element): el is HTMLSelectElement {
  return el.tagName === "SELECT";
}

function isCandidateField(el: Element): el is QuestionField {
  if (isTextArea(el)) {
    if (el.disabled || el.readOnly) return false;
    return isVisible(el);
  }
  if (isInput(el)) {
    const input = el as HTMLInputElement;
    if (input.disabled || input.readOnly) return false;
    if (!["text", "email", "tel", "number", "date", "month", "radio"].includes(input.type)) return false;
    return isVisible(input);
  }
  if (isSelect(el)) {
    const select = el as HTMLSelectElement;
    if (select.disabled) return false;
    return isVisible(select);
  }
  return false;
}

function isPersonalField(field: QuestionField, question = ""): boolean {
  const meta = `${field.name} ${field.id} ${field.getAttribute("data-automation-id") ?? ""} ${question}`;
  if (PERSONAL_FIELD_PATTERN.test(meta)) return true;
  const auto = field.getAttribute("autocomplete")?.toLowerCase().trim();
  if (auto && PERSONAL_AUTOCOMPLETE.has(auto)) return true;
  return false;
}

function requiresCandidateConfirmation(question: string): boolean {
  return CANDIDATE_CONFIRMATION_PATTERN.test(question);
}

export interface Requiredness {
  required: boolean;
  requiredSource: RequiredSource;
  requiredConfidence: number;
  requiredKnown: boolean;
}

function hasAffirmativeRequiredText(text: string): boolean {
  if (/\bnot\s+required\b|\boptional\b/i.test(text)) return false;
  return /(?:\*\s*$|\(\s*required\s*\)|\b(?:required|mandatory)\b)/i.test(text);
}

function associatedLabelElements(field: QuestionField): Element[] {
  const labels: Element[] = [];
  const doc = field.ownerDocument;
  if (field.id) {
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(field.id)
        : field.id.replace(/["\\]/g, "\\$&");
    const external = doc.querySelector(`label[for="${escaped}"]`);
    if (external) labels.push(external);
  }
  const wrapping = field.closest("label");
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
  return labels;
}

function referencedText(field: QuestionField, attribute: "aria-labelledby" | "aria-describedby"): string {
  const references = field.getAttribute(attribute);
  if (!references) return "";
  return references
    .split(/\s+/)
    .map((id) => field.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function nearbyRequiredMarker(field: QuestionField): boolean {
  const markerSelector =
    "[class*='required' i], [class*='mandatory' i], [data-required='true'], [data-mandatory='true']";
  const associatedLabels = associatedLabelElements(field);
  const containers = [
    ...associatedLabels,
    field.closest("fieldset, [role='group'], [role='radiogroup'], div, li, td"),
  ].filter((element): element is Element => element !== null);
  return containers.some((container) => {
    if (
      !associatedLabels.includes(container) &&
      container.querySelectorAll("input, textarea, select").length > 1
    ) {
      return false;
    }
    const markers = [
      ...(container.matches(markerSelector) ? [container] : []),
      ...Array.from(container.querySelectorAll(markerSelector)),
    ];
    return markers.some((marker) => {
      const text = marker.textContent?.trim() ?? "";
      if (/\bnot\s+required\b|\boptional\b/i.test(text)) return false;
      if (marker.getAttribute("data-required") === "true" || marker.getAttribute("data-mandatory") === "true") {
        return true;
      }
      const className = marker.getAttribute("class") ?? "";
      if (
        /(?:^|[\s_-])(?:required|mandatory)(?:$|[\s_-])/i.test(className) &&
        !/(?:^|[\s_-])(?:not-required|optional)(?:$|[\s_-])/i.test(className)
      ) {
        return true;
      }
      return text === "*" || hasAffirmativeRequiredText(text);
    });
  });
}

/**
 * Resolve the page's current requiredness evidence. Unknown is intentionally
 * distinct from optional and is recalculated on every scan.
 */
export function getRequiredness(field: QuestionField): Requiredness {
  if (field.required) {
    return { required: true, requiredSource: "dom", requiredConfidence: 1, requiredKnown: true };
  }

  const ariaRequired = field.getAttribute("aria-required")?.trim().toLowerCase();
  if (ariaRequired === "true") {
    return { required: true, requiredSource: "aria", requiredConfidence: 1, requiredKnown: true };
  }
  if (ariaRequired === "false") {
    return { required: false, requiredSource: "aria", requiredConfidence: 1, requiredKnown: true };
  }

  const labelText = [
    ...associatedLabelElements(field).map((label) => label.textContent ?? ""),
    field.getAttribute("aria-label") ?? "",
    referencedText(field, "aria-labelledby"),
  ].join(" ");
  if (hasAffirmativeRequiredText(labelText)) {
    return { required: true, requiredSource: "label", requiredConfidence: 0.9, requiredKnown: true };
  }

  const hintText = referencedText(field, "aria-describedby");
  if (hasAffirmativeRequiredText(hintText)) {
    return { required: true, requiredSource: "hint", requiredConfidence: 0.85, requiredKnown: true };
  }

  if (nearbyRequiredMarker(field)) {
    return { required: true, requiredSource: "group", requiredConfidence: 0.75, requiredKnown: true };
  }

  return { required: false, requiredSource: "unknown", requiredConfidence: 0, requiredKnown: false };
}

// ---------------------------------------------------------------------------
// Label / question-text resolution
// ---------------------------------------------------------------------------

function cleanText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim();
}

function humanizeMetadata(value: string): string {
  const cleaned = cleanText(value)
    .replace(/\[(\d+)\]/g, " $1 ")
    .replace(/\[([^\]]+)\]/g, " $1 ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b(textarea|longtext|long text|answer|response)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const semantic = tokens.filter((token) => !/^\d+$/.test(token));
  const last = semantic.at(-1) ?? "";
  const aliases: Record<string, string> = {
    from: "From",
    to: "To",
    sex: "Sex",
    employer: "Employer",
    position: "Position held",
    duties: "Duties",
    course: "Course title",
    tutor: "Tutored by",
    tutored: "Tutored by",
    days: "Number of days",
    year: "Year attended",
  };
  if (aliases[last.toLowerCase()]) return aliases[last.toLowerCase()];
  if (/\[|^(?:eq|employment|training|qualification|education|reference)[_\s-]/i.test(value)) {
    return last.replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
}

function metadataContext(field: QuestionField): string {
  const raw = cleanText(field.name || field.id).toLowerCase();
  const indexMatch = raw.match(/\[(\d+)\]/);
  const index = indexMatch ? Number(indexMatch[1]) + 1 : null;
  let context = "";
  if (/\beq(?:ual)?[_\s\[]|equal.?opportun/i.test(raw)) context = "Equal Opportunities";
  else if (/employment|work.?history/i.test(raw)) context = "Employment History";
  else if (/current.?job|last.?job/i.test(raw)) context = "Current / Last Job";
  else if (/training|course/i.test(raw)) context = "Training";
  else if (/qualification|education/i.test(raw)) context = "Qualifications";
  else if (/reference/i.test(raw)) context = "References";
  return context && index ? `${context} ${index}` : context;
}

function explicitFieldLabel(field: QuestionField): string {
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

  // 3. aria-label
  const ariaLabel = cleanText(field.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  // 4. aria-labelledby
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

  // 5. Workday: label inside the same data-automation-id container
  const wdContainer = field.closest("[data-automation-id]");
  if (wdContainer) {
    const wdLabel = wdContainer.querySelector("label, [data-automation-id*='label' i], legend");
    const t = cleanText(wdLabel?.textContent);
    if (t) return t;
  }

  // 6. A nearby paragraph often carries the control-specific prompt.
  const group = field.closest("div, li, td, section, fieldset");
  if (group) {
    const candidates = Array.from(
      group.querySelectorAll("p, span[class*='label' i]")
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

  const row = field.closest("tr");
  const rowLabel = cleanText(row?.querySelector("th, td:first-child")?.textContent);
  if (rowLabel && !rowLabel.includes(cleanText(field.value))) return rowLabel;

  // 7. Stable field metadata is preferable to a broad section heading.
  const metadata = humanizeMetadata(field.name || field.id);
  if (metadata && !/^\d+$/.test(metadata)) return metadata;

  // 8. Preceding sibling walk (generic forms without grouping wrappers)
  let node: Element | null = field.parentElement;
  let hops = 0;
  while (node && hops < 4) {
    let sib: Element | null = (hops === 0 ? field : node).previousElementSibling;
    while (sib) {
      if (/^(P|LABEL|DIV|SPAN)$/.test(sib.tagName)) {
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

function sectionContext(field: QuestionField): string {
  const fieldset = field.closest("fieldset");
  let context = cleanText(fieldset?.querySelector(":scope > legend")?.textContent);
  if (!context) {
    const section = field.closest("section, [class*='section' i], [class*='group' i], table");
    context = cleanText(section?.querySelector("h1, h2, h3, h4, h5, h6, legend, caption")?.textContent);
  }
  if (/^(application( for employment)?|apply|application form)$/i.test(context)) context = "";
  const inferred = metadataContext(field);
  if (!context) return inferred;
  const indexMatch = cleanText(field.name || field.id).match(/\[(\d+)\]/);
  if (indexMatch && !/\b\d+\b/.test(context)) {
    return `${context} ${Number(indexMatch[1]) + 1}`;
  }
  return context;
}

function resolveQuestionText(field: QuestionField, defaultText = "Application response"): string {
  const child = explicitFieldLabel(field) || defaultText;
  const context = sectionContext(field);
  if (isInput(field) && field.type === "radio") {
    return context || child;
  }
  if (!context || context.toLowerCase() === child.toLowerCase()) return child;
  return `${context} — ${child}`;
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

function stableFieldSignature(
  field: QuestionField,
  question: string,
  root: Document | Element,
): string {
  const normalized = (value: string) => cleanText(value).toLowerCase();
  const base = [
    normalized(question),
    normalized(field.name),
    normalized(field.id),
    normalized(field.getAttribute("data-automation-id") ?? ""),
  ].join("|");
  const candidates = Array.from(root.querySelectorAll("textarea, input, select"));
  const ordinal = Math.max(0, candidates.indexOf(field));
  return `${base}|${field.tagName.toLowerCase()}|${ordinal}`;
}

function isLongTextInput(field: QuestionField): boolean {
  if (!isInput(field) || field.type !== "text") return false;
  const maxLen = field.maxLength > 0 ? field.maxLength : undefined;
  const size = field.size > 0 ? field.size : undefined;
  return (maxLen !== undefined && maxLen >= 200) || (size !== undefined && size >= 60);
}

function classifyField(
  field: QuestionField,
  question: string,
  hostname: string,
  root: Document | Element,
): QuestionBucket | null {
  const meta = `${question} ${field.name} ${field.id} ${field.getAttribute("data-automation-id") ?? ""}`;
  if (LEAVE_ALONE_PATTERN.test(meta)) return null;
  if (requiresCandidateConfirmation(meta)) return "confirmation";
  if (isPersonalField(field, question)) return "structured";
  if (isTextArea(field) || isLongTextInput(field) || isDedicatedField(field, hostname)) {
    return "generate";
  }
  const context = sectionContext(field);
  if (STRUCTURED_CONTEXT_PATTERN.test(`${context} ${meta}`) || STRUCTURED_FIELD_PATTERN.test(meta)) {
    return "structured";
  }
  if (isPinpointPage(field.ownerDocument, hostname)) {
    const questionSection = field.closest("fieldset, section, [class*='question' i], [data-testid*='question' i]");
    const sectionText = cleanText(questionSection?.textContent).slice(0, 500);
    if (/\bquestions?\b/i.test(`${sectionText} ${context}`)) return "structured";
  }
  // Any remaining visible, writable and labelled application control is still
  // actionable structured data. Missing one is worse than showing a safe row.
  return question !== "Application response" ? "structured" : null;
}

function scanRoot(root: Document | Element, hostname: string): DetectedQuestion[] {
  const results: DetectedQuestion[] = [];
  const fields = Array.from(root.querySelectorAll("textarea, input, select"));
  const seenRadioGroups = new Set<string>();

  for (const el of fields) {
    if (!isCandidateField(el)) continue;
    const field = el;
    if (isInput(field) && field.type === "radio") {
      const radioKey = field.name || field.closest("[role='radiogroup']")?.getAttribute("aria-labelledby") || field.id;
      if (radioKey && seenRadioGroups.has(radioKey)) continue;
      if (radioKey) seenRadioGroups.add(radioKey);
    }
    const dedicated = isDedicatedField(field, hostname);
    const question = resolveQuestionText(field, dedicated ? "Supporting statement" : "Application response");
    const bucket = classifyField(field, question, hostname, root);
    if (!bucket) continue;

    const maxLength = "maxLength" in field && field.maxLength > 0 ? field.maxLength : undefined;
    const restrictionText = `${question} ${field.name} ${field.id} ${field.getAttribute("data-automation-id") ?? ""}`;
    const requiredness = getRequiredness(field);
    results.push({
      id: ensureId(field),
      question: question.length > 300 ? `${question.slice(0, 300)}…` : question,
      maxLength,
      wordLimit: resolveWordLimit(field),
      restricted: bucket === "confirmation" || requiresCandidateConfirmation(restrictionText),
      bucket,
      signature: stableFieldSignature(field, question, root),
      ...requiredness,
    });
  }
  const totals = new Map<string, number>();
  for (const result of results) {
    const key = result.question.toLowerCase();
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const result of results) {
    const key = result.question.toLowerCase();
    if ((totals.get(key) ?? 0) < 2) continue;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    result.question = `${result.question} (${occurrence})`;
  }
  return results;
}

/**
 * Detect free-text application questions in the document and any accessible
 * same-origin iframes. Cross-origin frames are skipped silently.
 */
function accessibleDocuments(doc: Document): Document[] {
  const documents: Document[] = [doc];
  for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      const innerDoc = iframe.contentDocument;
      if (innerDoc?.body && !documents.includes(innerDoc)) {
        documents.push(...accessibleDocuments(innerDoc));
      }
    } catch {
      // Cross-origin — browser security prevents access; skip.
    }
  }
  return documents;
}

export function detectQuestions(doc: Document = document, hostname = doc.location?.hostname ?? ""): DetectedQuestion[] {
  const results = accessibleDocuments(doc).flatMap((currentDoc) =>
    scanRoot(currentDoc, currentDoc.location?.hostname || hostname),
  );
  // Every writable field is retained, including repeated prompts such as two
  // "Achievements" boxes. Identity is field-based, not text-based.
  return results;
}

/**
 * Write an answer into the originating field, dispatching the events React /
 * Angular ATS forms need to register the change. Returns false if the field
 * is no longer on the page.
 */
export function insertAnswer(questionId: string, answer: string): boolean {
  return setQuestionFieldValue(questionId, answer, { focus: true });
}

export function getQuestionField(questionId: string): QuestionField | null {
  const field = fieldRegistry.get(questionId)?.deref();
  return field?.isConnected ? field : null;
}

export function setQuestionFieldValue(
  questionId: string,
  answer: string,
  options: { focus?: boolean } = {},
): boolean {
  const field = fieldRegistry.get(questionId)?.deref();
  if (!field || !field.isConnected) return false;
  if (isSelect(field) || (isInput(field) && field.type === "radio")) return false;

  const proto =
    isTextArea(field)
      ? (field.ownerDocument.defaultView ?? window).HTMLTextAreaElement.prototype
      : (field.ownerDocument.defaultView ?? window).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const ViewEvent = field.ownerDocument.defaultView?.Event ?? Event;
  return runExtensionFieldWrite(field, () => {
    if (setter) {
      setter.call(field, answer);
    } else {
      field.value = answer;
    }

    field.dispatchEvent(new ViewEvent("input", { bubbles: true }));
    field.dispatchEvent(new ViewEvent("change", { bubbles: true }));
    if (options.focus !== false) field.focus?.();
    return true;
  });
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
        q.wordLimit === b[i].wordLimit &&
      q.restricted === b[i].restricted &&
      q.bucket === b[i].bucket &&
      q.signature === b[i].signature &&
      q.required === b[i].required &&
      q.requiredSource === b[i].requiredSource &&
      q.requiredConfidence === b[i].requiredConfidence &&
      q.requiredKnown === b[i].requiredKnown
  );
}

function optionLabel(option: HTMLOptionElement): string {
  return cleanText(option.textContent || option.value);
}

function radioOptions(field: HTMLInputElement): string[] {
  if (!field.name) return [];
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(field.name) : field.name.replace(/["\\]/g, "\\$&");
  return Array.from(field.ownerDocument.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escaped}"]`))
    .map((radio) => cleanText(radio.closest("label")?.textContent || radio.getAttribute("aria-label") || radio.value))
    .filter(Boolean);
}

export function getStructuredFieldDescriptors(questions: DetectedQuestion[]): StructuredFieldDescriptor[] {
  return questions.flatMap((question) => {
    if (question.bucket !== "structured") return [];
    const field = getQuestionField(question.id);
    if (!field || cleanText(field.value)) return [];
    const controlType: StructuredFieldDescriptor["controlType"] =
      isTextArea(field) ? "textarea"
      : isSelect(field) ? "select"
      : field.type === "radio" ? "radio"
      : field.type === "number" ? "number"
      : ["date", "month"].includes(field.type) ? "date"
      : "text";
    const options = isSelect(field)
      ? Array.from(field.options).map(optionLabel).filter(Boolean)
      : isInput(field) && field.type === "radio" ? radioOptions(field)
      : [];
    return [{ id: question.id, label: question.question, controlType, options }];
  });
}

function normalizedChoice(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function fillStructuredField(questionId: string, value: string): boolean {
  const field = getQuestionField(questionId);
  const cleanValue = cleanText(value);
  if (!field || !cleanValue || cleanText(field.value)) return false;
  if (isSelect(field)) {
    const wanted = normalizedChoice(cleanValue);
    const option = Array.from(field.options).find((candidate) =>
      [candidate.value, optionLabel(candidate)].some((candidateValue) => normalizedChoice(candidateValue) === wanted),
    );
    if (!option) return false;
    const ViewEvent = field.ownerDocument.defaultView?.Event ?? Event;
    return runExtensionFieldWrite(field, () => {
      field.value = option.value;
      field.dispatchEvent(new ViewEvent("input", { bubbles: true }));
      field.dispatchEvent(new ViewEvent("change", { bubbles: true }));
      return true;
    });
  } else if (isInput(field) && field.type === "radio") {
    if (!field.name) return false;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(field.name) : field.name.replace(/["\\]/g, "\\$&");
    const wanted = normalizedChoice(cleanValue);
    const radio = Array.from(field.ownerDocument.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escaped}"]`))
      .find((candidate) => normalizedChoice(candidate.closest("label")?.textContent || candidate.getAttribute("aria-label") || candidate.value) === wanted);
    if (!radio || radio.checked) return false;
    const ViewEvent = radio.ownerDocument.defaultView?.Event ?? Event;
    return runExtensionFieldWrite(radio, () => {
      radio.checked = true;
      radio.dispatchEvent(new ViewEvent("input", { bubbles: true }));
      radio.dispatchEvent(new ViewEvent("change", { bubbles: true }));
      return true;
    });
  } else {
    return setQuestionFieldValue(questionId, cleanValue, { focus: false });
  }
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
  let forceNotify = false;
  let lastUrl = doc.location?.href ?? "";
  const observers = new Map<Document, MutationObserver>();
  const frameLoadListeners = new Map<HTMLIFrameElement, () => void>();
  const view = doc.defaultView;

  const rescan = () => {
    timer = null;
    const previousUrl = lastUrl;
    lastUrl = doc.location?.href ?? "";
    const next = detectQuestions(doc);
    syncObservers();
    if (forceNotify || previousUrl !== lastUrl || !sameQuestions(snapshot, next)) {
      forceNotify = false;
      snapshot = next;
      listeners.forEach((l) => l());
    }
  };

  const scheduleRescan = (force = false) => {
    forceNotify ||= force;
    if (timer) clearTimeout(timer);
    timer = setTimeout(rescan, 400);
  };

  const mutationListener = (mutations: MutationRecord[]) => {
    // Ignore mutations caused solely by our own id-stamping attribute.
    if (mutations.every((m) => m.type === "attributes" && m.attributeName === FIELD_ID_ATTR)) {
      return;
    }
    scheduleRescan();
  };

  function syncObservers() {
    const currentDocuments = new Set(accessibleDocuments(doc));
    for (const [observedDoc, observer] of observers) {
      if (!currentDocuments.has(observedDoc)) {
        observer.disconnect();
        observers.delete(observedDoc);
      }
    }
    for (const currentDoc of currentDocuments) {
      if (!currentDoc.documentElement || observers.has(currentDoc)) continue;
      const observer = new MutationObserver(mutationListener);
      observer.observe(currentDoc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "hidden",
          "disabled",
          "style",
          "class",
          "aria-hidden",
          "required",
          "aria-required",
          "aria-describedby",
          "aria-labelledby",
          "data-required",
          "data-mandatory",
        ],
      });
      observers.set(currentDoc, observer);
    }

    const currentFrames = new Set(
      Array.from(currentDocuments).flatMap((currentDoc) => Array.from(currentDoc.querySelectorAll("iframe"))),
    );
    for (const [frame, listener] of frameLoadListeners) {
      if (!currentFrames.has(frame)) {
        frame.removeEventListener("load", listener);
        frameLoadListeners.delete(frame);
      }
    }
    for (const frame of currentFrames) {
      if (frameLoadListeners.has(frame)) continue;
      const listener = () => scheduleRescan(true);
      frame.addEventListener("load", listener);
      frameLoadListeners.set(frame, listener);
    }
  }

  syncObservers();

  const onHistoryChange = () => scheduleRescan(true);
  const originalPushState = view?.history.pushState;
  const originalReplaceState = view?.history.replaceState;
  if (view && originalPushState && originalReplaceState) {
    view.history.pushState = function (...args) {
      originalPushState.apply(view.history, args);
      onHistoryChange();
    };
    view.history.replaceState = function (...args) {
      originalReplaceState.apply(view.history, args);
      onHistoryChange();
    };
    view.addEventListener("popstate", onHistoryChange);
    view.addEventListener("hashchange", onHistoryChange);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    stop() {
      for (const observer of observers.values()) observer.disconnect();
      observers.clear();
      for (const [frame, listener] of frameLoadListeners) frame.removeEventListener("load", listener);
      frameLoadListeners.clear();
      if (view && originalPushState && originalReplaceState) {
        view.history.pushState = originalPushState;
        view.history.replaceState = originalReplaceState;
        view.removeEventListener("popstate", onHistoryChange);
        view.removeEventListener("hashchange", onHistoryChange);
      }
      if (timer) clearTimeout(timer);
    },
  };
}
