import type { CanonicalSector } from "./sectorCatalog";

export const OPPORTUNITY_CATEGORIES = [
  "GMC",
  "NMC",
  "HCPC",
  "DENTAL",
  "PHARMACY",
  "SOCIAL_WORK",
  "HEALTHCARE_SUPPORT",
  "CARE_SUPPORT",
  "HEALTHCARE_CLINICAL",
  "EDUCATION",
  "RESEARCH_ACADEMIA",
  "ENGINEERING",
  "SCIENCE_LAB",
  "ACCOUNTING",
  "FINANCE",
  "IT",
  "LEGAL",
  "ARCHITECTURE",
  "BUSINESS_DEVELOPMENT",
  "PROJECT_PROGRAMME",
  "OPERATIONS_MANAGEMENT",
  "ADMINISTRATION",
  "HR_RECRUITMENT",
  "MARKETING_COMMUNICATIONS",
  "SALES_ACCOUNT_MANAGEMENT",
  "PROCUREMENT_SUPPLY_CHAIN",
  "FUNDRAISING_CHARITY",
  "PUBLIC_POLICY",
  "HOSPITALITY",
  "CONSTRUCTION",
  "MANUFACTURING",
  "RETAIL",
  "FACILITIES_MAINTENANCE",
  "CUSTOMER_SERVICE",
  "TRANSPORT_LOGISTICS",
  "MEDIA_CREATIVE",
] as const;

export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];
export type StatutoryRegulator = "GMC" | "NMC" | "HCPC";

export type ProfessionSector = CanonicalSector;

export interface ProfessionCatalogEntry {
  label: string;
  category: OpportunityCategory;
  sector: ProfessionSector;
  aliases: readonly string[];
  regulator: StatutoryRegulator | null;
}

/**
 * Single candidate profession catalogue shared by the API and every web form.
 * Aliases preserve existing stored profile values while labels drive dropdowns.
 */
