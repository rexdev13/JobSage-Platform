const RECENT_BEHAVIOUR_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
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
  "band",
]);

export type BehaviouralEngagementKind = "link_clicked" | "applied";

export interface BehaviouralEngagement {
  roleId?: number | null;
  title?: string | null;
  employer?: string | null;
  regulator?: string | null;
  kind: BehaviouralEngagementKind;
  occurredAt?: Date | string | null;
}

export interface BehaviouralRole {
  id: number;
  title: string;
  employer: string;
  regulator: string;
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
      .filter((word) => word.length >= 4 && !TITLE_STOP_WORDS.has(word)),
  );
}

function isRecent(occurredAt: Date | string | null | undefined): boolean {
  if (!occurredAt) return true;
  const time = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
  return Number.isFinite(time) && Date.now() - time <= RECENT_BEHAVIOUR_WINDOW_MS;
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

  const recentEngagements = signals.engagements.filter((engagement) => isRecent(engagement.occurredAt));
  const directlyEngaged = recentEngagements.some((engagement) => engagement.roleId === role.id);
  if (directlyEngaged) {
    boost += 16;
    reason ??= "You opened this opportunity recently";
  }

  let hasSimilarTitle = false;
  let hasSimilarEmployer = false;
  let hasSimilarRegulator = false;

  for (const engagement of recentEngagements) {
    if (engagement.roleId === role.id) continue;
    const engagementTitle = titleWords(engagement.title);
    const titleOverlap = [...roleTitle].some((word) => engagementTitle.has(word));
    if (titleOverlap) hasSimilarTitle = true;
    if (roleEmployer && roleEmployer === normalize(engagement.employer)) hasSimilarEmployer = true;
    if (roleRegulator && roleRegulator === normalize(engagement.regulator)) hasSimilarRegulator = true;
  }

  if (hasSimilarTitle) {
    boost += 10;
    reason ??= "Similar to roles you opened";
  }
  if (hasSimilarEmployer) {
    boost += 8;
    reason ??= "Similar to roles from employers you engaged with";
  }
  if (hasSimilarRegulator) {
    boost += 3;
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