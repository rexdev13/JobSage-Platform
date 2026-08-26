export const APPLY_FIRST_MIN_SCORE = 55;
export const TOP_MATCH_MIN_SCORE = 40;

export interface RankableOpportunity {
  aiScore: number | null;
  matchScore: number;
  isEligible: boolean;
  linkVerified: boolean;
  role: { id: number };
}

export function effectiveOpportunityScore(item: Pick<RankableOpportunity, "aiScore" | "matchScore">): number {
  return item.aiScore ?? item.matchScore;
}

export function compareOpportunityRanking(a: RankableOpportunity, b: RankableOpportunity): number {
  const scoreDifference = effectiveOpportunityScore(b) - effectiveOpportunityScore(a);
  if (scoreDifference !== 0) return scoreDifference;
  if (a.linkVerified !== b.linkVerified) return a.linkVerified ? -1 : 1;
  if (a.isEligible !== b.isEligible) return a.isEligible ? -1 : 1;
  return a.role.id - b.role.id;
}

export function qualifiesForApplyFirst(item: RankableOpportunity): boolean {
  return item.isEligible && effectiveOpportunityScore(item) >= APPLY_FIRST_MIN_SCORE;
}