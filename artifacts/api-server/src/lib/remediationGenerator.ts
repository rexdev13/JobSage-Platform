import type { DecisionRecord, RulesetRule } from "@workspace/db";

export interface RemediationStepDraft {
  stepOrder: number;
  title: string;
  description: string;
  gap: string;
  timelineRange: string | null;
  costRange: string | null;
  ruleId: number;
  rulesetVersion: string;
}

const RULE_REMEDIATION_MAP: Record<
  string,
  { title: string; gap: string; timelineRange: string | null; costRange: string | null }
> = {
  GMC_NOT_REGISTERED: {
    title: "Obtain English Language Qualification",
    gap: "No recognised GMC registration and no English language evidence",
    timelineRange: "3–6 months",
    costRange: "£150–£300 (IELTS / OET exam fees)",
  },
  GMC_NOT_REGISTERED_NOT_ENGLISH: {
    title: "Obtain English Language Qualification",
    gap: "No English language evidence for GMC registration",
    timelineRange: "3–6 months",
    costRange: "£150–£300 (IELTS / OET exam fees)",
  },
  GMC_IN_PROCESS: {
    title: "Complete GMC Registration Process",
    gap: "GMC registration still in progress",
    timelineRange: "2–6 months",
    costRange: "£465 (GMC initial registration fee)",
  },
  GMC_UNAPPROVED_COUNTRY: {
    title: "Apply via GMC PLAB Route",
    gap: "Qualification from a country not on the GMC approved list",
    timelineRange: "6–18 months",
    costRange: "£239 (PLAB 1) + £858 (PLAB 2)",
  },
  GMC_PLAB_ELIGIBLE: {
    title: "Complete PLAB Tests",
    gap: "Must pass PLAB 1 and PLAB 2 before GMC registration",
    timelineRange: "6–18 months",
    costRange: "£239 (PLAB 1) + £858 (PLAB 2)",
  },
  NMC_ENGLISH_LANGUAGE_REQUIRED: {
    title: "Obtain Nursing English Language Qualification",
    gap: "English language test not yet completed for NMC registration",
    timelineRange: "2–4 months",
    costRange: "£150–£300 (IELTS Academic or OET)",
  },
  NMC_REGISTRATION_IN_PROGRESS: {
    title: "Complete NMC Registration Application",
    gap: "NMC registration still in progress",
    timelineRange: "2–6 months",
    costRange: "£153 (NMC registration fee)",
  },
  NMC_QUALIFICATION_REQUIRES_ASSESSMENT: {
    title: "Apply for NMC Qualification Assessment",
    gap: "Nursing qualification requires NMC assessment",
    timelineRange: "6–12 months",
    costRange: "Variable (NMC assessment and adaptation programme)",
  },
  HCPC_ENGLISH_LANGUAGE_REQUIRED: {
    title: "Obtain AHP English Language Qualification",
    gap: "English language test not yet completed for HCPC registration",
    timelineRange: "2–4 months",
    costRange: "£150–£300 (IELTS Academic or OET)",
  },
  HCPC_REGISTRATION_IN_PROGRESS: {
    title: "Complete HCPC Registration Application",
    gap: "HCPC registration still in progress",
    timelineRange: "1–4 months",
    costRange: "£153–£250 (HCPC registration fee)",
  },
  HCPC_QUALIFICATION_REQUIRES_ASSESSMENT: {
    title: "Apply for HCPC Qualification Assessment",
    gap: "AHP qualification requires HCPC assessment",
    timelineRange: "6–12 months",
    costRange: "Variable (HCPC assessment)",
  },
};

const SPONSORSHIP_REMEDIATION = {
  title: "Obtain a Skilled Worker Visa Sponsorship",
  gap: "Requires UK visa sponsorship from a licensed employer",
  timelineRange: "4–12 weeks (once employer offer confirmed)",
  costRange: "£625–£1,423 (visa application fee, depending on duration)",
};

export function generateRemediationSteps(
  decisionRecord: DecisionRecord,
  matchedRule: RulesetRule | null,
  requiresSponsorship: boolean
): RemediationStepDraft[] {
  const steps: RemediationStepDraft[] = [];

  if (matchedRule) {
    const lookup = RULE_REMEDIATION_MAP[matchedRule.ruleKey];
    const template = lookup ?? {
      title: "Address Eligibility Gap",
      gap: `Unmet rule: ${matchedRule.ruleKey} — ${matchedRule.explanationText}`,
      timelineRange: null,
      costRange: null,
    };

    steps.push({
      stepOrder: 0,
      title: template.title,
      description: matchedRule.explanationText,
      gap: template.gap,
      timelineRange: template.timelineRange,
      costRange: template.costRange,
      ruleId: matchedRule.id,
      rulesetVersion: decisionRecord.rulesetVersion,
    });
  } else {
    steps.push({
      stepOrder: 0,
      title: "Seek Manual Assessment",
      description: decisionRecord.explanationText,
      gap: "Profile could not be matched to a deterministic eligibility rule",
      timelineRange: "5–10 working days (manual review)",
      costRange: null,
      ruleId: 0,
      rulesetVersion: decisionRecord.rulesetVersion,
    });
  }

  if (requiresSponsorship) {
    steps.push({
      stepOrder: steps.length,
      title: SPONSORSHIP_REMEDIATION.title,
      description:
        "You have indicated that you require UK visa sponsorship. Once you have achieved regulatory eligibility, you will need to secure a job offer from a UK employer licensed to sponsor Skilled Worker visas.",
      gap: SPONSORSHIP_REMEDIATION.gap,
      timelineRange: SPONSORSHIP_REMEDIATION.timelineRange,
      costRange: SPONSORSHIP_REMEDIATION.costRange,
      ruleId: 0,
      rulesetVersion: decisionRecord.rulesetVersion,
    });
  }

  return steps;
}
