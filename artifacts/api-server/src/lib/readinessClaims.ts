import { db, candidateReadinessClaimsTable, type CandidateReadinessClaim } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const STRUCTURED_GAP_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "registration",
    pattern: /\b(?:registration|registered|registration number|regulated|professional body|pin(?: number)?|gmc|nmc|hcpc|gdc|gphc|social work england|licen[cs](?:e|ed|ing|ure))\b/i,
  },
  {
    label: "DBS",
    pattern: /\b(?:dbs|disclosure and barring|background check|criminal record check|police check|(?:basic|standard|enhanced) clearance)\b/i,
  },
  {
    label: "safeguarding",
    pattern: /\b(?:safeguard(?:ing)?|child protection|adult protection)\b/i,
  },
  {
    label: "residency",
    pattern: /\b(?:residen(?:cy|ce|tial)|right to work|work auth[ou]ri[sz]ation|work permit|immigration|visa status|permission to work|indefinite leave to remain|settled status|pre-settled status|biometric residence permit|brp)\b/i,
  },
  {
    label: "sponsorship",
    pattern: /\b(?:sponsor(?:ship)?|skilled worker visa)\b/i,
  },
];

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

  // AI commonly wraps the same capability in an absence/evidence statement.
  // Strip only these known wrappers rather than doing broad fuzzy matching.
  normalized = normalized
    .replace(/^(?:there is|there s)\s+no\s+(?:clear\s+)?(?:evidence|indication|proof)\s+(?:of|for)\s+/, "")
    .replace(/^no\s+(?:clear\s+)?(?:evidence|indication|proof)\s+(?:of|for)\s+/, "")
    .replace(/^(?:the\s+)?candidate\s+(?:does\s+not\s+have|doesn t have|has no|lacks?)\s+/, "")
    .replace(/^(?:does\s+not\s+have|doesn t have|has no|lacks?|is missing)\s+/, "")
    .replace(/^(?:requires?|needs?)\s+/, "")
    .replace(/\s+(?:(?:is|are|was|were|has been|have been)\s+)?(?:not\s+)?(?:shown|demonstrated|evidenced|provided|supplied|included|confirmed|listed|visible|documented|missing|lacking|unclear|absent|required|needed)$/, "")
    .trim();

  // Treat "experience with X", "X experience", and equivalent skill wording
  // as one capability. Existing rows with the former exact key are therefore
  // still compatible when this stronger identity is used for new claims.
  normalized = normalized
    .replace(new RegExp(`^(?:${CAPABILITY_MARKERS})\\s+(?:in|with|of|using|on|for|to)\\s+`), "")
    .replace(new RegExp(`^(?:${CAPABILITY_MARKERS})\\s+(.+)$`), "$1")
    .replace(new RegExp(`^(.+?)\\s+(?:${CAPABILITY_MARKERS})$`), "$1")
    .replace(/\bpaediatric\b/g, "pediatric")
    .replace(/\bvenepuncture\b/g, "venipuncture")
    .trim();

  // Conjunction order is not meaningful ("X and Y" vs "Y and X"), but the
  // actual words remain intact so unrelated capabilities do not collapse.
  const segments = normalized
    .split(/\s+and\s+/)
    .map((segment) => segment.split(" ").filter((word) => !CLAIM_NOISE_WORDS.has(word)).join(" "))
    .filter(Boolean)
    .sort();

  return segments.join(" and ");
}

export function getStructuredGapCategory(value: string): string | null {
  return STRUCTURED_GAP_PATTERNS.find(({ pattern }) => pattern.test(value))?.label ?? null;
}

export function filterAcknowledgedGaps(
  gaps: string[],
  claims: Pick<CandidateReadinessClaim, "claimKey">[],
): string[] {
  // Canonicalize stored keys too. This keeps claims saved before the stronger
  // canonicalization backwards-compatible without requiring a data migration.
  const acknowledgedKeys = new Set(claims.map((claim) => normalizeReadinessClaim(claim.claimKey)));
  return gaps.filter((gap) =>
    getStructuredGapCategory(gap) !== null
    || !acknowledgedKeys.has(normalizeReadinessClaim(gap))
  );
}

export async function getCandidateReadinessClaims(userId: string): Promise<CandidateReadinessClaim[]> {
  return db
    .select()
    .from(candidateReadinessClaimsTable)
    .where(eq(candidateReadinessClaimsTable.userId, userId))
    .orderBy(candidateReadinessClaimsTable.createdAt);
}

export async function getCandidateReadinessClaim(userId: string, claimKey: string): Promise<CandidateReadinessClaim | undefined> {
  const [claim] = await db
    .select()
    .from(candidateReadinessClaimsTable)
    .where(and(
      eq(candidateReadinessClaimsTable.userId, userId),
      eq(candidateReadinessClaimsTable.claimKey, claimKey),
    ))
    .limit(1);
  return claim;
}