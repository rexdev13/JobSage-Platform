import { db } from "@workspace/db";
import { sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { isValidVacancyUrlForSource } from "./vacancyUrlPolicy";
import { getCandidateVacancyStatus } from "./vacancyLiveness";
import type { DbsClearanceLevel, SafeguardingTrainingLevel } from "./safeguarding";
import { regionsFromLocationText } from "./regionMatching";
import {
  getVacancyLinkStatus,
  vacancyVisibilityWindowMs,
  type VacancyLinkStatus,
} from "./vacancyLiveness";
import {
  opportunityRegistrationLabel,
} from "./opportunityProfession";
import {
  opportunityCategoriesMatch,
  statutoryRegulatorForCategory,
  type OpportunityCategory,
  type StatutoryRegulator,
} from "./professionCategory";

/**
 * ID offset for AI-discovered sponsor-licence vacancies when merged into the
 * candidate-facing roles list. Keeps them in their own id space:
 *   roles:            1 .. 1,000,000
 *   employer jobs:    1,000,001 .. 2,000,000  (jobListings.id + 1,000,000)
 *   sponsor vacancies: > 2,000,000            (sponsor_licence_vacancies.id + 2,000,000)
 */
export const EMPLOYER_JOB_ID_OFFSET = 1_000_000;
export const SPONSOR_VACANCY_ID_OFFSET = 2_000_000;

/** Whether a candidate-facing unified role ID belongs to a sponsor vacancy. */
export function isSponsorVacancyRoleId(roleId: number): boolean {
  return roleId > SPONSOR_VACANCY_ID_OFFSET;
}

/**
 * Converts a candidate-facing sponsor vacancy role ID to its persisted vacancy
 * ID. Returning null keeps callers from accidentally querying this source for
 * catalogue roles or employer jobs.
 */
export function sponsorVacancyIdFromRoleId(roleId: number): number | null {
  return isSponsorVacancyRoleId(roleId) ? roleId - SPONSOR_VACANCY_ID_OFFSET : null;
}

/** Whether a candidate-facing unified role ID belongs to an employer job listing. */
export function isEmployerJobRoleId(roleId: number): boolean {
  return roleId > EMPLOYER_JOB_ID_OFFSET && roleId <= SPONSOR_VACANCY_ID_OFFSET;
}

export function employerJobIdFromRoleId(roleId: number): number | null {
  return isEmployerJobRoleId(roleId) ? roleId - EMPLOYER_JOB_ID_OFFSET : null;
}

/**
 * Candidate-facing apply-link presentation preserves stored URL evidence.
 * Product actions use linkStatus; dead evidence must never collapse to "none".
 */
export function presentApplyLink(
  applyUrl: string | null | undefined,
  liveness: string | null | undefined,
  lastVerifiedAt: Date | null | undefined,
  livenessReason?: string | null,
  sourceType?: "job_board" | "company_site" | null,
): { applyUrl: string | null; linkStatus: VacancyLinkStatus; linkVerified: boolean; linkCheckedAt: string | null } {
  const url = applyUrl?.trim() || null;
  const linkStatus = getVacancyLinkStatus(
    url,
    liveness,
    lastVerifiedAt,
    livenessReason,
    vacancyVisibilityWindowMs(sourceType),
  );
  return {
    applyUrl: url,
    linkStatus,
    linkVerified: linkStatus === "live",
    linkCheckedAt: lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : null,
  };
}

const NMC_TITLE_PATTERN =
  /\b(nurs(?:e|es|ing)\b|midwif|health\s*visitor|rgn\b|rmn\b|rnld\b|matron|ward\s*sister)/i;

// These titles contain nursing words but target a different profession, a
// support-grade role, or editorial content rather than an NMC vacancy.
const DENTAL_NURSE_TITLE_PATTERN = /\bdental\s+nurs(?:e|es|ing)\b/i;
const PHARMACIST_TITLE_PATTERN = /\bpharmacist\b/i;
const NURSING_SUPPORT_TITLE_PATTERN =
  /\b(?:(?:nursing|health\s*care|healthcare|clinical|maternity|theatre|mental\s+health)\s+(?:assistant|support\s*(?:worker|assistant))|hca\b|care\s+(?:co-?ordinator|navigator)|patient\s+care\s+assistant|rehabilitation\s+assistant|newborn\s+hearing\s+screener|nhs\s*111\s+health\s+advisor|ward\s+clerk|medical\s+(?:receptionist|secretary)|decontamination\s+technician)\b/i;
const NON_VACANCY_CONTENT_TITLE_PATTERN =
  /(?:^careers?\b.*\b(?:why|story|guide)\b|\bwhy\s+i\s+chose\s+a\s+job\b|\bemployee\s+stor(?:y|ies)\b)/i;

const HCPC_TITLE_PATTERN =
  /\b(physiotherap|physio\b|occupational\s*therap|radiograph|mammograph|audiolog|paramedic|optometr|dietitian|dietician|podiatr|chiropod|speech\s*(and|&)\s*language|speech\s*therap|\bslt\b|biomedical\s*scientist|clinical\s*scientist|orthoptist|prosthetist|orthotist|operating\s*department\s*practitioner|\bodp\b|art\s*therap|drama\s*therap|music\s*therap|hearing\s*aid\s*dispenser|practitioner\s*psycholog|clinical(?:\s*\/\s*counselling|\s+or\s+counselling)?\s*psycholog|counselling\s*psycholog|sonograph)/i;

// NOTE: deliberately does NOT match a bare "consultant" — the sponsor register
// spans every industry, so "Environmental Consultant" etc. must not classify
// as GMC. Medical consultant titles always carry a specialty word that matches.
const GMC_TITLE_PATTERN =
  /\b(doctor|physician|surgeon|surgical|registrar\b|general\s*practitioner|gp\b|medical\s*(director|officer|practitioner)|foundation\s+doctor|core\s+trainee|specialty\s+registrar|fy[12]\b|st[1-8]\b|(?:neuro)?psychiatr|anaesthet|radiolog|cardiolog|respiratory\s+medicine|paediatric|oncolog|dermatolog|neurolog|patholog|immunolog|geriatric(?:ian|\s*medicine)|palliative\s*medicine|acute\s*medicine|stroke\s*medicine|ent\s+cons(?:ultant|aultant)|urolog|gynaecolog|obstetric|ophthalmolog|clinical\s*(academic|fellow|research)|house\s*officer|sho\b|specialty\s*doctor|junior\s*doctor|emergency\s*medicine|intensivist|haematolog|rheumatolog|endocrinolog|gastroenterolog|nephrolog|histopatholog|microbiolog)/i;
const EDUCATION_TITLE_PATTERN =
  /\b(teacher|teaching|teaching\s+assistant|lecturer|professor|academic|school\s*leader|headteacher|head\s*teacher|curriculum\s*lead|education\s*lead|education\s+mental\s+health|early\s+years|learning\s+support|research\s*fellow|postdoctoral|postdoc)/i;
const ENGINEERING_TITLE_PATTERN =
  /\b(engineer|engineering|(?:engineering|mechanical)\s+technician|technical\s*design|structural\s*design|civil\s*design|mechanical\s*design|electronic\s*design|construction\s*(project|manager|management))/i;
const DENTAL_TITLE_PATTERN =
  /\b(dentist|dentistry|dental\s*(nurse|surgeon|officer|therapist|hygienist|technician)|orthodont|periodont|endodont|prosthodont)/i;
const PHARMACY_TITLE_PATTERN =
  /\b(pharmacist|pharmacy|pharmaceutical|dispensary|medicines\s*management)/i;
const SOCIAL_WORK_TITLE_PATTERN =
  /\b(social\s*work(?:er)?|approved\s*mental\s*health\s*professional|\bamhp\b)/i;
const ACCOUNTING_TITLE_PATTERN =
  /\b(accountant|accounting|auditor|audit\s*(?:manager|officer)|finance\s*(?:assistant|business\s+partner|officer|accountant)|accounts?\s*(?:payable|receivable)|payroll\s+(?:officer|manager)|financial\s*controller|chartered\s*account)/i;
const FINANCE_TITLE_PATTERN =
  /\b(finance\s+manager|financial\s+analyst|investment\s+(?:analyst|manager|banker)|banking\s+(?:analyst|manager)|risk\s+(?:analyst|manager|officer)|compliance\s+(?:analyst|manager|officer)|credit\s+(?:analyst|manager)|underwriter|actuar(?:y|ial|ist)|treasury\s+(?:analyst|manager)|portfolio\s+manager|wealth\s+manager)\b/i;
const IT_TITLE_PATTERN =
  /\b(software\s*(engineer|developer)|web\s*developer|application\s*developer|programmer|developer|devops|site\s*reliability|cyber\s*security|cybersecurity|information\s*technology|\bit\s+(support|infrastructure\s+analyst|engineer|manager|analyst|consultant)|ehr\s+(?:senior\s+)?analyst|network\s*(engineer|administrator|analyst)|cloud\s*(engineer|administrator|architect)|systems?\s*(engineer|administrator|analyst)|database\s*administrator|data\s*(analyst|engineer|scientist)|technical\s*support|help\s*desk|service\s*desk)/i;
const LEGAL_TITLE_PATTERN =
  /\b(lawyer|solicitor|barrister|legal\s*(counsel|adviser|advisor|executive)|paralegal|attorney)/i;
const ARCHITECTURE_TITLE_PATTERN =
  /\b(architect|architectural|architecture)/i;
const BUSINESS_DEVELOPMENT_TITLE_PATTERN =
  /\b(business[\s-]+development(?:\s+manager|\s+executive|\s+officer)?|business[\s-]+development\s+and\s+partnerships)\b/i;
const HOSPITALITY_TITLE_PATTERN =
  /\b(chef|cook|kitchen\s+(?:assistant|manager)|catering\s+(?:assistant|team\s+member)|restaurant\s+manager|hotel\s+manager|hospitality\s+manager|hotel\s+services\s+assistant|food\s+and\s+beverage\s+manager|front\s+of\s+house\s+manager|housekeep(?:er|ing\s+(?:assistant|manager|services\s+assistant))|ward\s+host)\b/i;
const CONSTRUCTION_TITLE_PATTERN =
  /\b(quantity\s+surveyor|site\s+manager|construction\s+(?:manager|project\s+manager|supervisor)|building\s+surveyor|contracts\s+manager|estimator|bricklayer|carpenter|electrician|plumber)\b/i;
const MANUFACTURING_TITLE_PATTERN =
  /\b(manufacturing\s+(?:engineer|manager|technician)|production\s+(?:manager|engineer|supervisor|planner)|quality\s+(?:engineer|manager)|process\s+engineer|cnc\s+(?:operator|machinist)|factory\s+manager)\b/i;
const RETAIL_TITLE_PATTERN =
  /\b(retail\s+(?:manager|supervisor|buyer)|store\s+manager|shop\s+manager|merchandis(?:er|ing)|category\s+manager|ecommerce\s+manager|e-commerce\s+manager)\b/i;
const RESEARCH_ACADEMIA_TITLE_PATTERN =
  /\b(research\s+(?:assistant|associate|fellow|officer|manager|specialist|co-?ordinator|technician|funding)|clinical\s+trials?\s+assistant|(?:senior\s+)?trial\s+manager|early\s+career\s+fellow|postdoctoral|postdoc|doctoral|phd\b|studentship|researcher)\b/i;
const SCIENCE_LAB_TITLE_PATTERN =
  /\b(laboratory\s+(?:manager|technician|scientist|analyst)|lab\s+(?:manager|technician|scientist|analyst)|chemist|microbiologist|research\s+technician|materials\s+scientist)\b/i;
const PROJECT_PROGRAMME_TITLE_PATTERN =
  /\b(project|programme|program)\s+(?:manager|officer|co-?ordinator|lead|director|specialist|administrator)\b/i;
const OPERATIONS_MANAGEMENT_TITLE_PATTERN =
  /\b(operations\s+(?:manager|officer|lead|director|co-?ordinator)|chief\s+operating\s+officer|hospital\s+manager|strategy\s+manager|transformation\s+manager|service\s+manager|general\s+manager|business\s+operations)\b/i;
const ADMINISTRATION_TITLE_PATTERN =
  /\b(administrator|administration\s+assistant|administrative\s+(?:assistant|officer|co-?ordinator)|admin\s+(?:assistant|support)|executive\s+assistant|personal\s+assistant|receptionist|secretary|office\s+manager|registry\s+officer|accommodation\s+officer|pals\s+(?:officer|co-?ordinator)|waiting\s+list\s+co-?ordinator|patient\s+(?:follow-up\s+)?co-?ordinator|medical\/clinic\s+co-?ordinator)\b/i;
const HR_RECRUITMENT_TITLE_PATTERN =
  /\b(human\s+resources|hr\s+(?:manager|officer|advisor|adviser|business\s+partner|co-?ordinator)|people\s+(?:manager|advisor|adviser|(?:business\s+)?partner)|recruitment\s+(?:manager|officer|consultant|co-?ordinator)|talent\s+acquisition)\b/i;
const MARKETING_COMMUNICATIONS_TITLE_PATTERN =
  /\b(marketing\s+(?:manager|officer|executive|specialist|co-?ordinator)|communications?\s+(?:manager|officer|lead|specialist)|public\s+relations|social\s+media\s+(?:manager|officer|specialist)|campaigns?\s+(?:manager|officer))\b/i;
const SALES_ACCOUNT_MANAGEMENT_TITLE_PATTERN =
  /\b(sales\s+(?:manager|executive|director|specialist)|account\s+manager|customer\s+(?:relationship|success)\s+manager|partnerships?\s+(?:manager|director|lead))\b/i;
const PROCUREMENT_SUPPLY_CHAIN_TITLE_PATTERN =
  /\b(procurement\s+(?:manager|officer|specialist|executive)|supply\s+chain\s+(?:manager|analyst|specialist)|purchasing\s+(?:manager|officer)|strategic\s+buyer)\b/i;
const FUNDRAISING_CHARITY_TITLE_PATTERN =
  /\b(fundrais(?:ing|er)|philanthropy|donor\s+(?:manager|officer)|individual\s+giving|major\s+gifts)\b/i;
const PUBLIC_POLICY_TITLE_PATTERN =
  /\b(policy\s+(?:manager|officer|advisor|adviser|analyst|lead)|public\s+affairs\s+(?:manager|officer|advisor|adviser)|government\s+affairs)\b/i;
const FACILITIES_MAINTENANCE_TITLE_PATTERN =
  /\b(facilities\s+(?:assistant|manager|officer|operative|service\s+assistant|support\s+assistant|co-?ordinator)|estates\s+(?:manager|officer|surveyor)|maintenance(?:\s+(?:assistant|manager|operative|supervisor))?|building\s+services\s+manager)\b/i;
const CUSTOMER_SERVICE_TITLE_PATTERN =
  /\b(customer\s+(?:service|support)\s+(?:manager|lead|supervisor)|contact\s+centre\s+manager)\b/i;
const TRANSPORT_LOGISTICS_TITLE_PATTERN =
  /\b(transport\s+(?:manager|planner|officer)|logistics\s+(?:manager|planner|analyst)|fleet\s+manager|freight\s+(?:manager|planner))\b/i;
const MEDIA_CREATIVE_TITLE_PATTERN =
  /\b(video\s+(?:producer|editor)|creative\s+(?:director|producer)|(?:digital\s+)?content\s+(?:officer|producer|designer|writer)|graphic\s+designer|animator|journalist|editorial\s+(?:manager|producer)|film\s+producer)\b/i;
const CARE_SUPPORT_TITLE_PATTERN =
  /\b(?:(?:(?:senior|night|bank)\s+)?care\s+assistant|(?:senior\s+)?health\s+and\s+social\s+care\s+support\s+worker|(?:social\s+care|care|home\s+care|residential\s+care|community\s+support)\s+(?:worker|practitioner)|residential\s+support\s+worker|social\s+prescribing\s+link\s+worker|activit(?:y|ies)\s+co-?ordinator)\b/i;
const GENERIC_CARE_SUPPORT_TITLE_PATTERN =
  /^(?:(?:senior|bank|day|night|female)\s+)*support\s+worker(?:\s*(?:\([^)]*\)|[-–].*))?$/i;
