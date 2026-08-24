import type { Profile } from "@workspace/db";

export const DBS_CLEARANCE_LEVELS = ["unknown", "none", "basic", "standard", "enhanced"] as const;
export const SAFEGUARDING_TRAINING_LEVELS = ["unknown", "none", "level_1", "level_2"] as const;

export type DbsClearanceLevel = (typeof DBS_CLEARANCE_LEVELS)[number];
export type SafeguardingTrainingLevel = (typeof SAFEGUARDING_TRAINING_LEVELS)[number];
export type SafeguardingStatus = "unknown" | "unknown_needs_profile" | "missing" | "met";

export interface SafeguardingAssessment {
  requiredDbsClearanceLevel: DbsClearanceLevel | null;
  requiredSafeguardingLevel: SafeguardingTrainingLevel | null;
  dbsStatus: SafeguardingStatus;
  safeguardingStatus: SafeguardingStatus;
}

const DBS_ORDER: Record<Exclude<DbsClearanceLevel, "unknown">, number> = {
  none: 0,
  basic: 1,
  standard: 2,
  enhanced: 3,
};

const SAFEGUARDING_ORDER: Record<Exclude<SafeguardingTrainingLevel, "unknown">, number> = {
  none: 0,
  level_1: 1,
  level_2: 2,
};

function compareLevel<T extends string>(
  candidate: T | null | undefined,
  required: T | null | undefined,
  order: Record<Exclude<T, "unknown">, number>,
): SafeguardingStatus {
  // Role requirements are nullable; historical/imported data can also contain
  // "unknown". Both mean the employer did not state a requirement.
  if (required == null || required === "unknown") return "unknown";
  if (candidate == null || candidate === "unknown") return "unknown_needs_profile";
  return order[candidate as Exclude<T, "unknown">] >= order[required as Exclude<T, "unknown">]
    ? "met"
    : "missing";
}

export function assessSafeguarding(
  profile: Pick<Profile, "dbsClearanceLevel" | "safeguardingTrainingLevel">,
  requirements: Pick<SafeguardingAssessment, "requiredDbsClearanceLevel" | "requiredSafeguardingLevel">,
): SafeguardingAssessment {
  return {
    requiredDbsClearanceLevel: requirements.requiredDbsClearanceLevel ?? null,
    requiredSafeguardingLevel: requirements.requiredSafeguardingLevel ?? null,
    dbsStatus: compareLevel(profile.dbsClearanceLevel, requirements.requiredDbsClearanceLevel, DBS_ORDER),
    safeguardingStatus: compareLevel(
      profile.safeguardingTrainingLevel,
      requirements.requiredSafeguardingLevel,
      SAFEGUARDING_ORDER,
    ),
  };
}

export function safeguardingBlocksEligibility(assessment: SafeguardingAssessment): boolean {
  return [assessment.dbsStatus, assessment.safeguardingStatus].some(
    (status) => status === "missing" || status === "unknown_needs_profile",
  );
}

export function safeguardingGapText(
  assessment: SafeguardingAssessment,
  candidate: Pick<Profile, "dbsClearanceLevel" | "safeguardingTrainingLevel">,
): string[] {
  const gaps: string[] = [];
  if (assessment.dbsStatus === "missing") {
    gaps.push(
      `This role requires ${assessment.requiredDbsClearanceLevel} DBS clearance. Your current profile level is ${candidate.dbsClearanceLevel ?? "unknown"}.`,
    );
  } else if (assessment.dbsStatus === "unknown_needs_profile") {
    gaps.push("This role states a DBS requirement. Add your DBS clearance level to your profile.");
  }
  if (assessment.safeguardingStatus === "missing") {
    gaps.push(
      `This role requires safeguarding training ${assessment.requiredSafeguardingLevel?.replace("_", " ")}. Your current profile level is ${candidate.safeguardingTrainingLevel ?? "unknown"}.`,
    );
  } else if (assessment.safeguardingStatus === "unknown_needs_profile") {
    gaps.push("This role states a safeguarding requirement. Add your safeguarding training level to your profile.");
  }
  return gaps;
}