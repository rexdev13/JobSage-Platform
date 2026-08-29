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

export function normalizeReadinessClaim(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getStructuredGapCategory(value: string): string | null {
  return STRUCTURED_GAP_PATTERNS.find(({ pattern }) => pattern.test(value))?.label ?? null;
}

export function filterAcknowledgedGaps(
  gaps: string[],
  claims: Pick<CandidateReadinessClaim, "claimKey">[],
): string[] {
  const acknowledgedKeys = new Set(claims.map((claim) => claim.claimKey));
  return gaps.filter((gap) => !acknowledgedKeys.has(normalizeReadinessClaim(gap)));
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