const HEALTHCARE_CLINICAL_TITLE_PATTERN =
  /\b(advanced\s+clinical\s+practitioner|clinical\s+(?:associate\s+psychologist|lead|practitioner)|assistant\s+psychologist|applied\s+psychologist|psychological\s+wellbeing\s+practitioner|mental\s+health\s+practitioner|camhs\s+practitioner|associate\s+practitioner|assistant\s+practitioner|perioperative\s+practitioner|phlebotomist|phlebotomy|(?:cardiac|clinical)\s+physiologist|public\s+health\s+practitioner|urgent\s+care\s+practitioner|psychotherapist|counsellor|clinic\s+manager|(?:deputy\s+)?ward\s+manager|theatre\s+manager)\b/i;

/**
 * Best-effort keyword classification of an AI-discovered vacancy to the UK
 * regulator whose registrants it targets. Returns null when the title (and
 * description) give no clear professional signal — callers decide whether
 * such vacancies are excluded or bottom-ranked.
 * NMC and HCPC patterns are checked before GMC because GMC keywords like
 * "consultant" are more generic (e.g. "Nurse Consultant" is NMC).
 */
export function classifyVacancyCategory(
  title: string,
  description: string | null | undefined,
): OpportunityCategory | null {
  if (NON_VACANCY_CONTENT_TITLE_PATTERN.test(title)) return null;
  if (DENTAL_NURSE_TITLE_PATTERN.test(title)) return "DENTAL";
  if (PHARMACIST_TITLE_PATTERN.test(title)) return "PHARMACY";
  if (NURSING_SUPPORT_TITLE_PATTERN.test(title)) return "HEALTHCARE_SUPPORT";

  for (const [index, text] of [title, description ?? ""].entries()) {
    if (!text.trim()) continue;
    if (NMC_TITLE_PATTERN.test(text)) return "NMC";
    if (HCPC_TITLE_PATTERN.test(text)) return "HCPC";
    if (GMC_TITLE_PATTERN.test(text)) return "GMC";
    if (index === 0 && RESEARCH_ACADEMIA_TITLE_PATTERN.test(text)) return "RESEARCH_ACADEMIA";
    if (DENTAL_TITLE_PATTERN.test(text)) return "DENTAL";
    if (PHARMACY_TITLE_PATTERN.test(text)) return "PHARMACY";
    if (SOCIAL_WORK_TITLE_PATTERN.test(text)) return "SOCIAL_WORK";
    if (index === 0 && (CARE_SUPPORT_TITLE_PATTERN.test(text) || GENERIC_CARE_SUPPORT_TITLE_PATTERN.test(text.trim()))) return "CARE_SUPPORT";
    if (index === 0 && /\beducation\s+mental\s+health\b/i.test(text)) return "EDUCATION";
    if (index === 0 && HEALTHCARE_CLINICAL_TITLE_PATTERN.test(text)) return "HEALTHCARE_CLINICAL";
    if (FINANCE_TITLE_PATTERN.test(text)) return "FINANCE";
    if (ACCOUNTING_TITLE_PATTERN.test(text)) return "ACCOUNTING";
    if (IT_TITLE_PATTERN.test(text)) return "IT";
    if (index === 0 && /\b(software\s+support\s+specialist|business\s+systems\s+support|business\s+intelligence\s+officer)\b/i.test(text)) return "IT";
    if (LEGAL_TITLE_PATTERN.test(text)) return "LEGAL";
    if (ARCHITECTURE_TITLE_PATTERN.test(text)) return "ARCHITECTURE";
    if (BUSINESS_DEVELOPMENT_TITLE_PATTERN.test(text)) return "BUSINESS_DEVELOPMENT";
    if (HOSPITALITY_TITLE_PATTERN.test(text)) return "HOSPITALITY";
    if (CONSTRUCTION_TITLE_PATTERN.test(text)) return "CONSTRUCTION";
    if (MANUFACTURING_TITLE_PATTERN.test(text)) return "MANUFACTURING";
    if (RETAIL_TITLE_PATTERN.test(text)) return "RETAIL";
    if (index === 0 && SCIENCE_LAB_TITLE_PATTERN.test(text)) return "SCIENCE_LAB";
    if (index === 0 && PROJECT_PROGRAMME_TITLE_PATTERN.test(text)) return "PROJECT_PROGRAMME";
    if (index === 0 && OPERATIONS_MANAGEMENT_TITLE_PATTERN.test(text)) return "OPERATIONS_MANAGEMENT";
    if (index === 0 && /\b(practice\s+manager|home\s+manager|team\s+manager|associate\s+director|deputy\s+director)\b/i.test(text)) return "OPERATIONS_MANAGEMENT";
    if (index === 0 && ADMINISTRATION_TITLE_PATTERN.test(text)) return "ADMINISTRATION";
    if (index === 0 && /\b(management\s+assistant|clerical\s+officer|health\s+records|patient\s+services|clinical\s+coder|corporate\s+governance\s+support)\b/i.test(text)) return "ADMINISTRATION";
    if (index === 0 && HR_RECRUITMENT_TITLE_PATTERN.test(text)) return "HR_RECRUITMENT";
    if (index === 0 && /\bemployee\s+relations\b/i.test(text)) return "HR_RECRUITMENT";
    if (index === 0 && MARKETING_COMMUNICATIONS_TITLE_PATTERN.test(text)) return "MARKETING_COMMUNICATIONS";
    if (index === 0 && SALES_ACCOUNT_MANAGEMENT_TITLE_PATTERN.test(text)) return "SALES_ACCOUNT_MANAGEMENT";
    if (index === 0 && PROCUREMENT_SUPPLY_CHAIN_TITLE_PATTERN.test(text)) return "PROCUREMENT_SUPPLY_CHAIN";
    if (index === 0 && /\b(?:buyer|contracts?\s+assistant)\b/i.test(text)) return "PROCUREMENT_SUPPLY_CHAIN";
    if (index === 0 && FUNDRAISING_CHARITY_TITLE_PATTERN.test(text)) return "FUNDRAISING_CHARITY";
    if (index === 0 && PUBLIC_POLICY_TITLE_PATTERN.test(text)) return "PUBLIC_POLICY";
    if (index === 0 && FACILITIES_MAINTENANCE_TITLE_PATTERN.test(text)) return "FACILITIES_MAINTENANCE";
    if (index === 0 && CUSTOMER_SERVICE_TITLE_PATTERN.test(text)) return "CUSTOMER_SERVICE";
    if (index === 0 && TRANSPORT_LOGISTICS_TITLE_PATTERN.test(text)) return "TRANSPORT_LOGISTICS";
    if (index === 0 && MEDIA_CREATIVE_TITLE_PATTERN.test(text)) return "MEDIA_CREATIVE";
    if (EDUCATION_TITLE_PATTERN.test(text)) return "EDUCATION";
    if (ENGINEERING_TITLE_PATTERN.test(text)) return "ENGINEERING";
  }
  return null;
}

