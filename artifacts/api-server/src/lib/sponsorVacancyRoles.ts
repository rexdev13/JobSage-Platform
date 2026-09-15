import { db } from "@workspace/db";
import { sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { and, eq, gt, ne } from "drizzle-orm";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { isValidVacancyUrlForSource } from "./vacancyUrlPolicy";
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
  /\b(?:nursing|health\s*care|healthcare)\s+(?:assistant|support\s*(?:worker|assistant))\b/i;
const NON_VACANCY_CONTENT_TITLE_PATTERN =
  /(?:^careers?\b.*\b(?:why|story|guide)\b|\bwhy\s+i\s+chose\s+a\s+job\b|\bemployee\s+stor(?:y|ies)\b)/i;

const HCPC_TITLE_PATTERN =
  /\b(physiotherap|occupational\s*therap|radiograph|paramedic|optometr|dietitian|dietician|podiatr|chiropod|speech\s*(and|&)\s*language|speech\s*therap|biomedical\s*scientist|clinical\s*scientist|orthoptist|prosthetist|orthotist|operating\s*department\s*practitioner|\bodp\b|art\s*therap|drama\s*therap|music\s*therap|hearing\s*aid\s*dispenser|practitioner\s*psycholog|clinical\s*psycholog)/i;

// NOTE: deliberately does NOT match a bare "consultant" — the sponsor register
// spans every industry, so "Environmental Consultant" etc. must not classify
// as GMC. Medical consultant titles always carry a specialty word that matches.
const GMC_TITLE_PATTERN =
  /\b(doctor|physician|surgeon|surgical|registrar\b|general\s*practitioner|gp\b|medical\s*officer|psychiatr|anaesthet|radiolog|cardiolog|paediatric|oncolog|dermatolog|neurolog|patholog|geriatric\s*medicine|urolog|gynaecolog|obstetric|ophthalmolog|clinical\s*(academic|fellow|research)|house\s*officer|sho\b|specialty\s*doctor|junior\s*doctor|emergency\s*medicine|intensivist|haematolog|rheumatolog|endocrinolog|gastroenterolog|nephrolog|histopatholog|microbiolog)/i;
const EDUCATION_TITLE_PATTERN =
  /\b(teacher|teaching|lecturer|professor|academic|school\s*leader|headteacher|head\s*teacher|curriculum\s*lead|education\s*lead|research\s*fellow|postdoctoral|postdoc)/i;
const ENGINEERING_TITLE_PATTERN =
  /\b(engineer|engineering|technical\s*design|structural\s*design|civil\s*design|mechanical\s*design|electronic\s*design|construction\s*(project|manager|management))/i;
const DENTAL_TITLE_PATTERN =
  /\b(dentist|dentistry|dental\s*(surgeon|officer|therapist|hygienist|technician)|orthodont|periodont|endodont|prosthodont)/i;
const PHARMACY_TITLE_PATTERN =
  /\b(pharmacist|pharmacy|pharmaceutical|dispensary|medicines\s*management)/i;
const SOCIAL_WORK_TITLE_PATTERN =
  /\b(social\s*work(?:er)?|social\s*care\s*(practitioner|professional)|approved\s*mental\s*health\s*professional|\bamhp\b)/i;
const ACCOUNTING_TITLE_PATTERN =
  /\b(accountant|accounting|auditor|audit\s*manager|financial\s*controller|chartered\s*account)/i;
const IT_TITLE_PATTERN =
  /\b(software\s*(engineer|developer)|web\s*developer|application\s*developer|programmer|devops|site\s*reliability|cyber\s*security|cybersecurity|information\s*technology|\bit\s+(support|engineer|manager|analyst|consultant)|systems?\s*(engineer|administrator|analyst)|data\s*(engineer|scientist))/i;
const LEGAL_TITLE_PATTERN =
  /\b(lawyer|solicitor|barrister|legal\s*(counsel|adviser|advisor|executive)|paralegal|attorney)/i;
const ARCHITECTURE_TITLE_PATTERN =
  /\b(architect|architectural|architecture)/i;

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
  if (NURSING_SUPPORT_TITLE_PATTERN.test(title)) return null;

  for (const text of [title, description ?? ""]) {
    if (!text.trim()) continue;
    if (NMC_TITLE_PATTERN.test(text)) return "NMC";
    if (HCPC_TITLE_PATTERN.test(text)) return "HCPC";
    if (GMC_TITLE_PATTERN.test(text)) return "GMC";
    if (DENTAL_TITLE_PATTERN.test(text)) return "DENTAL";
    if (PHARMACY_TITLE_PATTERN.test(text)) return "PHARMACY";
    if (SOCIAL_WORK_TITLE_PATTERN.test(text)) return "SOCIAL_WORK";
    if (ACCOUNTING_TITLE_PATTERN.test(text)) return "ACCOUNTING";
    if (IT_TITLE_PATTERN.test(text)) return "IT";
    if (LEGAL_TITLE_PATTERN.test(text)) return "LEGAL";
    if (ARCHITECTURE_TITLE_PATTERN.test(text)) return "ARCHITECTURE";
    if (EDUCATION_TITLE_PATTERN.test(text)) return "EDUCATION";
    if (ENGINEERING_TITLE_PATTERN.test(text)) return "ENGINEERING";
  }
  return null;
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
  IT: /software|technology|digital|information\s*technology|computer/i,
  LEGAL: /legal|law|solicitor|professional\s*services/i,
  ARCHITECTURE: /architect|design|planning|construction/i,
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
      eq(sponsorLicenceVacanciesTable.organisationName, sponsorLicencesTable.organisationName),
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
    if (vac.sourceType === "company_site" && vac.liveness !== "live") continue;
    if (isManualLabourTitle(vac.title)) continue;

    const classified = classifyVacancyCategory(vac.title, vac.description);
    if (classified !== null && !opportunityCategoriesMatch(category, classified)) continue;
    if (classified === null && !industrySupportsCategory(category, lic?.industry)) continue;

    const link = presentApplyLink(
      vac.url,
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
