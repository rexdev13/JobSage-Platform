export interface CandidateProfile {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  profession?: string | null;
  specialty?: string | null;
  qualificationCountry?: string | null;
  qualificationType?: string | null;
  qualificationYear?: number | null;
  experienceYears?: number | null;
  registrationStatus?: string | null;
  residencyStatus?: string | null;
  preferredStartDate?: string | null;
  languages?: string[] | null;
}

export interface TrustedVacancyContext {
  jobTitle?: string | null;
}

export interface PrefillResult {
  filled: string[];
  missing: string[];
  skipped: string[];
  fieldResults: Record<string, { status: "filled" | "missing" | "skipped"; message: string }>;
}

type DetailKey = keyof CandidateProfile;
type DetailField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isInput(field: DetailField): field is HTMLInputElement {
  return field.tagName === "INPUT";
}

function isSelect(field: DetailField): field is HTMLSelectElement {
  return field.tagName === "SELECT";
}

function notifyValueChange(field: DetailField): void {
  const ViewEvent = field.ownerDocument.defaultView?.Event ?? Event;
  field.dispatchEvent(new ViewEvent("input", { bubbles: true }));
  field.dispatchEvent(new ViewEvent("change", { bubbles: true }));
}

function setTextValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const view = field.ownerDocument.defaultView ?? window;
  const prototype = field.tagName === "TEXTAREA"
    ? view.HTMLTextAreaElement.prototype
    : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  notifyValueChange(field);
}

const SENSITIVE_FIELD_PATTERN =
  /\b(password|passcode|username|user\s*name|national\s*insurance|ni\s*number|passport|date\s*of\s*birth|dob|birth\s*date|security\s*question|security\s*answer|caution|criminal|conviction|asbo|dbs|health|medical|ethnic|sex|gender|religion|sexual orientation|equal opportunit|diversity|declaration|consent)\b/i;

const FIELD_RULES: Array<{ key: DetailKey; label: string; pattern: RegExp }> = [
  { key: "firstName", label: "first name", pattern: /\b(first|given|forename)\s*name\b|\bfirst_name\b/i },
  { key: "lastName", label: "last name", pattern: /\b(last|family|sur)name\b|\blast_name\b/i },
  { key: "fullName", label: "full name", pattern: /\bfull\s*name\b|\bname\s*as\s*(shown|it appears)\b/i },
  { key: "email", label: "email", pattern: /\be[-\s]?mail\b/i },
  { key: "phone", label: "phone", pattern: /\b(phone|telephone|mobile|contact\s*number|tel)\b/i },
  { key: "streetAddress", label: "street address", pattern: /\b(address|street|address\s*line)\b/i },
  { key: "city", label: "city", pattern: /\b(city|town)\b/i },
  { key: "postcode", label: "postcode", pattern: /\b(post|zip)\s*code\b|\bpostcode\b/i },
  { key: "country", label: "country", pattern: /\bcountry\b/i },
  { key: "profession", label: "profession", pattern: /\bprofession\b/i },
  { key: "specialty", label: "specialty", pattern: /\b(specialty|speciality)\b/i },
  { key: "qualificationCountry", label: "qualification country", pattern: /\bqualification country\b|\bcountry qualified\b/i },
  { key: "qualificationType", label: "qualification", pattern: /\b(qualification gained|qualification type|highest qualification)\b/i },
  { key: "qualificationYear", label: "qualification year", pattern: /\b(year qualified|qualification year|year gained)\b/i },
  { key: "experienceYears", label: "years of experience", pattern: /\b(years? of experience|experience years?)\b/i },
  { key: "registrationStatus", label: "registration status", pattern: /\b(registration status|professional registration)\b/i },
  { key: "residencyStatus", label: "residency status", pattern: /\bresidency status\b/i },
  { key: "preferredStartDate", label: "preferred start date", pattern: /\b(preferred start date|available from)\b/i },
  { key: "languages", label: "languages", pattern: /\blanguages?\b/i },
];

