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

export type ProfessionSector =
  | "Healthcare and Social Care"
  | "Education and Research"
  | "Engineering, Construction and Manufacturing"
  | "Finance and Professional Services"
  | "Technology"
  | "Business and Operations"
  | "Charity and Public Service"
  | "Hospitality and Retail"
  | "Transport and Logistics"
  | "Media and Creative";

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
  { label: "Doctor", category: "GMC", sector: "Healthcare and Social Care", aliases: ["clinical academic"], regulator: "GMC" },
  { label: "Nurse", category: "NMC", sector: "Healthcare and Social Care", aliases: ["registered nurse"], regulator: "NMC" },
  { label: "Midwife", category: "NMC", sector: "Healthcare and Social Care", aliases: [], regulator: "NMC" },
  { label: "Allied Health Professional", category: "HCPC", sector: "Healthcare and Social Care", aliases: ["physiotherapist", "radiographer", "paramedic", "occupational therapist", "optometrist"], regulator: "HCPC" },
  { label: "Dentist / Dental Professional", category: "DENTAL", sector: "Healthcare and Social Care", aliases: ["dentist", "dental"], regulator: null },
  { label: "Pharmacist / Pharmacy Professional", category: "PHARMACY", sector: "Healthcare and Social Care", aliases: ["pharmacist", "pharmacy"], regulator: null },
  { label: "Social Worker", category: "SOCIAL_WORK", sector: "Healthcare and Social Care", aliases: ["social work"], regulator: null },
  { label: "Healthcare Support", category: "HEALTHCARE_SUPPORT", sector: "Healthcare and Social Care", aliases: ["healthcare assistant", "health care assistant", "clinical support"], regulator: null },
  { label: "Care / Support Work", category: "CARE_SUPPORT", sector: "Healthcare and Social Care", aliases: ["care assistant", "care worker", "residential support worker"], regulator: null },
  { label: "Clinical / Healthcare Practitioner", category: "HEALTHCARE_CLINICAL", sector: "Healthcare and Social Care", aliases: ["clinical practitioner", "healthcare practitioner", "assistant psychologist"], regulator: null },

  { label: "Teacher / Lecturer", category: "EDUCATION", sector: "Education and Research", aliases: ["teacher", "teaching", "lecturer", "education"], regulator: null },
  { label: "Research / Academia", category: "RESEARCH_ACADEMIA", sector: "Education and Research", aliases: ["academic research", "researcher", "postdoctoral researcher"], regulator: null },

  { label: "Engineer", category: "ENGINEERING", sector: "Engineering, Construction and Manufacturing", aliases: ["engineering"], regulator: null },
  { label: "Architect", category: "ARCHITECTURE", sector: "Engineering, Construction and Manufacturing", aliases: ["architecture"], regulator: null },
  { label: "Construction Professional", category: "CONSTRUCTION", sector: "Engineering, Construction and Manufacturing", aliases: ["construction"], regulator: null },
  { label: "Manufacturing Professional", category: "MANUFACTURING", sector: "Engineering, Construction and Manufacturing", aliases: ["manufacturing"], regulator: null },
  { label: "Science / Laboratory Professional", category: "SCIENCE_LAB", sector: "Engineering, Construction and Manufacturing", aliases: ["laboratory professional", "scientist"], regulator: null },

  { label: "Accountant / Auditor", category: "ACCOUNTING", sector: "Finance and Professional Services", aliases: ["accountant", "accounting", "auditor"], regulator: null },
  { label: "Finance Professional", category: "FINANCE", sector: "Finance and Professional Services", aliases: ["finance"], regulator: null },
  { label: "Lawyer / Solicitor", category: "LEGAL", sector: "Finance and Professional Services", aliases: ["lawyer", "solicitor", "legal"], regulator: null },

  { label: "IT Professional", category: "IT", sector: "Technology", aliases: ["it", "technology professional"], regulator: null },
  { label: "Software Engineering", category: "IT", sector: "Technology", aliases: ["software engineer", "software developer"], regulator: null },

  { label: "Business Development", category: "BUSINESS_DEVELOPMENT", sector: "Business and Operations", aliases: ["business development manager"], regulator: null },
  { label: "Project / Programme Management", category: "PROJECT_PROGRAMME", sector: "Business and Operations", aliases: ["project manager", "programme manager", "program manager"], regulator: null },
  { label: "Operations Management", category: "OPERATIONS_MANAGEMENT", sector: "Business and Operations", aliases: ["operations manager", "service manager"], regulator: null },
  { label: "Administration", category: "ADMINISTRATION", sector: "Business and Operations", aliases: ["administrator", "administrative professional"], regulator: null },
  { label: "Human Resources / Recruitment", category: "HR_RECRUITMENT", sector: "Business and Operations", aliases: ["human resources", "hr professional", "recruitment"], regulator: null },
  { label: "Marketing / Communications", category: "MARKETING_COMMUNICATIONS", sector: "Business and Operations", aliases: ["marketing", "communications", "public relations"], regulator: null },
  { label: "Sales / Account Management", category: "SALES_ACCOUNT_MANAGEMENT", sector: "Business and Operations", aliases: ["sales professional", "account manager"], regulator: null },
  { label: "Procurement / Supply Chain", category: "PROCUREMENT_SUPPLY_CHAIN", sector: "Business and Operations", aliases: ["procurement", "supply chain", "purchasing"], regulator: null },
  { label: "Customer Service", category: "CUSTOMER_SERVICE", sector: "Business and Operations", aliases: ["customer support"], regulator: null },

  { label: "Fundraising / Charity", category: "FUNDRAISING_CHARITY", sector: "Charity and Public Service", aliases: ["fundraising", "charity professional"], regulator: null },
  { label: "Public Policy / Public Affairs", category: "PUBLIC_POLICY", sector: "Charity and Public Service", aliases: ["public policy", "public affairs", "policy professional"], regulator: null },

  { label: "Hospitality Management", category: "HOSPITALITY", sector: "Hospitality and Retail", aliases: ["hospitality"], regulator: null },
  { label: "Retail Management", category: "RETAIL", sector: "Hospitality and Retail", aliases: ["retail"], regulator: null },
  { label: "Facilities / Maintenance Management", category: "FACILITIES_MAINTENANCE", sector: "Hospitality and Retail", aliases: ["facilities management", "maintenance management"], regulator: null },

  { label: "Transport / Logistics", category: "TRANSPORT_LOGISTICS", sector: "Transport and Logistics", aliases: ["transport", "logistics"], regulator: null },
  { label: "Media / Creative", category: "MEDIA_CREATIVE", sector: "Media and Creative", aliases: ["media", "creative professional"], regulator: null },
] as const;

export const PROFESSION_OPTIONS = PROFESSION_CATALOG.map((entry) => entry.label);

function normalizeProfessionValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\/]+/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
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
