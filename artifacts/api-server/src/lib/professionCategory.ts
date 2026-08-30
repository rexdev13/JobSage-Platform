/**
 * Candidate opportunity taxonomy.
 *
 * This is intentionally separate from statutory regulators. The roles and
 * employer-jobs tables still store GMC/NMC/HCPC only; categories such as
 * EDUCATION and ACCOUNTING describe the opportunity feed, not a regulator.
 */
export type StatutoryRegulator = "GMC" | "NMC" | "HCPC";

export type OpportunityCategory =
  | StatutoryRegulator
  | "DENTAL"
  | "PHARMACY"
  | "SOCIAL_WORK"
  | "EDUCATION"
  | "ENGINEERING"
  | "ACCOUNTING"
  | "IT"
  | "LEGAL"
  | "ARCHITECTURE";

const PROFESSION_CATEGORIES: Record<string, OpportunityCategory> = {
  doctor: "GMC",
  clinical_academic: "GMC",
  nurse: "NMC",
  midwife: "NMC",
  allied_health_professional: "HCPC",
  dentist: "DENTAL",
  dental: "DENTAL",
  pharmacist: "PHARMACY",
  pharmacy: "PHARMACY",
  optometrist: "HCPC",
  physiotherapist: "HCPC",
  radiographer: "HCPC",
  paramedic: "HCPC",
  occupational_therapist: "HCPC",
  social_worker: "SOCIAL_WORK",
  social_work: "SOCIAL_WORK",
  teacher: "EDUCATION",
  teaching: "EDUCATION",
  teacher_lecturer: "EDUCATION",
  lecturer: "EDUCATION",
  education: "EDUCATION",
  engineer: "ENGINEERING",
  engineering: "ENGINEERING",
  accountant: "ACCOUNTING",
  accounting: "ACCOUNTING",
  it_professional: "IT",
  it: "IT",
  lawyer: "LEGAL",
  solicitor: "LEGAL",
  lawyer_solicitor: "LEGAL",
  legal: "LEGAL",
  architect: "ARCHITECTURE",
  architecture: "ARCHITECTURE",
};

/**
 * Convert display, stored, machine, and common alias forms to one key.
 * In particular, "Teacher / Lecturer" becomes teacher_lecturer.
 */
export function normalizeProfession(profession: string | null | undefined): string {
  return (profession ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\/]+/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function professionCategoryFor(
  profession: string | null | undefined,
): OpportunityCategory | null {
  return PROFESSION_CATEGORIES[normalizeProfession(profession)] ?? null;
}

export function statutoryRegulatorForCategory(
  category: OpportunityCategory | string | null | undefined,
): StatutoryRegulator | null {
  return category === "GMC" || category === "NMC" || category === "HCPC" ? category : null;
}

export function categoryForStatutoryRegulator(
  regulator: string | null | undefined,
): OpportunityCategory | null {
  return statutoryRegulatorForCategory(regulator);
}

/**
 * IT and engineering overlap for software/technical engineering vacancies.
 * All other categories require an exact category match.
 */
export function opportunityCategoriesMatch(
  candidateCategory: OpportunityCategory | string | null | undefined,
  vacancyCategory: OpportunityCategory | string | null | undefined,
): boolean {
  if (!candidateCategory || !vacancyCategory) return false;
  if (candidateCategory === vacancyCategory) return true;
  return (
    (candidateCategory === "IT" && vacancyCategory === "ENGINEERING") ||
    (candidateCategory === "ENGINEERING" && vacancyCategory === "IT")
  );
}

export const ONBOARDING_PROFESSIONS = [
  "Doctor",
  "Nurse",
  "Midwife",
  "Allied Health Professional",
  "Clinical Academic",
  "Dentist",
  "Pharmacist",
  "Optometrist",
  "Physiotherapist",
  "Radiographer",
  "Paramedic",
  "Occupational Therapist",
  "Social Worker",
  "Teacher / Lecturer",
  "Engineer",
  "Accountant",
  "IT Professional",
  "Lawyer / Solicitor",
  "Architect",
] as const;