export const PROFESSION_CATALOG: readonly ProfessionCatalogEntry[] = [
  { label: "Doctor", category: "GMC", sector: "healthcare", aliases: ["clinical academic"], regulator: "GMC" },
  { label: "Nurse", category: "NMC", sector: "healthcare", aliases: ["registered nurse"], regulator: "NMC" },
  { label: "Midwife", category: "NMC", sector: "healthcare", aliases: [], regulator: "NMC" },
  { label: "Allied Health Professional", category: "HCPC", sector: "healthcare", aliases: ["physiotherapist", "radiographer", "paramedic", "occupational therapist", "optometrist"], regulator: "HCPC" },
  { label: "Dentist / Dental Professional", category: "DENTAL", sector: "healthcare", aliases: ["dentist", "dental"], regulator: null },
  { label: "Pharmacist / Pharmacy Professional", category: "PHARMACY", sector: "healthcare", aliases: ["pharmacist", "pharmacy"], regulator: null },
  { label: "Social Worker", category: "SOCIAL_WORK", sector: "healthcare", aliases: ["social work"], regulator: null },
  { label: "Healthcare Support", category: "HEALTHCARE_SUPPORT", sector: "healthcare", aliases: ["healthcare assistant", "health care assistant", "clinical support"], regulator: null },
  { label: "Care / Support Work", category: "CARE_SUPPORT", sector: "healthcare", aliases: ["care assistant", "care worker", "residential support worker"], regulator: null },
  { label: "Clinical / Healthcare Practitioner", category: "HEALTHCARE_CLINICAL", sector: "healthcare", aliases: ["clinical practitioner", "healthcare practitioner", "assistant psychologist"], regulator: null },

  { label: "Teacher / Lecturer", category: "EDUCATION", sector: "education", aliases: ["teacher", "teaching", "lecturer", "education"], regulator: null },
  { label: "Research / Academia", category: "RESEARCH_ACADEMIA", sector: "education", aliases: ["academic research", "researcher", "postdoctoral researcher"], regulator: null },

  { label: "Engineer", category: "ENGINEERING", sector: "engineering", aliases: ["engineering"], regulator: null },
  { label: "Architect", category: "ARCHITECTURE", sector: "architecture", aliases: ["architecture"], regulator: null },
  { label: "Construction Professional", category: "CONSTRUCTION", sector: "engineering", aliases: ["construction"], regulator: null },
  { label: "Manufacturing Professional", category: "MANUFACTURING", sector: "engineering", aliases: ["manufacturing"], regulator: null },
  { label: "Science / Laboratory Professional", category: "SCIENCE_LAB", sector: "engineering", aliases: ["laboratory professional", "scientist"], regulator: null },

  { label: "Accountant / Auditor", category: "ACCOUNTING", sector: "accounting", aliases: ["accountant", "accounting", "auditor"], regulator: null },
  { label: "Finance Professional", category: "FINANCE", sector: "accounting", aliases: ["finance"], regulator: null },
  { label: "Lawyer / Solicitor", category: "LEGAL", sector: "legal", aliases: ["lawyer", "solicitor", "legal"], regulator: null },

  { label: "IT Professional", category: "IT", sector: "it", aliases: ["it", "technology professional"], regulator: null },
  { label: "Software Engineering", category: "IT", sector: "it", aliases: ["software engineer", "software developer"], regulator: null },

  { label: "Business Development", category: "BUSINESS_DEVELOPMENT", sector: "business_development", aliases: ["business development manager"], regulator: null },
  { label: "Project / Programme Management", category: "PROJECT_PROGRAMME", sector: "business_development", aliases: ["project manager", "programme manager", "program manager"], regulator: null },
  { label: "Operations Management", category: "OPERATIONS_MANAGEMENT", sector: "business_development", aliases: ["operations manager", "service manager"], regulator: null },
  { label: "Administration", category: "ADMINISTRATION", sector: "business_development", aliases: ["administrator", "administrative professional"], regulator: null },
  { label: "Human Resources / Recruitment", category: "HR_RECRUITMENT", sector: "business_development", aliases: ["human resources", "hr professional", "recruitment"], regulator: null },
  { label: "Marketing / Communications", category: "MARKETING_COMMUNICATIONS", sector: "business_development", aliases: ["marketing", "communications", "public relations"], regulator: null },
  { label: "Sales / Account Management", category: "SALES_ACCOUNT_MANAGEMENT", sector: "business_development", aliases: ["sales professional", "account manager"], regulator: null },
  { label: "Procurement / Supply Chain", category: "PROCUREMENT_SUPPLY_CHAIN", sector: "business_development", aliases: ["procurement", "supply chain", "purchasing"], regulator: null },
  { label: "Customer Service", category: "CUSTOMER_SERVICE", sector: "business_development", aliases: ["customer support"], regulator: null },

  { label: "Fundraising / Charity", category: "FUNDRAISING_CHARITY", sector: "business_development", aliases: ["fundraising", "charity professional"], regulator: null },
  { label: "Public Policy / Public Affairs", category: "PUBLIC_POLICY", sector: "business_development", aliases: ["public policy", "public affairs", "policy professional"], regulator: null },

  { label: "Hospitality Management", category: "HOSPITALITY", sector: "business_development", aliases: ["hospitality"], regulator: null },
  { label: "Retail Management", category: "RETAIL", sector: "business_development", aliases: ["retail"], regulator: null },
  { label: "Facilities / Maintenance Management", category: "FACILITIES_MAINTENANCE", sector: "business_development", aliases: ["facilities management", "maintenance management"], regulator: null },

  { label: "Transport / Logistics", category: "TRANSPORT_LOGISTICS", sector: "business_development", aliases: ["transport", "logistics"], regulator: null },
  { label: "Media / Creative", category: "MEDIA_CREATIVE", sector: "business_development", aliases: ["media", "creative professional"], regulator: null },
] as const;

export const PROFESSION_OPTIONS = PROFESSION_CATALOG.map((entry) => entry.label);

const UK_REGULATED_PROFESSION_KEYWORDS = [
  "doctor",
  "nurse",
  "midwife",
  "dentist",
  "pharmacist",
  "optometrist",
  "physiotherapist",
  "radiographer",
  "paramedic",
  "occupational therapist",
  "allied health",
  "clinical academic",
  "social worker",
];

function normalizeProfessionValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\/]+/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function professionRequiresUkRegistration(profession: string): boolean {
  const normalized = normalizeProfessionValue(profession);
  return UK_REGULATED_PROFESSION_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeProfessionValue(keyword)),
  );
}

const CANONICAL_PROFESSION_LABELS = new Map<string, string>();
for (const entry of PROFESSION_CATALOG) {
  for (const value of [entry.label, ...entry.aliases]) {
    CANONICAL_PROFESSION_LABELS.set(normalizeProfessionValue(value), entry.label);
  }
}

export function canonicalProfessionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return CANONICAL_PROFESSION_LABELS.get(normalizeProfessionValue(value)) ?? null;
}

export function canonicalSectorForProfession(value: string | null | undefined): CanonicalSector | null {
  const label = canonicalProfessionLabel(value);
  if (!label) return null;
  return PROFESSION_CATALOG.find((entry) => entry.label === label)?.sector ?? null;
}

export function canonicalSectorForCategory(value: string | null | undefined): CanonicalSector | null {
  if (!value) return null;
  return PROFESSION_CATALOG.find((entry) => entry.category === value)?.sector ?? null;
}
