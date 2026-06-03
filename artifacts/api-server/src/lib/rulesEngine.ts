import type { RuleCondition, RulesetRule } from "@workspace/db";
import type { Profile } from "@workspace/db";

export type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible";

export interface EvaluationInput {
  profile: Profile;
}

export interface EvaluationResult {
  outcome: EligibilityOutcome;
  reasonCodes: string[];
  explanationText: string;
  pathways: string[];
  matchedRuleKey: string | null;
  reviewFlagged: boolean;
  reviewNote: string | null;
}

const KNOWN_QUALIFICATION_COUNTRIES = new Set([
  "United Kingdom",
  "Ireland",
  "Australia",
  "Canada",
  "New Zealand",
  "South Africa",
  "United States",
  "India",
  "Pakistan",
  "Nigeria",
  "Ghana",
  "Zimbabwe",
  "Zambia",
  "Jamaica",
  "Trinidad and Tobago",
  "Barbados",
  "Singapore",
  "Hong Kong",
  "Malta",
  "Cyprus",
]);

function detectAmbiguity(profile: Profile): { flagged: boolean; note: string | null } {
  const reasons: string[] = [];

  const missing: string[] = [];
  if (!profile.qualificationCountry) missing.push("qualification country");
  if (!profile.qualificationType) missing.push("qualification type");
  if (!profile.registrationStatus) missing.push("registration status");
  if (!profile.residencyStatus) missing.push("residency status");

  if (missing.length > 0) {
    reasons.push(`missing required fields: ${missing.join(", ")}`);
  }

  if (
    profile.qualificationCountry &&
    !KNOWN_QUALIFICATION_COUNTRIES.has(profile.qualificationCountry)
  ) {
    reasons.push(
      `qualification country "${profile.qualificationCountry}" is not within the standard approved list and requires manual assessment`
    );
  }

  if (reasons.length > 0) {
    return {
      flagged: true,
      note: `This case has been flagged for human review due to: ${reasons.join("; ")}. A JOBSAGE adviser will assess your case and contact you within 2–3 working days.`,
    };
  }
  return { flagged: false, note: null };
}

function evaluateCondition(condition: RuleCondition, profile: Profile): boolean {
  const fieldValue = (profile as Record<string, unknown>)[condition.field];

  switch (condition.operator) {
    case "eq":
      return fieldValue === condition.value;

    case "neq":
      return fieldValue !== condition.value;

    case "in": {
      if (!Array.isArray(condition.value)) return false;
      return condition.value.includes(fieldValue);
    }

    case "not_in": {
      if (!Array.isArray(condition.value)) return false;
      return !condition.value.includes(fieldValue);
    }

    case "gte": {
      if (typeof fieldValue !== "number" || typeof condition.value !== "number") return false;
      return fieldValue >= condition.value;
    }

    case "lte": {
      if (typeof fieldValue !== "number" || typeof condition.value !== "number") return false;
      return fieldValue <= condition.value;
    }

    case "exists":
      return fieldValue !== null && fieldValue !== undefined;

    default:
      return false;
  }
}

function evaluateRule(rule: RulesetRule, profile: Profile): boolean {
  return rule.conditions.every((condition) => evaluateCondition(condition, profile));
}

export function evaluate(profile: Profile, rules: RulesetRule[]): EvaluationResult {
  const ambiguity = detectAmbiguity(profile);

  const sortedRules = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const rule of sortedRules) {
    if (evaluateRule(rule, profile)) {
      const outcome = rule.outcome as EligibilityOutcome;
      return {
        outcome,
        reasonCodes: [rule.reasonCode],
        explanationText: rule.explanationText,
        pathways: rule.pathways ?? [],
        matchedRuleKey: rule.ruleKey,
        reviewFlagged: ambiguity.flagged,
        reviewNote: ambiguity.note,
      };
    }
  }

  return {
    outcome: "not_eligible",
    reasonCodes: ["NO_RULE_MATCHED"],
    explanationText:
      "Your profile did not match any deterministic eligibility rule. A JOBSAGE adviser will assess your case and contact you within 2–3 working days.",
    pathways: [],
    matchedRuleKey: null,
    reviewFlagged: true,
    reviewNote:
      ambiguity.note ??
      "No rule matched the provided profile — manual review required.",
  };
}
