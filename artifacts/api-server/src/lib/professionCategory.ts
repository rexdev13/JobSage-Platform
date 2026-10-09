/** Candidate opportunity taxonomy, shared with every frontend profession form. */
import {
  PROFESSION_CATALOG,
  PROFESSION_OPTIONS,
  type OpportunityCategory,
  type StatutoryRegulator,
} from "@workspace/api-zod/profession-catalog";

export type { OpportunityCategory, StatutoryRegulator };

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

const PROFESSION_CATEGORIES = new Map<string, OpportunityCategory>();
for (const entry of PROFESSION_CATALOG) {
  for (const value of [entry.label, ...entry.aliases]) {
    PROFESSION_CATEGORIES.set(normalizeProfession(value), entry.category);
  }
}

export function professionCategoryFor(
  profession: string | null | undefined,
): OpportunityCategory | null {
  return PROFESSION_CATEGORIES.get(normalizeProfession(profession)) ?? null;
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

export const ONBOARDING_PROFESSIONS = PROFESSION_OPTIONS;
