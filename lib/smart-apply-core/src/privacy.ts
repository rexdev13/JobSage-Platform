/** High-confidence sensitive content guard, not a general-purpose DLP guarantee. */
export const SENSITIVE_VALUE_PATTERN =
  /\b(diagnosed with|my diagnos(?:is|es)|my disability|my medical|mental health condition|medication i take|bank account|sort code|credit card|debit card|card number|cvv|iban|swift code|account balance|credit score|national insurance number|passport number)\b|\b(?:i have|i had|i am|i was|my)\b[^.!?\n]{0,45}\b(diabet(?:es|ic)|cancer|hiv|asthma|pregnan(?:t|cy)|diagnosis|disability)\b|\b(?:\d[ -]*?){13,19}\b/i;

export function hasSensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERN.test(value);
}

/** Personal disclosures and attestations, not professional healthcare topics. */
export function requiresPersonalConfirmation(question: string): boolean {
  if (/\b(?:i (?:confirm|certify|declare|acknowledge|accept)|terms and conditions|privacy policy)\b/i.test(question)) return true;
  return /\b(criminal|conviction|convicted|criminal record|cautions?|asbo|dbs|declaration|consent|agree(?:ment)?|payroll|tax declaration|ethnic(?:ity| group)?|sex|religion|sexual orientation|gender|transgender|diversity|equal opportunit(?:y|ies)|national insurance|ni number|passport|date of birth|dob|birth date|bank account|sort code|credit card|debit card|cvv|iban|marital|dependants?|next of kin)\b/i.test(question)
    || /\b(?:your|personal|my)\s+(?:disability|diagnosis|medication|financial details|financial circumstances|medical conditions?)\b|\b(?:medical history|health details|medical details|disability details|disability status|health condition|medical condition)\b/i.test(question)
    || /\b(?:your|my)\s+(?:(?:physical|mental)\s+)?health\b(?!\s+(?:nursing|care|experience|training|qualifications?))/i.test(question)
    || /\b(?:do you|have you|are you)\b[^?!.]{0,45}\b(?:diagnosed|disability|disabled|medication|pregnan(?:t|cy))\b/i.test(question)
    || /^(?:health|medical)(?:\s+(?:details|history|conditions?|information|questionnaire))?$/i.test(question.trim());
}
