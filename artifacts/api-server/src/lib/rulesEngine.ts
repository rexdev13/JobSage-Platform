import type { RuleCondition, RulesetRule } from "@workspace/db";
import type { Profile } from "@workspace/db";

export type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible" | "review";

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

function isAmbiguous(profile: Profile): { flagged: boolean; note: string | null } {
  const missing: string[] = [];
  if (!profile.qualificationCountry) missing.push("qualification country");
  if (!profile.qualificationType) missing.push("qualification type");
  if (!profile.registrationStatus) missing.push("registration status");
  if (!profile.residencyStatus) missing.push("residency status");

  if (missing.length > 0) {
    return {
      flagged: true,
      note: `Missing required fields for deterministic evaluation: ${missing.join(", ")}. A human reviewer will assess your case.`,
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
  const ambiguity = isAmbiguous(profile);

  const sortedRules = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const rule of sortedRules) {
    if (evaluateRule(rule, profile)) {
      return {
        outcome: rule.outcome as EligibilityOutcome,
        reasonCodes: [rule.reasonCode],
        explanationText: rule.explanationText,
        pathways: rule.pathways ?? [],
        matchedRuleKey: rule.ruleKey,
        reviewFlagged: ambiguity.flagged || rule.outcome === "review",
        reviewNote: ambiguity.note,
      };
    }
  }

  return {
    outcome: "review",
    reasonCodes: ["NO_RULE_MATCHED"],
    explanationText:
      "Your profile did not match any deterministic eligibility rule. A clinical reviewer will assess your case and contact you within 5 working days.",
    pathways: [],
    matchedRuleKey: null,
    reviewFlagged: true,
    reviewNote:
      ambiguity.note ??
      "No rule matched the provided profile — manual review required.",
  };
}