function clean(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function isVisible(field: DetailField): boolean {
  if (
    field.disabled ||
    ("readOnly" in field && field.readOnly) ||
    field.hidden ||
    field.getAttribute("aria-hidden") === "true"
  ) return false;
  const style = field.ownerDocument.defaultView?.getComputedStyle(field);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function fieldLabel(field: DetailField): string {
  const doc = field.ownerDocument;
  const labelledBy = field.getAttribute("aria-labelledby");
  const ariaText = labelledBy
    ? labelledBy.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? "").join(" ")
    : "";
  const escapedId =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(field.id)
      : field.id.replace(/["\\]/g, "\\$&");
  const label = field.id ? doc.querySelector(`label[for="${escapedId}"]`)?.textContent ?? "" : "";
  const wrappingLabel = field.closest("label")?.textContent ?? "";
  return clean([
    field.name,
    field.id,
    field.getAttribute("autocomplete"),
    field.getAttribute("aria-label"),
    ariaText,
    label,
    wrappingLabel,
  ].join(" "));
}

function findRule(field: DetailField): { key: DetailKey; label: string } | null {
  const label = fieldLabel(field);
  if (SENSITIVE_FIELD_PATTERN.test(label)) return null;

  const autocomplete = clean(field.getAttribute("autocomplete")).toLowerCase();
  if (autocomplete === "given-name") return { key: "firstName", label: "first name" };
  if (autocomplete === "family-name") return { key: "lastName", label: "last name" };
  if (autocomplete === "name") return { key: "fullName", label: "full name" };
  if (autocomplete === "email") return { key: "email", label: "email" };
  if (autocomplete === "tel") return { key: "phone", label: "phone" };
  if (autocomplete === "street-address") return { key: "streetAddress", label: "street address" };
  if (autocomplete === "address-level2") return { key: "city", label: "city" };
  if (autocomplete === "postal-code") return { key: "postcode", label: "postcode" };
  if (autocomplete === "country" || autocomplete === "country-name") return { key: "country", label: "country" };

  // A bare "name" is intentionally not treated as a full name. It is too
  // ambiguous on employer forms unless the label makes the meaning explicit.
  return FIELD_RULES.find((rule) => rule.pattern.test(label)) ?? null;
}

function valueFor(profile: CandidateProfile, key: DetailKey): string {
  if (key === "fullName") {
    return clean(profile.fullName) || [profile.firstName, profile.lastName].map(clean).filter(Boolean).join(" ");
  }
  const value = profile[key];
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ");
  if (typeof value === "number") return String(value);
  return clean(value);
}

function ukSelectValue(field: HTMLSelectElement, candidateValue: string): string | null {
  if (!/^(united kingdom|uk|gb|gbr)$/i.test(clean(candidateValue))) return null;
  const match = Array.from(field.options).find((option) => {
    const optionText = clean(`${option.value} ${option.textContent}`).toLowerCase();
    return /(^|\s)(united kingdom|uk|gb|gbr)(\s|$)/i.test(optionText);
  });
  return match?.value ?? null;
}

export function prefillPersonalDetails(
  profile: CandidateProfile,
  doc: Document = document,
  vacancyContext?: TrustedVacancyContext,
): PrefillResult {
  const filled = new Set<string>();
  const missing = new Set<string>();
  const skipped: string[] = [];
  const fieldResults: PrefillResult["fieldResults"] = {};
  const documents: Document[] = [doc];
  for (let i = 0; i < documents.length; i++) {
    for (const iframe of Array.from(documents[i].querySelectorAll("iframe"))) {
      try {
        if (iframe.contentDocument?.body && !documents.includes(iframe.contentDocument)) documents.push(iframe.contentDocument);
      } catch {
        // Cross-origin frames cannot be filled.
      }
    }
  }
  const fields = documents.flatMap((currentDoc) => Array.from(currentDoc.querySelectorAll<DetailField>("input, textarea, select")));
  for (const field of fields) {
    if (!isVisible(field)) continue;
    if (isInput(field) && ["hidden", "password", "file", "submit", "button", "checkbox", "radio"].includes(field.type)) {
      continue;
    }

    const label = fieldLabel(field);
    const questionId = field.getAttribute("data-jobsage-qid");
    if (SENSITIVE_FIELD_PATTERN.test(label)) {
      skipped.push(label || "sensitive field");
      if (questionId) fieldResults[questionId] = { status: "skipped", message: "Complete this yourself" };
      continue;
    }

    const rule = findRule(field);
    if (!rule) {
      const isPositionField =
        /\b(position|job\s*title|vacancy|role)\s*(applied\s*for)?\b|\bapplied\s*for\s*(position|job|vacancy|role)\b/i.test(label)
        && !/\b(employer|company|organisation|organization)\b/i.test(label);
      const trustedTitle = clean(vacancyContext?.jobTitle);
      if (!isPositionField || !trustedTitle || clean(field.value)) continue;
      if (isSelect(field)) continue;
      setTextValue(field, trustedTitle);
      filled.add("position applied for");
      if (questionId) fieldResults[questionId] = { status: "filled", message: "Filled from the JOBSAGE vacancy" };
      continue;
    }

    const currentValue = clean(field.value);
    const candidateValue = valueFor(profile, rule.key);
    if (currentValue) continue;
    if (!candidateValue) {
      missing.add(rule.label);
      if (questionId) fieldResults[questionId] = { status: "missing", message: "Not in your JOBSAGE profile or CV" };
      continue;
    }

    if (isSelect(field)) {
      if (rule.key !== "country") continue;
      const selectValue = ukSelectValue(field, candidateValue);
      if (!selectValue) {
        missing.add(rule.label);
        continue;
      }
      field.value = selectValue;
    } else {
      setTextValue(field, candidateValue);
    }
    if (isSelect(field)) notifyValueChange(field);
    filled.add(rule.label);
    if (questionId) fieldResults[questionId] = { status: "filled", message: "Filled from JOBSAGE" };
  }

  return { filled: Array.from(filled), missing: Array.from(missing), skipped, fieldResults };
}