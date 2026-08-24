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
}

export interface PrefillResult {
  filled: string[];
  missing: string[];
  skipped: string[];
}

type DetailKey = keyof CandidateProfile;
type DetailField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SENSITIVE_FIELD_PATTERN =
  /\b(password|passcode|username|user\s*name|national\s*insurance|ni\s*number|passport|date\s*of\s*birth|dob|birth\s*date|security\s*question|security\s*answer)\b/i;

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
  return clean(profile[key]);
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
): PrefillResult {
  const filled: string[] = [];
  const missing = new Set<string>();
  const skipped: string[] = [];
  const seenFields = new Set<DetailKey>();

  const fields = Array.from(doc.querySelectorAll<DetailField>("input, textarea, select"));
  for (const field of fields) {
    if (!isVisible(field)) continue;
    if (field instanceof HTMLInputElement && ["hidden", "password", "file", "submit", "button", "checkbox", "radio"].includes(field.type)) {
      continue;
    }

    const label = fieldLabel(field);
    if (SENSITIVE_FIELD_PATTERN.test(label)) {
      skipped.push(label || "sensitive field");
      continue;
    }

    const rule = findRule(field);
    if (!rule || seenFields.has(rule.key)) continue;
    seenFields.add(rule.key);

    const currentValue = clean(field.value);
    const candidateValue = valueFor(profile, rule.key);
    if (currentValue) continue;
    if (!candidateValue) {
      missing.add(rule.label);
      continue;
    }

    if (field instanceof HTMLSelectElement) {
      if (rule.key !== "country") continue;
      const selectValue = ukSelectValue(field, candidateValue);
      if (!selectValue) {
        missing.add(rule.label);
        continue;
      }
      field.value = selectValue;
    } else {
      field.value = candidateValue;
    }
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    filled.push(rule.label);
  }

  return { filled, missing: Array.from(missing), skipped };
}