export type OpportunityRegulator =
  | "GMC"
  | "NMC"
  | "HCPC"
  | "EDUCATION"
  | "ENGINEERING";

/**
 * One mapping shared by catalogue roles, sponsor-vacancy roles, matched roles,
 * and alerts. EDUCATION and ENGINEERING are opportunity categories rather
 * than statutory healthcare regulators, but use the existing field so both
 * board and company-site sources flow through the same candidate pipeline.
 */
export function regulatorForProfession(
  profession: string | null | undefined,
): OpportunityRegulator | null {
  const value = profession?.toLowerCase().trim() ?? "";
  const normalized = value.replace(/[\s-]+/g, "_");
  if (normalized === "doctor" || normalized === "clinical_academic") return "GMC";
  if (normalized === "nurse" || normalized === "midwife") return "NMC";
  if (normalized === "allied_health_professional") return "HCPC";
  if (normalized === "teacher" || normalized === "teaching") return "EDUCATION";
  if (normalized === "engineer" || normalized === "engineering") return "ENGINEERING";
  return null;
}

export function opportunityRegistrationLabel(regulator: OpportunityRegulator): string {
  if (regulator === "EDUCATION") return "Qualified Teacher Status pathway";
  if (regulator === "ENGINEERING") return "UK professional engineering pathway";
  return `${regulator} registration pathway`;
}

export function isHealthcareRegulator(
  regulator: OpportunityRegulator,
): regulator is Extract<OpportunityRegulator, "GMC" | "NMC" | "HCPC"> {
  return regulator === "GMC" || regulator === "NMC" || regulator === "HCPC";
}