export interface VacancyClassificationEvidence {
  category: OpportunityCategory | null;
  confidence: "high" | "medium" | "none";
  reason: "title_pattern" | "description_pattern" | "unclassified";
}

/** Explainable wrapper used by imports and audits; broad families require title evidence. */
export function classifyVacancyCategoryWithEvidence(
  title: string,
  description: string | null | undefined,
): VacancyClassificationEvidence {
  const titleCategory = classifyVacancyCategory(title, null);
  if (titleCategory) {
    return { category: titleCategory, confidence: "high", reason: "title_pattern" };
  }
  const descriptionCategory = classifyVacancyCategory("", description);
  if (descriptionCategory) {
    return { category: descriptionCategory, confidence: "medium", reason: "description_pattern" };
  }
  return { category: null, confidence: "none", reason: "unclassified" };
}

/** Compatibility export for callers/tests that used the old overloaded name. */
export const classifyVacancyRegulator = classifyVacancyCategory;

const CATEGORY_INDUSTRY_PATTERNS: Partial<Record<OpportunityCategory, RegExp>> = {
  GMC: /health|hospital|medical|clinical/i,
  NMC: /health|hospital|medical|nursing|care/i,
  HCPC: /health|hospital|medical|clinical|therapy|diagnostic/i,
  DENTAL: /dental|dentistry|oral\s*health/i,
  PHARMACY: /pharma|pharmacy|medicines|health/i,
  SOCIAL_WORK: /social\s*(work|care)|charity|local\s*authority/i,
  EDUCATION: /education|school|college|university|academy/i,
  ENGINEERING: /engineer|manufactur|construction|technical|infrastructure/i,
  ACCOUNTING: /account|audit|finance|financial/i,
  FINANCE: /bank|finance|financial|insurance|investment|fintech|account/i,
  IT: /software|technology|digital|information\s*technology|computer/i,
  LEGAL: /legal|law|solicitor|professional\s*services/i,
  ARCHITECTURE: /architect|design|planning|construction/i,
  BUSINESS_DEVELOPMENT: /business[\s-]+development/i,
  HOSPITALITY: /hospitality|hotel|restaurant|catering|food/i,
  CONSTRUCTION: /construction|building|property|infrastructure/i,
  MANUFACTURING: /manufactur|production|factory|industrial/i,
  RETAIL: /retail|consumer|e-commerce|ecommerce|wholesale/i,
  HEALTHCARE_SUPPORT: /health|hospital|medical|care/i,
  CARE_SUPPORT: /health|hospital|medical|care|charity/i,
  HEALTHCARE_CLINICAL: /health|hospital|medical|clinical/i,
  RESEARCH_ACADEMIA: /research|university|education|academic/i,
  SCIENCE_LAB: /science|laboratory|research|pharma|manufactur/i,
  PROJECT_PROGRAMME: /professional|business|public|health|education|technology|construction/i,
  OPERATIONS_MANAGEMENT: /business|professional|public|health|education|technology|hospitality/i,
  ADMINISTRATION: /professional|business|public|health|education|charity/i,
  HR_RECRUITMENT: /professional|business|recruit|public|health|education/i,
  MARKETING_COMMUNICATIONS: /marketing|media|creative|business|charity|public/i,
  SALES_ACCOUNT_MANAGEMENT: /sales|business|retail|technology|professional/i,
  PROCUREMENT_SUPPLY_CHAIN: /procurement|supply|logistics|manufactur|retail|public/i,
  FUNDRAISING_CHARITY: /charity|nonprofit|non-profit|education|health/i,
  PUBLIC_POLICY: /public|government|charity|professional/i,
  FACILITIES_MAINTENANCE: /facilities|property|construction|health|education|hospitality/i,
  CUSTOMER_SERVICE: /customer|business|retail|technology|professional/i,
  TRANSPORT_LOGISTICS: /transport|logistics|supply|freight|retail/i,
  MEDIA_CREATIVE: /media|creative|marketing|advertising|film|television/i,
};

