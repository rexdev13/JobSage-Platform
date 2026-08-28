import { normalizeRegionList, regionsOverlap } from "./regionMatching";

const BEHAVIOUR_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const RECENT_BEHAVIOUR_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_BEHAVIOURAL_BOOST = 30;

const TITLE_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "role",
  "job",
  "full",
  "part",
  "time",
  "senior",
  "staff",
]);
const SHORT_CLINICAL_TITLE_TOKENS = new Set(["gp", "icu", "itu", "odp", "rgn", "rmn", "rnld"]);

export type BehaviouralEngagementKind = "link_clicked" | "favourited" | "applied";

export interface BehaviouralEngagement {
  roleId?: number | null;
  title?: string | null;
  employer?: string | null;
  regulator?: string | null;
  targetRegions?: readonly string[] | null;
  kind: BehaviouralEngagementKind;
  occurredAt?: Date | string | null;
}

export interface BehaviouralRole {
  id: number;
  title: string;
  employer: string;
  regulator: string;
  targetRegions?: readonly string[] | null;
}

export interface BehaviouralSignals {
  favouriteRoleIds: ReadonlySet<number>;
  bookmarkedEmployers: ReadonlySet<string>;
  engagements: readonly BehaviouralEngagement[];
}

export interface BehaviouralRanking {
  boost: number;
  reason: string | null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function titleWords(value: string | null | undefined): Set<string> {
  return new Set(
    normalize(value)
      .split(/[^a-z0-9]+/)
      .filter((word) =>
        !TITLE_STOP_WORDS.has(word)
        && (word.length >= 4 || SHORT_CLINICAL_TITLE_TOKENS.has(word)),
      ),
  );
}

function occurredAtMs(occurredAt: Date | string | null | undefined): number | null {
  if (!occurredAt) return Date.now();
  const time = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function isWithinBehaviourWindow(occurredAt: Date | string | null | undefined): boolean {
  const time = occurredAtMs(occurredAt);
  return time !== null && Date.now() - time <= BEHAVIOUR_WINDOW_MS;
}

function isRecent(occurredAt: Date | string | null | undefined): boolean {
  const time = occurredAtMs(occurredAt);
  return time !== null && Date.now() - time <= RECENT_BEHAVIOUR_WINDOW_MS;
}

function engagementWeight(engagement: BehaviouralEngagement): number {
  const recentMultiplier = isRecent(engagement.occurredAt) ? 1 : 0.5;
  const outcomeMultiplier =
    engagement.kind === "applied"
      ? 2
      : engagement.kind === "favourited"
        ? 1.5
        : 1;
  return recentMultiplier * outcomeMultiplier;
}

/**
 * Calculates a small, bounded, deterministic score adjustment. The cached
 * match score remains the source of truth; this only changes ordering for
 * opportunities that reflect the candidate's recent behaviour.
 */
export function calculateBehaviouralRanking(
  role: BehaviouralRole,
  signals: BehaviouralSignals,
): BehaviouralRanking {
  const roleTitle = titleWords(role.title);
  const roleEmployer = normalize(role.employer);
  const roleRegulator = normalize(role.regulator);
  const isFavourite = signals.favouriteRoleIds.has(role.id);
  const isBookmarkedSponsor = signals.bookmarkedEmployers.has(roleEmployer);

  let boost = 0;
  let reason: string | null = null;

  if (isFavourite) {
    boost += 18;
    reason = "You favourited this opportunity";
  }
  if (isBookmarkedSponsor) {
    boost += 14;
    reason ??= "From a sponsor you bookmarked";
  }

  const recentEngagements = signals.engagements.filter((engagement) =>
    isWithinBehaviourWindow(engagement.occurredAt),
  );
  const directlyEngaged = recentEngagements.some((engagement) => engagement.roleId === role.id);
  if (directlyEngaged) {
    const directEngagement = recentEngagements
      .filter((engagement) => engagement.roleId === role.id)
      .sort((a, b) => engagementWeight(b) - engagementWeight(a))[0];
    boost += directEngagement?.kind === "applied" ? 20 : isRecent(directEngagement?.occurredAt) ? 16 : 8;
    reason ??= directEngagement?.kind === "applied"
      ? "You applied for this opportunity"
      : "You opened this opportunity recently";
  }

  let titleSignal = 0;
  let employerSignal = 0;
  let regulatorSignal = 0;
  let regionSignal = 0;
  let titleHasAppliedEvidence = false;
  let titleHasFavouriteEvidence = false;
  let employerHasAppliedEvidence = false;
  let employerHasFavouriteEvidence = false;

  for (const engagement of recentEngagements) {
    if (engagement.roleId === role.id) continue;
    const engagementTitle = titleWords(engagement.title);
    const titleOverlap = [...roleTitle].some((word) => engagementTitle.has(word));
    const weight = engagementWeight(engagement);
    if (titleOverlap) {
      titleSignal += weight;
      if (engagement.kind === "applied") titleHasAppliedEvidence = true;
      if (engagement.kind === "favourited") titleHasFavouriteEvidence = true;
    }
    if (roleEmployer && roleEmployer === normalize(engagement.employer)) {
      employerSignal += weight;
      if (engagement.kind === "applied") employerHasAppliedEvidence = true;
      if (engagement.kind === "favourited") employerHasFavouriteEvidence = true;
    }
    if (roleRegulator && roleRegulator === normalize(engagement.regulator)) regulatorSignal += weight;

    const roleRegions = normalizeRegionList(role.targetRegions);
    const engagementRegions = normalizeRegionList(engagement.targetRegions);
    if (
      roleRegions.length > 0 &&
      engagementRegions.length > 0 &&
      regionsOverlap(roleRegions, engagementRegions)
    ) {
      regionSignal += weight;
    }
  }

  if (titleSignal > 0) {
    boost += Math.min(12, Math.round(6 + titleSignal * 2));
    reason ??= titleHasAppliedEvidence
      ? "Similar to roles you applied for"
      : titleHasFavouriteEvidence
        ? "Similar to roles you favourited"
        : "Similar to roles you opened";
  }
  if (employerSignal > 0) {
    boost += Math.min(12, Math.round(6 + employerSignal * 2));
    reason ??= employerHasAppliedEvidence
      ? "Same employer as jobs you applied for"
      : employerHasFavouriteEvidence
        ? "Same employer as jobs you favourited"
        : "Same employer as jobs you clicked";
  }
  if (regionSignal > 0) {
    boost += Math.min(6, Math.round(2 + regionSignal * 2));
    reason ??= "Same region as roles you opened";
  }
  if (regulatorSignal > 0) {
    boost += Math.min(4, Math.round(1 + regulatorSignal));
    reason ??= "Similar to roles in your profession";
  }

  return {
    boost: Math.min(MAX_BEHAVIOURAL_BOOST, boost),
    reason,
  };
}

export function normalizeBehaviouralEmployer(value: string | null | undefined): string {
  return normalize(value);
}