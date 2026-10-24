const MAX_CV_TEXT_LENGTH = 24_000;

const PRIVATE_DETAIL_LINE =
  /^\s*(?:date of birth|dob|nationality|marital status|passport(?: number)?|national insurance(?: number)?|ni number|email|e-mail|phone|mobile|telephone|tel|address|home address)\s*:/i;

function normalizeForEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-GB");
}

/**
 * Remove obvious identifiers that are not useful for drafting strengths.
 * The original CV stays in private object storage and is never returned.
 */
export function prepareCvEvidenceText(cvText: string): string {
  return cvText
    .split(/\r?\n/)
    .filter((line) => !PRIVATE_DETAIL_LINE.test(line))
    .join("\n")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
    .replace(/\b[A-Z]{2}\s?\d{6}\s?[A-D]\b/gi, "[REDACTED ID]")
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, "[REDACTED POSTCODE]")
    .replace(/\+?\d[\d ().-]{7,}\d/g, (phone) =>
      (phone.match(/\d/g)?.length ?? 0) >= 10 ? "[REDACTED PHONE]" : phone
    )
    .slice(0, MAX_CV_TEXT_LENGTH)
    .trim();
}

export interface SupportedCvStrength {
  text: string;
  evidence: string[];
}

/**
 * Keep only AI statements with evidence that is an exact excerpt from the
 * (sanitised) CV text. Model-supplied URLs and unsupported claims are ignored.
 */
export function validateCvStrengths(
  value: unknown,
  cvEvidenceText: string,
): SupportedCvStrength[] {
  if (!value || typeof value !== "object" || !("strengths" in value)) return [];
  const strengths = (value as { strengths?: unknown }).strengths;
  if (!Array.isArray(strengths)) return [];

  const normalizedCv = normalizeForEvidence(cvEvidenceText);
  const verified: SupportedCvStrength[] = [];
  for (const item of strengths.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const { text, evidence } = item as { text?: unknown; evidence?: unknown };
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.trim().length > 350 ||
      /[\r\n]/.test(text) ||
      /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d ().-]{7,}\d|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b|\b[A-Z]{2}\s?\d{6}\s?[A-D]\b|\[REDACTED (?:EMAIL|PHONE|ID|POSTCODE)\])/i.test(text)
    ) {
      continue;
    }
    if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 3) continue;
    const exactEvidence = evidence.filter(
      (quote): quote is string =>
        typeof quote === "string" &&
        quote.trim().length > 0 &&
        quote.trim().length <= 300 &&
        normalizedCv.includes(normalizeForEvidence(quote)),
    );
    if (exactEvidence.length === 0) continue;

    verified.push({ text: text.trim(), evidence: exactEvidence });
  }
  return verified;
}