function industrySupportsCategory(
  category: OpportunityCategory,
  industry: string | null | undefined,
): boolean {
  return CATEGORY_INDUSTRY_PATTERNS[category]?.test(industry ?? "") ?? false;
}

export interface SponsorVacancyAsRole {
  id: number;
  title: string;
  employer: string;
  location: string;
  /** Statutory regulator when applicable; broader matching uses opportunityCategory. */
  regulator: StatutoryRegulator | null;
  opportunityCategory: OpportunityCategory;
  statutoryRegulator: StatutoryRegulator | null;
  sponsorshipOffered: boolean;
  sponsorshipStatus: "confirmed" | "not_offered" | "unknown";
  licensedSponsor: true;
  requiredRegistration: string;
  active: boolean;
  importedAt: Date;
  lastDiscoveredAt: Date;
  importedBy: string;
  liveness: "unverified" | "live" | "dead";
  lastVerifiedAt: Date | null;
  livenessReason: string | null;
  /** Exact source/detail URL, retained separately when an ATS supplies an apply URL. */
  vacancyUrl: string | null;
  applyUrl: string | null;
  linkVerified: boolean;
  linkStatus: VacancyLinkStatus;
  linkCheckedAt: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  /** True when the title/description clearly maps to the candidate's regulator. */
  classifiedRelevant: boolean;
  description: string | null;
  requiredDbsClearanceLevel: DbsClearanceLevel | null;
  requiredSafeguardingLevel: SafeguardingTrainingLevel | null;
  targetRegions: string[] | null;
  sourceType: "job_board" | "company_site" | null;
  boardName: string | null;
  externalListingId: string | null;
}

