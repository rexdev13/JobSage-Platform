import type { Role } from "@workspace/db";

export type SponsorshipFeasibilityOutcome = "feasible" | "not_feasible" | "uncertain";

export interface SponsorshipFeasibilityResult {
  roleId: number;
  outcome: SponsorshipFeasibilityOutcome;
  reasonCode: string;
  explanation: string;
  disclaimer: string;
}

const DISCLAIMER =
  "This assessment is based solely on the role's declared sponsorship information and the candidate's stated requirements. It is not a guarantee of sponsorship and does not constitute an offer of employment or visa sponsorship. Sponsorship decisions are made solely by the employing organisation.";

export function assessSponsorshipFeasibility(
  role: Role & { sponsorshipStatus?: "confirmed" | "not_offered" | "unknown" },
  requiresSponsorship: boolean
): SponsorshipFeasibilityResult {
  if (!requiresSponsorship) {
    return {
      roleId: role.id,
      outcome: "uncertain",
      reasonCode: "SPONSORSHIP_NOT_REQUIRED",
      explanation:
        "You have not indicated that you require visa sponsorship. Sponsorship eligibility is not assessed.",
      disclaimer: DISCLAIMER,
    };
  }

  if (role.sponsorshipOffered) {
    return {
      roleId: role.id,
      outcome: "feasible",
      reasonCode: "SPONSORSHIP_OFFERED",
      explanation:
        "This employer has indicated they offer visa sponsorship. Your requirement for sponsorship is likely compatible with this role.",
      disclaimer: DISCLAIMER,
    };
  }

  if (role.sponsorshipStatus === "unknown") {
    return {
      roleId: role.id,
      outcome: "uncertain",
      reasonCode: "SPONSORSHIP_UNCONFIRMED",
      explanation:
        "This employer is licensed to sponsor workers, but this vacancy does not explicitly confirm that sponsorship is available.",
      disclaimer: DISCLAIMER,
    };
  }

  return {
    roleId: role.id,
    outcome: "not_feasible",
    reasonCode: "SPONSORSHIP_NOT_OFFERED",
    explanation:
      "This employer has indicated they do not offer visa sponsorship. As you require sponsorship, this role may not be suitable for you.",
    disclaimer: DISCLAIMER,
  };
}
