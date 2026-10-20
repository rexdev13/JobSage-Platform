/** High-confidence sensitive content guard, not a general-purpose DLP guarantee. */
export const SENSITIVE_VALUE_PATTERN =
  /\b(diagnosed with|my diagnos(?:is|es)|my disability|my medical|mental health condition|medication i take|bank account|sort code|credit card|debit card|card number|cvv|iban|swift code|account balance|credit score|national insurance number|passport number)\b|\b(?:i have|i had|i am|i was|my)\b[^.!?\n]{0,45}\b(diabet(?:es|ic)|cancer|hiv|asthma|pregnan(?:t|cy)|diagnosis|disability)\b|\b(?:\d[ -]*?){13,19}\b/i;

export function hasSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERN.test(value);
}

export const EXTENSION_AI_CONSENT_VERSION = "smart-apply-ai-2026-10-20";