export type VacancySponsorshipStatus = SponsorVacancyAsRole["sponsorshipStatus"];

const SPONSORSHIP_NEGATIVE_PATTERNS = [
  /\b(?:no|without)\s+(?:visa\s+|skilled\s+worker\s+)?sponsorship\b/i,
  /\b(?:cannot|can't|unable\s+to|do(?:es)?\s+not|will\s+not|won't)\s+(?:offer|provide|support)\s+(?:visa\s+|skilled\s+worker\s+)?sponsorship\b/i,
  /\bsponsorship\b.{0,50}\b(?:not\s+available|cannot\s+be\s+offered|will\s+not\s+be\s+(?:offered|provided)|is\s+not\s+(?:offered|provided))\b/i,
  /\bnot\s+eligible\s+for\s+(?:visa\s+|skilled\s+worker\s+)?sponsorship\b/i,
] as const;

const SPONSORSHIP_POSITIVE_PATTERNS = [
  /\b(?:visa\s+|skilled\s+worker\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided)\b/i,
  /\b(?:we|the\s+employer|this\s+employer)\s+(?:can\s+|will\s+)?(?:offer|provide|support)\s+(?:visa\s+|skilled\s+worker\s+)?sponsorship\b/i,
  /\bcertificate\s+of\s+sponsorship\s+(?:is\s+)?available\b/i,
] as const;

