import { db } from "@workspace/db";
import { sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { and, eq, gt, ne } from "drizzle-orm";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { isValidVacancyDeepLink } from "./vacancyUrlPolicy";
import type { DbsClearanceLevel, SafeguardingTrainingLevel } from "./safeguarding";
import { regionsFromLocationText } from "./regionMatching";

/**
 * ID offset for AI-discovered sponsor-licence vacancies when merged into the
 * candidate-facing roles list. Keeps them in their own id space:
 *   roles:            1 .. 1,000,000
 *   employer jobs:    1,000,001 .. 2,000,000  (jobListings.id + 1,000,000)
 *   sponsor vacancies: > 2,000,000            (sponsor_licence_vacancies.id + 2,000,000)
 */
export const SPONSOR_VACANCY_ID_OFFSET = 2_000_000;

/**
 * Candidate-facing apply-link presentation: dead links are never surfaced
 * (the record may still appear if it has other contact info), and each link
 * carries a verification status the UI badges consistently.
 */
export function presentApplyLink(
  applyUrl: string | null | undefined,
  liveness: string | null | undefined,
  lastVerifiedAt: Date | null | undefined,
): { applyUrl: string | null; linkVerified: boolean; linkCheckedAt: string | null } {
  const url = applyUrl?.trim() || null;
  if (!url || liveness === "dead") {
    return { applyUrl: null, linkVerified: false, linkCheckedAt: null };
  }
  return {
    applyUrl: url,
    linkVerified: liveness === "live",
    linkCheckedAt: lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : null,
  };
}

const NMC_TITLE_PATTERN =
  /\b(nurse|nursing|midwif|health\s*visitor|rgn\b|rmn\b|rnld\b|matron|ward\s*sister)/i;

const HCPC_TITLE_PATTERN =
  /\b(physiotherap|occupational\s*therap|radiograph|paramedic|dietitian|dietician|podiatr|chiropod|speech\s*(and|&)\s*language|speech\s*therap|biomedical\s*scientist|clinical\s*scientist|orthoptist|prosthetist|orthotist|operating\s*department\s*practitioner|\bodp\b|art\s*therap|drama\s*therap|music\s*therap|hearing\s*aid\s*dispenser|practitioner\s*psycholog|clinical\s*psycholog)/i;

// NOTE: deliberately does NOT match a bare "consultant" — the sponsor register
// spans every industry, so "Environmental Consultant" etc. must not classify
// as GMC. Medical consultant titles always carry a specialty word that matches.
const GMC_TITLE_PATTERN =
  /\b(doctor|physician|surgeon|surgical|registrar\b|general\s*practitioner|gp\b|medical\s*officer|psychiatr|anaesthet|radiolog|cardiolog|paediatric|oncolog|dermatolog|neurolog|patholog|geriatric\s*medicine|urolog|gynaecolog|obstetric|ophthalmolog|clinical\s*fellow|house\s*officer|sho\b|specialty\s*doctor|junior\s*doctor|emergency\s*medicine|intensivist|haematolog|rheumatolog|endocrinolog|gastroenterolog|nephrolog|histopatholog|microbiolog)/i;

/**
 * Best-effort keyword classification of an AI-discovered vacancy to the UK
 * regulator whose registrants it targets. Returns null when the title (and
 * description) give no clear professional signal — callers decide whether
 * such vacancies are excluded or bottom-ranked.
 * NMC and HCPC patterns are checked before GMC because GMC keywords like
 * "consultant" are more generic (e.g. "Nurse Consultant" is NMC).
 */
export function classifyVacancyRegulator(
  title: string,
  description: string | null | undefined,
): "GMC" | "NMC" | "HCPC" | null {
  for (const text of [title, description ?? ""]) {
    if (!text.trim()) continue;
    if (NMC_TITLE_PATTERN.test(text)) return "NMC";
    if (HCPC_TITLE_PATTERN.test(text)) return "HCPC";
    if (GMC_TITLE_PATTERN.test(text)) return "GMC";
  }
  return null;
}

/** Register industries where an unclassified title may still be clinical. */
const HEALTHCARE_INDUSTRY_PATTERN = /health|hospital|medical|nursing|care|social\s*work|dental|pharma/i;

export interface SponsorVacancyAsRole {
  id: number;
  title: string;
  employer: string;
  location: string;
  regulator: "GMC" | "NMC" | "HCPC";
  sponsorshipOffered: boolean;
  requiredRegistration: string;
  active: boolean;
  importedAt: Date;
  importedBy: string;
  liveness: "unverified" | "live" | "dead";
  lastVerifiedAt: Date | null;
  livenessReason: string | null;
  applyUrl: string | null;
  linkVerified: boolean;
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
  /** Job alerts must have an actionable deep link, not just contact metadata. */
  requireSpecificVacancyUrl?: boolean;
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
  regulator: "GMC" | "NMC" | "HCPC",
  options: SponsorVacancyRoleQueryOptions = {},
): Promise<SponsorVacancyAsRole[]> {
  const conditions = [ne(sponsorLicenceVacanciesTable.liveness, "dead")];
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

    if (isManualLabourTitle(vac.title)) continue;

    const classified = classifyVacancyRegulator(vac.title, vac.description);
    if (classified !== null && classified !== regulator) continue;
    // Unclassified titles are only plausible for clinical candidates when the
    // sponsor itself operates in health/social care.
    if (classified === null && !HEALTHCARE_INDUSTRY_PATTERN.test(lic?.industry ?? "")) continue;

    const link = presentApplyLink(vac.url, vac.liveness, vac.lastVerifiedAt);
    if (options.requireSpecificVacancyUrl && !link.applyUrl) continue;
    if (options.requireSpecificVacancyUrl && !isValidVacancyDeepLink(link.applyUrl)) continue;
    const contactEmail = lic?.contactEmail?.trim() || null;
    const contactPhone = lic?.contactPhone?.trim() || null;
    const contactWebsite = lic?.website?.trim() || null;
    const inferredRequirements =
      vac.requiredDbsClearanceLevel == null || vac.requiredSafeguardingLevel == null
        ? inferSafeguardingRequirements(vac.title, vac.description)
        : null;

    const hasContactRoute = [link.applyUrl, contactEmail, contactPhone, contactWebsite].some(
      (v) => v != null && v.trim() !== "",
    );
    if (!hasContactRoute) continue;

    out.push({
      id: vac.id + SPONSOR_VACANCY_ID_OFFSET,
      title: vac.title,
      employer: vac.organisationName,
      location: vac.location?.trim() || "United Kingdom",
      regulator,
      // Every organisation in this table holds a Home Office sponsor licence.
      sponsorshipOffered: true,
      requiredRegistration: `${regulator} registration pathway`,
      active: true,
      importedAt: vac.createdAt,
      importedBy: "ai:sponsor-vacancy-pipeline",
      liveness: vac.liveness,
      lastVerifiedAt: vac.lastVerifiedAt,
      livenessReason: vac.livenessReason,
      applyUrl: link.applyUrl,
      linkVerified: link.linkVerified,
      linkCheckedAt: link.linkCheckedAt,
      contactEmail,
      contactPhone,
      contactWebsite,
      classifiedRelevant: classified === regulator,
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
