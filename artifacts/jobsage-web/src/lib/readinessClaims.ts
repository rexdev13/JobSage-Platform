const STRUCTURED_GAP_PATTERN =
  /\b(?:registration|registered|registration number|regulated|professional body|pin(?: number)?|gmc|nmc|hcpc|gdc|gphc|social work england|licen[cs](?:e|ed|ing|ure)|dbs|disclosure and barring|background check|criminal record check|police check|(?:basic|standard|enhanced) clearance|safeguard(?:ing)?|child protection|adult protection|residen(?:cy|ce|tial)|right to work|work auth[ou]ri[sz]ation|work permit|immigration|visa status|permission to work|indefinite leave to remain|settled status|pre-settled status|biometric residence permit|brp|sponsor(?:ship)?|skilled worker visa)\b/i;

export function normalizeReadinessClaim(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function requiresStructuredProfileUpdate(gap: string): boolean {
  return STRUCTURED_GAP_PATTERN.test(gap);
}

export function unresolvedReadinessGaps(gaps: string[], acknowledgedKeys: Set<string>): string[] {
  return gaps.filter((gap) => !acknowledgedKeys.has(normalizeReadinessClaim(gap)));
}