/**
 * Deterministic vacancy-level evidence only. Sponsor-register membership is
 * represented separately and is never treated as proof for an individual job.
 */
export function inferVacancySponsorshipStatus(
  title: string,
  description: string | null | undefined,
): VacancySponsorshipStatus {
  const text = [title, description ?? ""].filter(Boolean).join("\n");
  if (SPONSORSHIP_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "not_offered";
  }
  if (SPONSORSHIP_POSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "confirmed";
  }
  return "unknown";
}

/**
 * Only extracts unambiguous, explicit phrases. This deliberately avoids
 * fuzzy classification: an absent or unclear statement must stay unknown.
 */
export function inferSafeguardingRequirements(
  title: string,
  description: string | null | undefined,
): Pick<SponsorVacancyAsRole, "requiredDbsClearanceLevel" | "requiredSafeguardingLevel"> {
  const text = [title, description ?? ""].filter(Boolean).join("\n");
  const dbsMatches = [
    ...text.matchAll(/\b(enhanced|standard|basic)\s+(?:DBS|disclosure and barring service)\b/gi),
  ].map((match) => match[1].toLowerCase() as Exclude<DbsClearanceLevel, "unknown">);
  const safeguardingMatches = [
    ...text.matchAll(/\bsafeguarding(?:\s+training)?\s+level\s*([12])\b|\blevel\s*([12])\s+safeguarding\b/gi),
  ].map((match) => `level_${match[1] ?? match[2]}` as Exclude<SafeguardingTrainingLevel, "unknown">);

  const dbsLevels = [...new Set(dbsMatches)];
  const safeguardingLevels = [...new Set(safeguardingMatches)];
  return {
    requiredDbsClearanceLevel: dbsLevels.length === 1 ? dbsLevels[0] : null,
    requiredSafeguardingLevel: safeguardingLevels.length === 1 ? safeguardingLevels[0] : null,
  };
}

