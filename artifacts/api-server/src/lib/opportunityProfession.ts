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
  if (category === "FINANCE") return "UK finance career pathway";
  if (category === "IT") return "UK information technology pathway";
  if (category === "LEGAL") return "UK legal profession pathway";
  if (category === "ARCHITECTURE") return "Architects Registration Board pathway";
  if (category === "BUSINESS_DEVELOPMENT") return "UK business development pathway";
  if (category === "HOSPITALITY") return "UK hospitality career pathway";
  if (category === "CONSTRUCTION") return "UK construction career pathway";
  if (category === "MANUFACTURING") return "UK manufacturing career pathway";
  if (category === "RETAIL") return "UK retail career pathway";
  if (category === "HEALTHCARE_SUPPORT") return "UK healthcare support career pathway";
  if (category === "CARE_SUPPORT") return "UK care and support work pathway";
  if (category === "HEALTHCARE_CLINICAL") return "UK clinical and healthcare practitioner pathway";
  if (category === "RESEARCH_ACADEMIA") return "UK research and academic career pathway";
  if (category === "SCIENCE_LAB") return "UK science and laboratory career pathway";
  if (category === "PROJECT_PROGRAMME") return "UK project and programme management pathway";
  if (category === "OPERATIONS_MANAGEMENT") return "UK operations management pathway";
  if (category === "ADMINISTRATION") return "UK administration career pathway";
  if (category === "HR_RECRUITMENT") return "UK human resources and recruitment pathway";
  if (category === "MARKETING_COMMUNICATIONS") return "UK marketing and communications pathway";
  if (category === "SALES_ACCOUNT_MANAGEMENT") return "UK sales and account management pathway";
  if (category === "PROCUREMENT_SUPPLY_CHAIN") return "UK procurement and supply chain pathway";
  if (category === "FUNDRAISING_CHARITY") return "UK fundraising and charity career pathway";
  if (category === "PUBLIC_POLICY") return "UK public policy and public affairs pathway";
  if (category === "FACILITIES_MAINTENANCE") return "UK facilities and maintenance management pathway";
  if (category === "CUSTOMER_SERVICE") return "UK customer service career pathway";
  if (category === "TRANSPORT_LOGISTICS") return "UK transport and logistics pathway";
  if (category === "MEDIA_CREATIVE") return "UK media and creative career pathway";
  return `${category} registration pathway`;
}

export function isHealthcareRegulator(
  regulator: OpportunityRegulator,
): regulator is StatutoryRegulator {
  return statutoryRegulatorForCategory(regulator) !== null;
}
