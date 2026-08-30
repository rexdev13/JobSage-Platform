import {
  categoryForStatutoryRegulator,
  opportunityCategoriesMatch,
  professionCategoryFor,
  statutoryRegulatorForCategory,
  type OpportunityCategory,
  type StatutoryRegulator,
} from "./professionCategory";

/** @deprecated Use OpportunityCategory; retained for existing feed callers. */
export type OpportunityRegulator = OpportunityCategory;
export type { OpportunityCategory, StatutoryRegulator };

/** Compatibility name for older callers; this now returns the opportunity category. */
export const regulatorForProfession = professionCategoryFor;
export {
  categoryForStatutoryRegulator,
  opportunityCategoriesMatch,
  professionCategoryFor,
  statutoryRegulatorForCategory,
};

export function opportunityRegistrationLabel(category: OpportunityCategory): string {
  if (category === "EDUCATION") return "Qualified Teacher Status pathway";
  if (category === "ENGINEERING") return "UK professional engineering pathway";
  if (category === "DENTAL") return "General Dental Council pathway";
  if (category === "PHARMACY") return "General Pharmaceutical Council pathway";
  if (category === "SOCIAL_WORK") return "Social Work England pathway";
  if (category === "ACCOUNTING") return "UK professional accounting pathway";
  if (category === "IT") return "UK information technology pathway";
  if (category === "LEGAL") return "UK legal profession pathway";
  if (category === "ARCHITECTURE") return "Architects Registration Board pathway";
  return `${category} registration pathway`;
}

export function isHealthcareRegulator(
  regulator: OpportunityRegulator,
): regulator is StatutoryRegulator {
  return statutoryRegulatorForCategory(regulator) !== null;
}