export interface SponsorVacancyRoleQueryOptions {
  /** Restrict to snapshot rows created after this alert checkpoint. */
  since?: Date | null;
  /** Let candidate tabs filter at the database instead of scanning every source. */
  sourceType?: "job_board" | "company_site" | null;
  /** Job alerts must have an actionable deep link, not just contact metadata. */
  requireSpecificVacancyUrl?: boolean;
  /** Candidate board feeds only show links confirmed by a current search or liveness check. */
  onlyVerifiedLive?: boolean;
}

/**
 * Fetch live (non-dead) AI-discovered sponsor-licence vacancies relevant to a
 * candidate regulator, shaped like catalogue roles so the Opportunities data
 * layer can merge them with CSV roles and employer jobs.
 *
 * Filtering rules:
 * - dead-link vacancies are excluded at the SQL level
 * - manual-labour / clearly non-clinical titles are excluded
 * - vacancies classified to a DIFFERENT regulator are excluded
 * - unclassified vacancies are kept ONLY when the sponsoring organisation's
 *   register industry is healthcare-related, flagged (classifiedRelevant=false)
 *   so callers can bottom-rank or drop them; non-healthcare unclassified
 *   vacancies are excluded outright
 * - vacancies with no contact route at all (no live URL, email, phone, or
 *   website) are excluded, mirroring the HAS_CONTACT_INFO rule for roles
 */
