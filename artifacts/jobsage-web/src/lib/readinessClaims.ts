const STRUCTURED_GAP_PATTERN =
  /\b(?:registration|registered|registration number|regulated|professional body|pin(?: number)?|gmc|nmc|hcpc|gdc|gphc|social work england|licen[cs](?:e|ed|ing|ure)|dbs|disclosure and barring|background check|criminal record check|police check|(?:basic|standard|enhanced) clearance|safeguard(?:ing)?|child protection|adult protection|residen(?:cy|ce|tial)|right to work|work auth[ou]ri[sz]ation|work permit|immigration|visa status|permission to work|indefinite leave to remain|settled status|pre-settled status|biometric residence permit|brp|sponsor(?:ship)?|skilled worker visa)\b/i;

const CAPABILITY_MARKERS = "experience|experienced|skill|skills|ability|proficiency|competence|competency|familiarity|knowledge";
const CLAIM_NOISE_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "with",
  "for",
  "to",
  "on",
  "this",
  "role",
  "candidate",
  "currently",
  "relevant",
  "strong",
  "good",
  "practical",
  "proven",
  "clear",
  "recent",
  "prior",
  "previous",
  "not",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "been",
  "required",
  "needed",
  "essential",
  "desirable",
  "preferred",
  "shown",
  "demonstrated",
  "evidence",
  "evidenced",
  "provided",
  "supplied",
]);

export function normalizeReadinessClaim(value: string): string {
  let normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  normalized = normalized
    .replace(/^(?:there is|there s)\s+no\s+(?:clear\s+)?(?:evidence|indication|proof)\s+(?:of|for)\s+/, "")
    .replace(/^no\s+(?:clear\s+)?(?:evidence|indication|proof)\s+(?:of|for)\s+/, "")
    .replace(/^(?:the\s+)?candidate\s+(?:does\s+not\s+have|doesn t have|has no|lacks?)\s+/, "")
    .replace(/^(?:does\s+not\s+have|doesn t have|has no|lacks?|is missing)\s+/, "")
    .replace(/^(?:requires?|needs?)\s+/, "")
    .replace(/\s+(?:(?:is|are|was|were|has been|have been)\s+)?(?:not\s+)?(?:shown|demonstrated|evidenced|provided|supplied|included|confirmed|listed|visible|documented|missing|lacking|unclear|absent|required|needed)$/, "")
    .trim();

  normalized = normalized
    .replace(new RegExp(`^(?:${CAPABILITY_MARKERS})\\s+(?:in|with|of|using|on|for|to)\\s+`), "")
    .replace(new RegExp(`^(?:${CAPABILITY_MARKERS})\\s+(.+)$`), "$1")
    .replace(new RegExp(`^(.+?)\\s+(?:${CAPABILITY_MARKERS})$`), "$1")
    .replace(/\bpaediatric\b/g, "pediatric")
    .replace(/\bvenepuncture\b/g, "venipuncture")
    .trim();

  const segments = normalized
    .split(/\s+and\s+/)
    .map((segment) => segment.split(" ").filter((word) => !CLAIM_NOISE_WORDS.has(word)).join(" "))
    .filter(Boolean)
    .sort();

  return segments.join(" and ");
}

export function requiresStructuredProfileUpdate(gap: string): boolean {
  return STRUCTURED_GAP_PATTERN.test(gap);
}

export function unresolvedReadinessGaps(gaps: string[], acknowledgedKeys: Set<string>): string[] {
  const canonicalAcknowledgedKeys = new Set(
    [...acknowledgedKeys].map((claimKey) => normalizeReadinessClaim(claimKey)),
  );
  return gaps.filter((gap) =>
    requiresStructuredProfileUpdate(gap)
    || !canonicalAcknowledgedKeys.has(normalizeReadinessClaim(gap))
  );
}