export async function fetchSponsorVacanciesAsRoles(
  category: OpportunityCategory,
  options: SponsorVacancyRoleQueryOptions = {},
): Promise<SponsorVacancyAsRole[]> {
  const conditions = [ne(sponsorLicenceVacanciesTable.liveness, "dead")];
  if (options.onlyVerifiedLive) {
    conditions.push(eq(sponsorLicenceVacanciesTable.liveness, "live"));
  }
  if (options.sourceType) {
    conditions.push(eq(sponsorLicenceVacanciesTable.sourceType, options.sourceType));
  }
  if (options.since) {
    conditions.push(gt(sponsorLicenceVacanciesTable.createdAt, options.since));
  }
  const rows = await db
    .select({ vac: sponsorLicenceVacanciesTable, lic: sponsorLicencesTable })
    .from(sponsorLicenceVacanciesTable)
    .leftJoin(
      sponsorLicencesTable,
      // Persistence resolves sponsor identities case-insensitively after
      // trimming. Use the same strict identity here so a stored contact does
      // not disappear from Opportunities solely because casing/whitespace
      // differs between the vacancy and sponsor-register rows.
      sql`lower(btrim(${sponsorLicenceVacanciesTable.organisationName})) =
          lower(btrim(${sponsorLicencesTable.organisationName}))`,
    )
    .where(and(...conditions));

  const seen = new Set<number>();
  const out: SponsorVacancyAsRole[] = [];

  for (const row of rows) {
    const vac = row.vac;
    const lic = row.lic ?? null;
    if (seen.has(vac.id)) continue; // multiple licence rows per org — take first
    seen.add(vac.id);

    // Company-site discovery is allowed to populate rows asynchronously, but
    // candidate feeds must not expose them until the post-commit verifier has
    // confirmed the exact deep link.
    const candidateStatus = getCandidateVacancyStatus({
      sourceType: vac.sourceType,
      title: vac.title,
      liveness: vac.liveness,
      lastVerifiedAt: vac.lastVerifiedAt,
      lastDiscoveredAt: vac.lastDiscoveredAt,
      sourceMissingSince: vac.sourceMissingSince,
      sourceMissingObservations: vac.sourceMissingObservations,
      closesAt: vac.closesAt,
      expiresAt: vac.expiresAt,
      closedReason: vac.closedReason,
      companyVacancyEvidence: vac.companyVacancyEvidence,
      companyEvidenceLegacyUntil: vac.companyEvidenceLegacyUntil,
    });
    if (candidateStatus !== "visible") continue;
    if (isManualLabourTitle(vac.title)) continue;

    const classified = classifyVacancyCategory(vac.title, vac.description);
    if (classified !== null && !opportunityCategoriesMatch(category, classified)) continue;
    if (classified === null && !industrySupportsCategory(category, lic?.industry)) continue;

    const link = presentApplyLink(
      vac.applicationUrl ?? vac.url,
      vac.liveness,
      vac.lastVerifiedAt,
      vac.livenessReason,
      vac.sourceType,
    );
    if (
      vac.sourceType === "company_site" &&
      !isValidVacancyUrlForSource(link.applyUrl, "company_site")
    ) continue;
    if (options.requireSpecificVacancyUrl && (!link.applyUrl || link.linkStatus !== "live")) continue;
    if (
      options.requireSpecificVacancyUrl &&
      !isValidVacancyUrlForSource(link.applyUrl, vac.sourceType)
    ) continue;
    const contactEmail = lic?.contactEmail?.trim() || null;
    const contactPhone = lic?.contactPhone?.trim() || null;
    const contactWebsite = lic?.website?.trim() || null;
    const inferredRequirements =
      vac.requiredDbsClearanceLevel == null || vac.requiredSafeguardingLevel == null
        ? inferSafeguardingRequirements(vac.title, vac.description)
        : null;
    const sponsorshipStatus = inferVacancySponsorshipStatus(vac.title, vac.description);

    const hasContactRoute = [link.applyUrl, contactEmail, contactPhone, contactWebsite].some(
      (v) => v != null && v.trim() !== "",
    );
    if (!hasContactRoute) continue;

    out.push({
      id: vac.id + SPONSOR_VACANCY_ID_OFFSET,
      title: vac.title,
      employer: vac.organisationName,
      location: vac.location?.trim() || "United Kingdom",
      regulator: statutoryRegulatorForCategory(category),
      opportunityCategory: category,
      statutoryRegulator: statutoryRegulatorForCategory(category),
      // Register membership and vacancy-level sponsorship are separate facts.
      licensedSponsor: true,
      sponsorshipStatus,
      sponsorshipOffered: sponsorshipStatus === "confirmed",
      requiredRegistration: opportunityRegistrationLabel(category),
      active: true,
      importedAt: vac.createdAt,
      lastDiscoveredAt: vac.lastDiscoveredAt,
      importedBy: "ai:sponsor-vacancy-pipeline",
      liveness: vac.liveness,
      lastVerifiedAt: vac.lastVerifiedAt,
      livenessReason: vac.livenessReason,
      applyUrl: link.applyUrl,
      vacancyUrl: vac.url,
      linkVerified: link.linkVerified,
      linkStatus: link.linkStatus,
      linkCheckedAt: link.linkCheckedAt,
      contactEmail,
      contactPhone,
      contactWebsite,
      classifiedRelevant:
        classified !== null && opportunityCategoriesMatch(category, classified),
      description: vac.description,
      requiredDbsClearanceLevel:
        (vac.requiredDbsClearanceLevel as DbsClearanceLevel | null) ??
        inferredRequirements?.requiredDbsClearanceLevel ??
        null,
      requiredSafeguardingLevel:
        (vac.requiredSafeguardingLevel as SafeguardingTrainingLevel | null) ??
        inferredRequirements?.requiredSafeguardingLevel ??
        null,
      // Prefer an explicitly stored target-region list. When it is absent,
      // derive only from known location phrases; [] means unknown and remains
      // eligible for every candidate region.
      targetRegions:
        Array.isArray(vac.targetRegions) && vac.targetRegions.length > 0
          ? vac.targetRegions
          : regionsFromLocationText(vac.location),
      sourceType: vac.sourceType,
      boardName: vac.boardName,
      externalListingId: vac.externalListingId,
    });
  }

  return out;
}

/**
 * Merge-dedup key: a sponsor vacancy is dropped when a CSV role or employer
 * job already lists the same employer + title (case/whitespace-insensitive).
 */
export function roleDedupKey(employer: string, title: string): string {
  return `${employer.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

/**
 * Small relevance boost when the candidate's specialty / career focus words
 * appear in the vacancy title. Mirrors the focus-area boost used elsewhere.
 */
export function specialtyBoost(title: string, specialtyWords: string[]): number {
  if (specialtyWords.length === 0) return 0;
  const titleLower = title.toLowerCase();
  return specialtyWords.filter((w) => w.length > 3 && titleLower.includes(w)).length * 8;
}
