import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsvObjects,
  stringifyCsv,
} from "./sponsor-contact-discovery/csv";
import {
  normalizeSponsorIdentityValue,
  normalizeSponsorLegalNameValue,
} from "./sponsorUrlResolverNormalization";

type CsvRow = Record<string, string>;
type SponsorTarget = {
  id: number;
  organisation_name: string;
  town_city: string;
  county: string;
  region: string;
  industry: string;
  route: string;
  sub_route: string;
  website: string;
};
type CareersTarget = {
  id: number;
  organisation_name: string;
  careers_url: string;
  ats_provider?: string;
  ats_board_id?: string;
  ats_mapping_status?: string;
  ats_mapping_evidence_url?: string;
  probe_status?: string;
};
type IdentityResolution = {
  code: string;
  reason: string;
  targets: SponsorTarget[];
  multiRow: boolean;
};

const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/production-url-resolution-2026-09-28",
);
const IMPORTABLE_ACTIONS = new Set([
  "update_blank",
  "promote_high_blank",
  "preserve_existing_same",
  "preserve_existing_different",
]);
const GENERIC_BRAND_TOKENS = new Set([
  "and", "the", "ltd", "limited", "plc", "llp", "company", "co", "group",
  "holdings", "uk", "england", "services", "service", "health", "healthcare",
  "medical", "clinic", "clinics", "centre", "centres", "center", "centers",
  "hospital", "hospitals", "care", "dental", "pharmacy", "pharmacies",
  "school", "schools", "academy", "academies", "university", "college",
  "recruitment", "recruiting", "jobs", "job", "vacancies", "vacancy",
]);
const CAREER_PATH_EXCLUSIONS =
  /(?:^|[/_-])(?:policy|policies|training|blog|news|volunteer(?:ing)?|guides?)(?:[/_.-]|$)/i;
const CAREER_PATH_SIGNALS =
  /(?:^|[/_-])(?:careers?|jobs?|vacancies?|work-with-us|work-for-us|join-us|recruitment|employment|current-opportunities)(?:[/_.-]|$)/i;

function readCsv(file: string): CsvRow[] {
  const content = readFileSync(path.join(DATA_DIR, file), "utf8");
  return parseCsvObjects(content);
}

function asText(row: CsvRow, key: string): string {
  return String(row[key] ?? "").trim();
}

function canonicalUrlKey(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return "";
  }
}

function hostOf(value: string | null | undefined): string {
  const normalized = canonicalUrlKey(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostsShareSite(left: string, right: string): boolean {
  const a = hostOf(left);
  const b = hostOf(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function isHomepage(value: string): boolean {
  const key = canonicalUrlKey(value);
  if (!key) return false;
  try {
    const url = new URL(key);
    return (url.pathname === "" || url.pathname === "/") && !url.search;
  } catch {
    return false;
  }
}

function hasCareerPath(value: string): boolean {
  const key = canonicalUrlKey(value);
  if (!key) return false;
  try {
    const pathAndQuery = `${new URL(key).pathname}${new URL(key).search}`;
    return !CAREER_PATH_EXCLUSIONS.test(pathAndQuery) &&
      CAREER_PATH_SIGNALS.test(pathAndQuery);
  } catch {
    return false;
  }
}

function parseIds(...values: string[]): number[] {
  return [...new Set(
    values.flatMap((value) =>
      (value.match(/\d+/g) ?? [])
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  )];
}

function legalName(value: string): string {
  return normalizeSponsorLegalNameValue(value);
}

function identityValue(value: string): string {
  return normalizeSponsorIdentityValue(value);
}

function brandTokens(row: CsvRow): string[] {
  const aliases = asText(row, "organisation_name")
    .split(/\b(?:t\/a|trading as|formerly known as)\b/i);
  const tokens = aliases.flatMap((part) =>
    identityValue(part).split(/\s+/).filter(Boolean),
  );
  return [...new Set(tokens.filter(
    (token) => token.length >= 4 && !GENERIC_BRAND_TOKENS.has(token),
  ))];
}

function hostMatchesEmployerBrand(row: CsvRow, candidateUrl: string): boolean {
  const host = hostOf(candidateUrl);
  const flattenedHost = host.replace(/[^a-z0-9]/g, "");
  if (!flattenedHost) return false;
  return brandTokens(row).some((token) =>
    flattenedHost.includes(token.replace(/[^a-z0-9]/g, "")),
  );
}

function locationDoesNotConflict(
  source: CsvRow,
  target: SponsorTarget,
): boolean {
  const pairs: Array<[string, keyof SponsorTarget]> = [
    ["town_city", "town_city"],
    ["county", "county"],
    ["region", "region"],
    ["route", "route"],
    ["sub_route", "sub_route"],
  ];
  return pairs.every(([sourceKey, targetKey]) => {
    const value = identityValue(asText(source, sourceKey));
    const targetValue = identityValue(String(target[targetKey] ?? ""));
    return !value || !targetValue || value === targetValue;
  });
}

function exactLocationMatch(
  source: CsvRow,
  target: SponsorTarget,
): boolean {
  const locationPairs: Array<[string, keyof SponsorTarget]> = [
    ["town_city", "town_city"],
    ["county", "county"],
    ["region", "region"],
  ];
  const provided = locationPairs.filter(([sourceKey]) =>
    identityValue(asText(source, sourceKey)),
  );
  if (provided.length === 0) return false;
  if (!provided.every(([sourceKey, targetKey]) => {
    const sourceValue = identityValue(asText(source, sourceKey));
    const targetValue = identityValue(String(target[targetKey] ?? ""));
    return Boolean(targetValue) && sourceValue === targetValue;
  })) {
    return false;
  }
  return ["route", "sub_route"].every((sourceKey) => {
    const sourceValue = identityValue(asText(source, sourceKey));
    const targetValue = identityValue(
      target[sourceKey as "route" | "sub_route"] ?? "",
    );
    return !sourceValue || sourceValue === targetValue;
  });
}

function productionTargetIds(row: CsvRow): number[] {
  return parseIds(
    asText(row, "resolver_target_sponsor_ids"),
    asText(row, "resolver_target_sponsor_id"),
    asText(row, "candidate_production_sponsor_record_ids"),
    asText(row, "matched_production_sponsor_record_id"),
  );
}

function sameCanonicalWebsiteGroup(targets: SponsorTarget[]): boolean {
  const nonblank = targets
    .map((target) => target.website.trim())
    .filter(Boolean)
    .map(canonicalUrlKey);
  if (nonblank.some((value) => !value)) return false;
  return new Set(nonblank).size <= 1;
}

function resolveIdentity(
  source: CsvRow,
  sponsorsById: Map<number, SponsorTarget>,
  sponsorsByName: Map<string, SponsorTarget[]>,
  candidateUrl: string,
  strongAuditEvidence: boolean,
): IdentityResolution {
  const sourceName = legalName(asText(source, "organisation_name"));
  const nameTargets = sponsorsByName.get(sourceName) ?? [];
  const indicatedTargets = productionTargetIds(source)
    .map((id) => sponsorsById.get(id))
    .filter((target): target is SponsorTarget => Boolean(target));
  const targetById = new Map<number, SponsorTarget>();
  for (const target of [...nameTargets, ...indicatedTargets]) {
    if (legalName(target.organisation_name) === sourceName) {
      targetById.set(target.id, target);
    }
  }
  const namedTargets = [...targetById.values()];
  const located = namedTargets.filter((target) => exactLocationMatch(source, target));
  const candidateHostTargets = namedTargets.filter((target) =>
    hostsShareSite(target.website, candidateUrl),
  );

  if (located.length === 1) {
    return {
      code: "auto_unique_location",
      reason: "Normalized employer name and supplied production location fields identify one sponsor row.",
      targets: located,
      multiRow: false,
    };
  }
  if (located.length > 1) {
    const locationAndHost = located.filter((target) =>
      hostsShareSite(target.website, candidateUrl),
    );
    if (locationAndHost.length === 1) {
      return {
        code: "auto_unique_location_and_official_domain",
        reason: "Several same-name rows share the supplied location, but one has the candidate's existing official website domain.",
        targets: locationAndHost,
        multiRow: false,
      };
    }
    if (
      (strongAuditEvidence || hostMatchesEmployerBrand(source, candidateUrl)) &&
      sameCanonicalWebsiteGroup(located)
    ) {
      return {
        code: "multi_row_same_employer",
        reason: "Multiple production sponsor rows share the exact supplied location and normalized name, have no conflicting website values, and independent source evidence supports one employer.",
        targets: located,
        multiRow: true,
      };
    }
    return {
      code: "manual_ambiguous_same_name_location",
      reason: "More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them.",
      targets: [],
      multiRow: false,
    };
  }

  const uniqueDomainTargets = candidateHostTargets.filter((target) =>
    locationDoesNotConflict(source, target),
  );
  if (uniqueDomainTargets.length === 1) {
    return {
      code: "auto_unique_existing_official_domain",
      reason: "One exact normalized-name production row already has the candidate domain, and provided location fields do not contradict it.",
      targets: uniqueDomainTargets,
      multiRow: false,
    };
  }
  if (uniqueDomainTargets.length > 1) {
    return {
      code: "manual_ambiguous_existing_domain",
      reason: "Several same-name production rows already share the candidate domain and the supplied location does not separate them.",
      targets: [],
      multiRow: false,
    };
  }
  if (namedTargets.length === 0) {
    return {
      code: "manual_no_production_match",
      reason: "No exact normalized employer-name production sponsor target is present in the exported production crosswalk.",
      targets: [],
      multiRow: false,
    };
  }
  return {
    code: "manual_location_conflict_or_insufficient",
    reason: "The production employer name is present, but location or domain evidence is incomplete or conflicts.",
    targets: [],
    multiRow: false,
  };
}

function candidateEvidenceRows(source: CsvRow, candidateUrl: string): CsvRow[] {
  const name = legalName(asText(source, "organisation_name"));
  const town = identityValue(asText(source, "town_city"));
  const candidateKey = canonicalUrlKey(candidateUrl);
  return auditCandidates.filter((evidence) => {
    if (legalName(asText(evidence, "organisation_name")) !== name) return false;
    if (canonicalUrlKey(asText(evidence, "candidate_url")) !== candidateKey) return false;
    const evidenceTown = identityValue(asText(evidence, "town_city"));
    return !town || !evidenceTown || town === evidenceTown;
  });
}

function strongAuditMatch(source: CsvRow, candidateUrl: string): CsvRow | undefined {
  const host = hostOf(candidateUrl);
  return candidateEvidenceRows(source, candidateUrl).find((evidence) => {
    const reason = asText(evidence, "reason").toLowerCase();
    const officialSource = ["official_site", "careers_page", "employer_website"]
      .includes(asText(evidence, "source_type").toLowerCase());
    const strongConfidence = asText(evidence, "confidence").toLowerCase() === "high";
    const brandOnPage = reason.includes("name_tokens_on_page");
    const locationOnPage = reason.includes("location_on_page");
    const hostMatches = hostOf(asText(evidence, "source_url")) === host ||
      hostMatchesEmployerBrand(source, candidateUrl);
    return officialSource && strongConfidence && brandOnPage &&
      locationOnPage && hostMatches;
  });
}

function anyUsefulAuditMatch(source: CsvRow, candidateUrl: string): CsvRow | undefined {
  return candidateEvidenceRows(source, candidateUrl).find((evidence) => {
    const sourceType = asText(evidence, "source_type").toLowerCase();
    return ["official_site", "careers_page", "employer_website"].includes(sourceType) &&
      Boolean(asText(evidence, "source_url"));
  });
}

function devCareersRow(source: CsvRow, candidateUrl: string): CareersTarget | undefined {
  const rows = devSitesByName.get(legalName(asText(source, "organisation_name"))) ?? [];
  const candidateKey = canonicalUrlKey(candidateUrl);
  return rows.find((row) => canonicalUrlKey(row.careers_url) === candidateKey);
}

function productionCareersRows(source: CsvRow): CareersTarget[] {
  return careersByName.get(legalName(asText(source, "organisation_name"))) ?? [];
}

function sourceCandidateUrl(
  kind: "identity" | "conflict" | "missing" | "baseline",
  source: CsvRow,
): string {
  const current = asText(source, "candidate_url");
  if (canonicalUrlKey(current)) return current;
  if (kind !== "missing") return "";
  const devRows = devSitesByName.get(legalName(asText(source, "organisation_name"))) ?? [];
  const exact = devRows.find((row) => canonicalUrlKey(row.careers_url));
  return exact?.careers_url ?? "";
}

function sourceEvidenceUrl(source: CsvRow, candidateUrl: string): string {
  const explicit = asText(source, "evidence_url");
  if (canonicalUrlKey(explicit)) return explicit;
  const audit = strongAuditMatch(source, candidateUrl) ??
    anyUsefulAuditMatch(source, candidateUrl);
  if (audit && canonicalUrlKey(asText(audit, "source_url"))) {
    return asText(audit, "source_url");
  }
  const devSite = devCareersRow(source, candidateUrl);
  if (devSite && canonicalUrlKey(devSite.ats_mapping_evidence_url)) {
    return devSite.ats_mapping_evidence_url!;
  }
  return "";
}

function sourceAgreement(
  source: CsvRow,
  candidateUrl: string,
  devSite?: CareersTarget,
): boolean {
  const current = asText(source, "development_current_value");
  return Boolean(
    (canonicalUrlKey(current) &&
      canonicalUrlKey(current) === canonicalUrlKey(candidateUrl)) ||
      (devSite && canonicalUrlKey(devSite.careers_url) === canonicalUrlKey(candidateUrl)),
  );
}

function canImportAction(source: CsvRow): boolean {
  return IMPORTABLE_ACTIONS.has(asText(source, "development_action").toLowerCase());
}

function highConfidence(source: CsvRow): boolean {
  return asText(source, "confidence").toLowerCase() === "high" &&
    asText(source, "development_confidence").toLowerCase() === "high";
}

function isFirstPartyWebsite(
  source: CsvRow,
  candidateUrl: string,
  evidenceUrl: string,
  identity: IdentityResolution,
  devSite?: CareersTarget,
): boolean {
  const audit = strongAuditMatch(source, candidateUrl);
  return highConfidence(source) &&
    canImportAction(source) &&
    sourceAgreement(source, candidateUrl, devSite) &&
    Boolean(evidenceUrl && hostsShareSite(candidateUrl, evidenceUrl)) &&
    (Boolean(audit) || hostMatchesEmployerBrand(source, candidateUrl)) &&
    identity.targets.length > 0;
}

function isFirstPartyCareers(
  source: CsvRow,
  candidateUrl: string,
  evidenceUrl: string,
  identity: IdentityResolution,
  devSite?: CareersTarget,
  productionWebsite?: string,
): boolean {
  const candidateHost = hostOf(candidateUrl);
  const evidenceHost = hostOf(evidenceUrl);
  const verifiedAts = devSite?.ats_mapping_status?.toLowerCase() === "verified" &&
    Boolean(devSite.ats_mapping_evidence_url) &&
    (hostsShareSite(candidateUrl, devSite.ats_mapping_evidence_url!) ||
      asText(source, "verification_evidence").toLowerCase().includes("verified ats"));
  const sameProductionSite = Boolean(productionWebsite) &&
    hostsShareSite(candidateUrl, productionWebsite!);
  return highConfidence(source) &&
    canImportAction(source) &&
    sourceAgreement(source, candidateUrl, devSite) &&
    hasCareerPath(candidateUrl) &&
    Boolean(candidateHost && evidenceHost) &&
    (candidateHost === evidenceHost || verifiedAts) &&
    (Boolean(strongAuditMatch(source, candidateUrl)) ||
      hostMatchesEmployerBrand(source, candidateUrl) ||
      sameProductionSite ||
      verifiedAts) &&
    identity.targets.length > 0;
}

function potentiallyUsefulForStaging(
  source: CsvRow,
  candidateUrl: string,
  evidenceUrl: string,
  devSite?: CareersTarget,
): boolean {
  if (!canonicalUrlKey(candidateUrl)) return false;
  const audit = anyUsefulAuditMatch(source, candidateUrl);
  const sourceConfidence = asText(source, "confidence").toLowerCase();
  const confidenceUsable = sourceConfidence === "high" || sourceConfidence === "medium" ||
    asText(source, "development_confidence").toLowerCase() === "high";
  return confidenceUsable &&
    Boolean(
      (evidenceUrl && hostsShareSite(candidateUrl, evidenceUrl)) ||
      audit ||
      (devSite && canonicalUrlKey(devSite.careers_url) === canonicalUrlKey(candidateUrl)),
    ) &&
    (hostMatchesEmployerBrand(source, candidateUrl) || Boolean(audit) || Boolean(devSite));
}

function currentSponsorWebsites(targets: SponsorTarget[]): string[] {
  return targets.map((target) => target.website.trim());
}

function canAddCareersFromHomepage(
  candidateUrl: string,
  targets: SponsorTarget[],
): boolean {
  const websites = currentSponsorWebsites(targets).filter(Boolean);
  return websites.length > 0 &&
    websites.every((website) =>
      isHomepage(website) && hostsShareSite(website, candidateUrl),
    );
}

function currentCareerValue(source: CsvRow): string {
  const sourceField = asText(source, "field").toLowerCase();
  const directId = parseIds(
    asText(source, "resolver_target_company_site_check_id"),
    asText(source, "matched_production_company_site_check_id"),
    asText(source, "candidate_production_company_site_check_ids"),
  )[0];
  if (directId) {
    const current = careersById.get(directId);
    if (current) return current.careers_url;
  }
  const sites = productionCareersRows(source);
  if (sites.length === 1) return sites[0]!.careers_url;
  if (sourceField !== "careers") return "";
  return asText(source, "resolver_current_production_value") ||
    asText(source, "production_current_value");
}

function candidateRowForImport(
  source: CsvRow,
  target: SponsorTarget,
  field: "website" | "careers",
  candidateUrl: string,
  evidenceUrl: string,
  reasonCode: string,
  evidenceNote: string,
  developmentCurrentValue = asText(source, "development_current_value"),
): CsvRow {
  const sourceRef = asText(source, "source_ref");
  const priorEvidence = asText(source, "verification_evidence");
  const evidence = [
    priorEvidence,
    evidenceNote,
    `Production identity resolved to sponsor row ${target.id} by exact current production evidence.`,
    `Original blocker source: ${sourceRef}.`,
  ].filter(Boolean).join(" ");
  return {
    source_ref: `${sourceRef}:production-target-${target.id}:${field}`,
    field,
    confidence: asText(source, "confidence"),
    development_confidence: asText(source, "development_confidence"),
    organisation_name: target.organisation_name,
    town_city: target.town_city,
    county: target.county,
    region: target.region,
    industry: target.industry,
    route: target.route,
    sub_route: target.sub_route,
    candidate_url: candidateUrl,
    evidence_url: evidenceUrl,
    verification_evidence: evidence,
    development_current_value: developmentCurrentValue,
    development_action: asText(source, "development_action"),
    verification_status: asText(source, "verification_status"),
    reason_code: reasonCode,
    production_target_sponsor_id: String(target.id),
  };
}

function stageRow(
  kind: string,
  source: CsvRow,
  candidateUrl: string,
  evidenceUrl: string,
  proposedField: string,
  reasonCode: string,
  reason: string,
): CsvRow {
  const ref = asText(source, "source_ref");
  return {
    ...source,
    source_ref: `${ref}:staging:${kind}`,
    candidate_url: candidateUrl,
    evidence_url: evidenceUrl,
    proposed_field: proposedField,
    reason_code: reasonCode,
    staging_reason: reason,
  };
}

function decorate(
  row: CsvRow,
  fields: Record<string, string>,
): CsvRow {
  return { ...row, ...fields };
}

function writeCsv(file: string, rows: CsvRow[], requiredColumns: string[] = []): void {
  const columns = [...new Set([
    ...requiredColumns,
    ...rows.flatMap((row) => Object.keys(row)),
  ])];
  writeFileSync(
    path.join(DATA_DIR, file),
    stringifyCsv(rows, columns),
    "utf8",
  );
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const current = key(value);
    if (seen.has(current)) return false;
    seen.add(current);
    return true;
  });
}

const sponsors = readCsv("production-sponsor-targets.csv").map((row) => ({
  id: Number(row.production_sponsor_id),
  organisation_name: asText(row, "organisation_name"),
  town_city: asText(row, "town_city"),
  county: asText(row, "county"),
  region: asText(row, "region"),
  industry: asText(row, "industry"),
  route: asText(row, "route"),
  sub_route: asText(row, "sub_route"),
  website: asText(row, "website"),
} satisfies SponsorTarget));
const sponsorsById = new Map(sponsors.map((row) => [row.id, row]));
const sponsorsByName = new Map<string, SponsorTarget[]>();
for (const row of sponsors) {
  const key = legalName(row.organisation_name);
  const matches = sponsorsByName.get(key) ?? [];
  matches.push(row);
  sponsorsByName.set(key, matches);
}

const initialCareers = readCsv("production-careers-site-checks.csv").map((row) => ({
  id: Number(row.production_company_site_check_id),
  organisation_name: asText(row, "organisation_name"),
  careers_url: asText(row, "careers_url"),
}));
const updatedCareers = readCsv(
  "production-company-site-checks-updated-since-0849.csv",
).map((row) => ({
  id: Number(row.production_company_site_check_id),
  organisation_name: asText(row, "organisation_name"),
  careers_url: asText(row, "careers_url"),
  ats_provider: asText(row, "ats_provider"),
  ats_board_id: asText(row, "ats_board_id"),
  ats_mapping_status: asText(row, "ats_mapping_status"),
  ats_mapping_evidence_url: asText(row, "ats_mapping_evidence_url"),
  probe_status: asText(row, "probe_status"),
}));
const careersById = new Map<number, CareersTarget>();
for (const row of initialCareers) careersById.set(row.id, row);
for (const row of updatedCareers) careersById.set(row.id, row);
const currentCareers = [...careersById.values()];
const careersByName = new Map<string, CareersTarget[]>();
for (const row of currentCareers) {
  const key = legalName(row.organisation_name);
  const matches = careersByName.get(key) ?? [];
  matches.push(row);
  careersByName.set(key, matches);
}

const devSites = readCsv("development-company-site-checks-evidence-rich.csv").map((row) => ({
  id: 0,
  organisation_name: asText(row, "organisation_name"),
  careers_url: asText(row, "careers_url"),
  ats_provider: asText(row, "ats_provider"),
  ats_board_id: asText(row, "ats_board_id"),
  ats_mapping_status: asText(row, "ats_mapping_status"),
  ats_mapping_evidence_url: asText(row, "ats_mapping_evidence_url"),
  probe_status: asText(row, "probe_status"),
}));
const devSitesByName = new Map<string, CareersTarget[]>();
for (const row of devSites) {
  const key = legalName(row.organisation_name);
  const matches = devSitesByName.get(key) ?? [];
  matches.push(row);
  devSitesByName.set(key, matches);
}
const auditCandidates = readCsv("development-url-audit-matching-candidates.csv");
const sourceRows = {
  identity: readCsv("manual-identity-resolution.csv"),
  conflict: readCsv("manual-url-conflicts.csv"),
  missing: readCsv("unresolved-missing-data.csv"),
};
const baselineSafe = readCsv("safe-auto-resolved.csv");

const identityAuto: CsvRow[] = [];
const identityMulti: CsvRow[] = [];
const identityManual: CsvRow[] = [];
const conflictNoop: CsvRow[] = [];
const conflictCareers: CsvRow[] = [];
const conflictReplace: CsvRow[] = [];
const conflictSecondary: CsvRow[] = [];
const conflictManual: CsvRow[] = [];
const missingRecovered: CsvRow[] = [];
const missingManual: CsvRow[] = [];
const stagingRows: CsvRow[] = [];
const classificationRows = new Map<string, CsvRow>();
const generatedImports: CsvRow[] = [];

function addStage(
  kind: string,
  source: CsvRow,
  candidateUrl: string,
  evidenceUrl: string,
  proposedField: string,
  reasonCode: string,
  reason: string,
): void {
  if (!potentiallyUsefulForStaging(source, candidateUrl, evidenceUrl,
    devCareersRow(source, candidateUrl))) return;
  const row = stageRow(
    kind, source, candidateUrl, evidenceUrl, proposedField, reasonCode, reason,
  );
  stagingRows.push(row);
}

function makeIdentityResolution(
  kind: "identity" | "conflict" | "missing",
  source: CsvRow,
): {
  url: string;
  evidenceUrl: string;
  audit?: CsvRow;
  devSite?: CareersTarget;
  identity: IdentityResolution;
} {
  const url = sourceCandidateUrl(kind, source);
  const audit = strongAuditMatch(source, url);
  const evidenceUrl = sourceEvidenceUrl(source, url);
  const devSite = devCareersRow(source, url);
  const identity = resolveIdentity(
    source,
    sponsorsById,
    sponsorsByName,
    url,
    Boolean(audit),
  );
  return { url, evidenceUrl, audit, devSite, identity };
}

function addImportRows(
  source: CsvRow,
  targets: SponsorTarget[],
  field: "website" | "careers",
  candidateUrl: string,
  evidenceUrl: string,
  reasonCode: string,
  note: string,
  developmentCurrentValue?: string,
): void {
  for (const target of targets) {
    generatedImports.push(candidateRowForImport(
      source,
      target,
      field,
      candidateUrl,
      evidenceUrl,
      reasonCode,
      note,
      developmentCurrentValue,
    ));
  }
}

function evaluateBlocker(
  kind: "identity" | "conflict" | "missing",
  source: CsvRow,
): CsvRow {
  const { url, evidenceUrl, audit, devSite, identity } =
    makeIdentityResolution(kind, source);
  const candidateKey = canonicalUrlKey(url);
  const sourceField = asText(source, "field").toLowerCase() === "careers"
    ? "careers"
    : "website";
  let proposedField: "website" | "careers" = sourceField;
  if (kind === "missing" && hasCareerPath(url)) proposedField = "careers";
  const productionCareers = productionCareersRows(source);
  const currentCareer = currentCareerValue(source);
  const websiteValues = currentSponsorWebsites(identity.targets);
  const nonblankWebsites = websiteValues.filter(Boolean);
  const noWebsiteConflict = websiteValues.every((value) =>
    !value || canonicalUrlKey(value) === candidateKey,
  );
  const websiteAlreadyPresent = websiteValues.length > 0 &&
    websiteValues.every((value) =>
      Boolean(value) && canonicalUrlKey(value) === candidateKey,
    );
  const careerAlreadyPresent = Boolean(currentCareer) &&
    canonicalUrlKey(currentCareer) === candidateKey;
  const candidateCareerProof = isFirstPartyCareers(
    source, url, evidenceUrl, identity, devSite,
    nonblankWebsites[0],
  );
  const candidateWebsiteProof = isFirstPartyWebsite(
    source, url, evidenceUrl, identity, devSite,
  );
  let status = "manual_review";
  let reason = identity.targets.length
    ? "Production identity is resolved, but the URL does not yet satisfy the first-party promotion checks."
    : identity.reason;
  let reasonCode = identity.targets.length
    ? "manual_source_evidence_insufficient"
    : identity.code;

  if (!candidateKey) {
    status = "manual_invalid_or_missing_url";
    reasonCode = "manual_invalid_or_missing_url";
    reason = kind === "missing"
      ? "No valid URL could be recovered from this blocker row or its matching development careers record."
      : "Candidate URL is missing or is not a credential-free HTTP(S) URL.";
  } else if (kind !== "conflict" && identity.targets.length === 0) {
    reasonCode = identity.code;
    reason = `${identity.reason} URL retained in review only.`;
  } else if (sourceField === "website" && websiteAlreadyPresent) {
    status = "normalized_noop";
    reasonCode = "normalized_url_already_present";
    reason = "Every matched production sponsor website is the same after ignoring HTTP/HTTPS, www, trailing slash, and fragment differences.";
  } else if (proposedField === "careers" && careerAlreadyPresent) {
    status = "normalized_noop";
    reasonCode = "normalized_careers_url_already_present";
    reason = "The production careers URL already matches after URL normalization.";
  } else if (
    identity.targets.length > 0 &&
    sourceField === "website" &&
    candidateWebsiteProof &&
    noWebsiteConflict
  ) {
    const blankTargets = identity.targets.filter((target) =>
      !target.website.trim(),
    );
    if (blankTargets.length > 0) {
      status = "direct_website_import";
      reasonCode = "verified_blank_website_from_blocker_review";
      reason = "Exact production identity, high-confidence reviewed development value, same-site evidence, and a distinctive employer-domain match support a blank-only website write.";
      addImportRows(
        source, blankTargets, "website", url, evidenceUrl, reasonCode,
        reason, asText(source, "development_current_value"),
      );
    } else if (noWebsiteConflict) {
      status = "normalized_noop";
      reasonCode = "website_already_matches";
      reason = "The production website is already present and no field change is needed.";
    }
  } else if (
    identity.targets.length > 0 &&
    sourceField === "website" &&
    hasCareerPath(url) &&
    canAddCareersFromHomepage(url, identity.targets) &&
    candidateCareerProof
  ) {
    if (productionCareers.length > 1) {
      status = "manual_careers_target_ambiguous";
      reasonCode = "manual_careers_target_ambiguous";
      reason = "The candidate is a verified same-site careers page, but multiple production careers rows exist for this employer.";
    } else if (!currentCareer || canonicalUrlKey(currentCareer) === candidateKey) {
      status = currentCareer ? "normalized_noop" : "add_careers_source";
      reasonCode = currentCareer
        ? "careers_source_already_present"
        : "verified_same_site_careers_source";
      reason = currentCareer
        ? "The official careers URL is already present."
        : "The production website is a homepage on the same host; the reviewed candidate is a verified careers path and can be stored separately without replacing the website.";
      if (!currentCareer) {
        addImportRows(
          source, [identity.targets[0]!], "careers", url, evidenceUrl,
          reasonCode, reason, asText(source, "development_current_value"),
        );
      }
    }
  } else if (
    identity.targets.length > 0 &&
    proposedField === "careers" &&
    candidateCareerProof
  ) {
    if (productionCareers.length > 1) {
      status = "manual_careers_target_ambiguous";
      reasonCode = "manual_careers_target_ambiguous";
      reason = "Multiple production careers-site rows match this employer; none was selected.";
    } else if (!currentCareer) {
      status = "direct_careers_import";
      reasonCode = productionCareers.length === 0
        ? "verified_careers_site_insert"
        : "verified_blank_careers_url";
      reason = productionCareers.length === 0
        ? "The reviewed first-party careers URL is verified, production identity is exact, and apply can insert a careers-site row without changing sponsor websites."
        : "The reviewed first-party careers URL is verified and the unique production careers row is blank.";
      addImportRows(
        source, [identity.targets[0]!], "careers", url, evidenceUrl,
        reasonCode, reason,
        devSite?.careers_url || asText(source, "development_current_value"),
      );
    } else if (canonicalUrlKey(currentCareer) === candidateKey) {
      status = "normalized_noop";
      reasonCode = "careers_source_already_present";
      reason = "The production careers URL already matches the candidate.";
    }
  } else if (
    identity.targets.length > 0 &&
    kind === "conflict" &&
    candidateCareerProof &&
    proposedField === "careers" &&
    !currentCareer &&
    productionCareers.length <= 1
  ) {
    status = "add_careers_source";
    reasonCode = "verified_secondary_careers_source";
    reason = "The candidate is independently verified as a careers source; the existing production value remains untouched.";
    addImportRows(
      source, [identity.targets[0]!], "careers", url, evidenceUrl,
      reasonCode, reason,
      devSite?.careers_url || asText(source, "development_current_value"),
    );
  } else if (
    identity.targets.length > 0 &&
    noWebsiteConflict &&
    proposedField === "website" &&
    candidateWebsiteProof
  ) {
    status = "direct_website_import";
    reasonCode = "verified_blank_website_from_blocker_review";
    reason = "Production website target is blank and first-party evidence supports a blank-only write.";
    const blankTargets = identity.targets.filter((target) =>
      !target.website.trim(),
    );
    addImportRows(
      source, blankTargets, "website", url, evidenceUrl, reasonCode,
      reason, asText(source, "development_current_value"),
    );
  } else if (identity.targets.length > 0 && kind === "conflict") {
    const officialCandidate = candidateCareerProof || candidateWebsiteProof ||
      Boolean(audit) || potentiallyUsefulForStaging(source, url, evidenceUrl, devSite);
    if (
      sourceField === "website" &&
      hasCareerPath(url) &&
      canAddCareersFromHomepage(url, identity.targets) &&
      officialCandidate &&
      productionCareers.length <= 1
    ) {
      if (!currentCareer) {
        status = "add_careers_source";
        reasonCode = "same_site_careers_path";
        reason = "The candidate is a same-site careers path on a production homepage. Existing website remains unchanged.";
        addImportRows(
          source, [identity.targets[0]!], "careers", url, evidenceUrl,
          reasonCode, reason, asText(source, "development_current_value"),
        );
      }
    } else if (officialCandidate) {
      status = "secondary_source_staged";
      reasonCode = "preserve_both_official_url_candidates";
      reason = "The candidate may be an official secondary source; preserve the existing production URL and keep this URL in staging for review.";
    } else {
      status = "manual_url_review";
      reasonCode = "manual_url_review";
      reason = "Candidate ownership or relevance is not independently established; no production URL is changed.";
    }
  } else if (potentiallyUsefulForStaging(source, url, evidenceUrl, devSite)) {
    status = "recovered_for_staging";
    reasonCode = "development_url_recovered_pending_verification";
    reason = "A current development URL and supporting evidence were found, but production identity or independent first-party verification is not strong enough for automatic import.";
  }

  if (
    status === "secondary_source_staged" ||
    status === "recovered_for_staging"
  ) {
    addStage(
      kind,
      source,
      url,
      evidenceUrl,
      proposedField,
      reasonCode,
      reason,
    );
  } else if (
    status.startsWith("manual") &&
    potentiallyUsefulForStaging(source, url, evidenceUrl, devSite)
  ) {
    addStage(
      kind,
      source,
      url,
      evidenceUrl,
      proposedField,
      `${reasonCode}_pending_review`,
      reason,
    );
  }

  const decorated = decorate(source, {
    source_kind: kind,
    candidate_url_used: url,
    evidence_url_used: evidenceUrl,
    identity_mapping_code: identity.code,
    identity_mapping_reason: identity.reason,
    proposed_field: proposedField,
    source_resolution: status,
    reason_code: reasonCode,
    resolution_reason: reason,
    mapped_production_sponsor_ids: identity.targets.map((target) => target.id).join("|"),
    mapped_production_sponsor_names: identity.targets
      .map((target) => target.organisation_name)
      .join("|"),
    production_website_values: identity.targets.map((target) => target.website).join("|"),
    production_careers_value: currentCareer,
    production_careers_row_count: String(productionCareers.length),
    first_party_audit_match: audit ? "yes" : "no",
    dev_careers_row_match: devSite ? "yes" : "no",
  });
  classificationRows.set(asText(source, "source_ref"), decorated);
  return decorated;
}

for (const row of sourceRows.identity) {
  const decorated = evaluateBlocker("identity", row);
  const mappingCode = decorated.identity_mapping_code;
  if (mappingCode === "multi_row_same_employer") {
    identityMulti.push(decorated);
  } else if (String(mappingCode).startsWith("manual_")) {
    identityManual.push(decorated);
  } else {
    identityAuto.push(decorated);
  }
}

for (const row of sourceRows.conflict) {
  const decorated = evaluateBlocker("conflict", row);
  const status = decorated.source_resolution;
  if (status === "normalized_noop") conflictNoop.push(decorated);
  else if (status === "add_careers_source") conflictCareers.push(decorated);
  else if (status === "replace_dead_existing") conflictReplace.push(decorated);
  else if (status === "secondary_source_staged") conflictSecondary.push(decorated);
  else conflictManual.push(decorated);
}

for (const row of sourceRows.missing) {
  const decorated = evaluateBlocker("missing", row);
  const status = String(decorated.source_resolution);
  if (
    status === "direct_website_import" ||
    status === "direct_careers_import" ||
    status === "normalized_noop" ||
    status === "recovered_for_staging"
  ) {
    missingRecovered.push(decorated);
  } else {
    missingManual.push(decorated);
  }
}

const importColumns = [
  "source_ref",
  "field",
  "confidence",
  "development_confidence",
  "organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "route",
  "sub_route",
  "candidate_url",
  "evidence_url",
  "verification_evidence",
  "development_current_value",
  "development_action",
  "verification_status",
  "reason_code",
  "production_target_sponsor_id",
];
const baselineImports = baselineSafe.map((row) => ({
  ...Object.fromEntries(importColumns.map((column) => [column, asText(row, column)])),
  reason_code: "baseline_safe_auto_resolve",
}));

let allImports = uniqueBy(
  [...baselineImports, ...generatedImports],
  (row) => asText(row, "source_ref"),
);

function importTargetKeys(row: CsvRow): string[] {
  const field = asText(row, "field");
  if (field === "careers") {
    return [`careers:${legalName(asText(row, "organisation_name"))}`];
  }
  const directId = parseIds(asText(row, "production_target_sponsor_id"));
  const targetIds = directId.length
    ? directId
    : parseIds(
        asText(row, "resolver_target_sponsor_ids"),
        asText(row, "resolver_target_sponsor_id"),
        asText(row, "matched_production_sponsor_record_id"),
      );
  return targetIds.length
    ? targetIds.map((id) => `website:${id}`)
    : [`website-name:${legalName(asText(row, "organisation_name"))}`];
}

const targetUrls = new Map<string, Set<string>>();
for (const row of allImports) {
  const url = canonicalUrlKey(asText(row, "candidate_url"));
  for (const targetKey of importTargetKeys(row)) {
    const values = targetUrls.get(targetKey) ?? new Set<string>();
    if (url) values.add(url);
    targetUrls.set(targetKey, values);
  }
}
const collisionKeys = new Set(
  [...targetUrls.entries()]
    .filter(([, urls]) => urls.size > 1)
    .map(([targetKey]) => targetKey),
);
const applyCollisions: CsvRow[] = [];
if (collisionKeys.size) {
  allImports = allImports.filter((row) => {
    const keys = importTargetKeys(row);
    const collided = keys.some((key) => collisionKeys.has(key));
    if (!collided) return true;
    applyCollisions.push({
      ...row,
      collision_target_keys: keys.filter((key) => collisionKeys.has(key)).join("|"),
      collision_reason: "Different candidate URLs compete for the same production field; none is included in the proposed apply CSV.",
    });
    return false;
  });
  for (const row of applyCollisions) {
    const sourceRef = asText(row, "source_ref").split(":production-target-")[0]!;
    const prior = classificationRows.get(sourceRef);
    if (prior) {
      prior.source_resolution = "manual_target_url_collision";
      prior.reason_code = "manual_target_url_collision";
      prior.resolution_reason =
        "Different candidate URLs compete for the same production field; none is included in the proposed apply CSV.";
      if (sourceRows.identity.some((source) => asText(source, "source_ref") === sourceRef)) {
        const index = identityAuto.findIndex((item) => asText(item, "source_ref") === sourceRef);
        if (index >= 0) identityAuto.splice(index, 1);
        if (!identityManual.some((item) => asText(item, "source_ref") === sourceRef)) {
          identityManual.push(prior);
        }
      }
      if (sourceRows.conflict.some((source) => asText(source, "source_ref") === sourceRef)) {
        const index = conflictCareers.findIndex((item) => asText(item, "source_ref") === sourceRef);
        if (index >= 0) conflictCareers.splice(index, 1);
        if (!conflictManual.some((item) => asText(item, "source_ref") === sourceRef)) {
          conflictManual.push(prior);
        }
      }
      if (sourceRows.missing.some((source) => asText(source, "source_ref") === sourceRef)) {
        const index = missingRecovered.findIndex((item) => asText(item, "source_ref") === sourceRef);
        if (index >= 0) missingRecovered.splice(index, 1);
        if (!missingManual.some((item) => asText(item, "source_ref") === sourceRef)) {
          missingManual.push(prior);
        }
      }
    }
    addStage(
      "collision",
      row,
      asText(row, "candidate_url"),
      asText(row, "evidence_url"),
      asText(row, "field"),
      "manual_target_url_collision",
      "Conflicting candidates were excluded from the apply file and retained for manual review.",
    );
  }
}

allImports = uniqueBy(
  allImports,
  (row) => [
    asText(row, "field"),
    importTargetKeys(row).join(","),
    canonicalUrlKey(asText(row, "candidate_url")),
  ].join("|"),
);
const uniqueStages = uniqueBy(stagingRows, (row) => asText(row, "source_ref"));
const validStageRows = uniqueStages.filter((row) =>
  canonicalUrlKey(asText(row, "candidate_url")),
);
const approvedGeneratedRefs = new Set(
  allImports.map((row) => asText(row, "source_ref")),
);
const approvedGeneratedImports = generatedImports.filter((row) =>
  approvedGeneratedRefs.has(asText(row, "source_ref")),
);
const pilotCandidates = uniqueBy(
  approvedGeneratedImports.flatMap((row) => {
    const target = sponsorsById.get(
      Number(asText(row, "production_target_sponsor_id")),
    );
    if (!target) return [];
    const employerKey = legalName(target.organisation_name);
    const sameEmployerTargets = sponsorsByName.get(employerKey) ?? [];
    const websiteCandidate = approvedGeneratedImports.find((candidate) =>
      asText(candidate, "field") === "website" &&
      legalName(asText(candidate, "organisation_name")) === employerKey,
    );
    const hasWebsiteAfterApply =
      sameEmployerTargets.some((candidate) =>
        Boolean(String(candidate.website ?? "").trim()),
      ) ||
      Boolean(websiteCandidate);
    if (!hasWebsiteAfterApply) return [];
    const siteRows = careersByName.get(employerKey) ?? [];
    if (siteRows.some((site) => site.probe_status?.toLowerCase() === "bad")) {
      return [];
    }
    return [{
      organisation_name: target.organisation_name,
      sponsor_target_id: String(target.id),
      newly_resolved_field: asText(row, "field"),
      candidate_url: asText(row, "candidate_url"),
      website_after_apply:
        sameEmployerTargets.find((candidate) =>
          Boolean(String(candidate.website ?? "").trim()),
        )?.website ||
        asText(websiteCandidate ?? {}, "candidate_url"),
      careers_probe_status: siteRows[0]?.probe_status || "unknown_if_new_site_row",
      source_ref: asText(row, "source_ref"),
      reason_code: asText(row, "reason_code"),
    }];
  }),
  (row) => legalName(row.organisation_name),
).sort((left, right) =>
  legalName(left.organisation_name).localeCompare(legalName(right.organisation_name)),
);
const pilotAllowlist = pilotCandidates.slice(0, 10);
const pilotFirstSource = pilotCandidates.slice(0, 1);

writeCsv("identity-auto-mapped.csv", identityAuto);
writeCsv("identity-multi-row-same-employer.csv", identityMulti);
writeCsv("identity-manual-review.csv", identityManual);
writeCsv("url-conflict-noop-normalized.csv", conflictNoop);
writeCsv("url-conflict-add-careers-source.csv", conflictCareers);
writeCsv("url-conflict-replace-dead-existing.csv", conflictReplace);
writeCsv("url-conflict-secondary-source.csv", conflictSecondary);
writeCsv("url-conflict-manual-review.csv", conflictManual);
writeCsv("missing-data-recovered.csv", missingRecovered);
writeCsv("missing-data-manual-review.csv", missingManual);
writeCsv("staging-source-candidates.csv", validStageRows);
writeCsv("reviewed-source-import-candidates.csv", allImports, importColumns);
writeCsv("apply-target-collisions.csv", applyCollisions);
writeCsv("vacancy-pilot-candidate-pool.csv", pilotCandidates);
writeCsv("vacancy-pilot-allowlist.csv", pilotAllowlist);
writeCsv("vacancy-pilot-first-source.csv", pilotFirstSource);

const countsByReason: Record<string, number> = {};
const identityMappingCounts: Record<string, number> = {};
for (const row of [...identityAuto, ...identityMulti, ...identityManual]) {
  const mappingCode = asText(row, "identity_mapping_code") || "unspecified";
  identityMappingCounts[mappingCode] = (identityMappingCounts[mappingCode] ?? 0) + 1;
}
for (const row of [
  ...identityAuto,
  ...identityMulti,
  ...identityManual,
  ...conflictNoop,
  ...conflictCareers,
  ...conflictReplace,
  ...conflictSecondary,
  ...conflictManual,
  ...missingRecovered,
  ...missingManual,
]) {
  const reason = asText(row, "reason_code") || "unspecified";
  countsByReason[reason] = (countsByReason[reason] ?? 0) + 1;
}

const identityUsable = [...identityAuto, ...identityMulti].filter((row) =>
  ["direct_website_import", "direct_careers_import", "add_careers_source", "normalized_noop"]
    .includes(asText(row, "source_resolution")),
).length;
const conflictUsable = conflictNoop.length + conflictCareers.length;
const missingDirect = missingRecovered.filter((row) =>
  ["direct_website_import", "direct_careers_import", "normalized_noop"]
    .includes(asText(row, "source_resolution")),
).length;
const importsByField = allImports.reduce((counts, row) => {
  const field = asText(row, "field") || "unknown";
  counts[field] = (counts[field] ?? 0) + 1;
  return counts;
}, {} as Record<string, number>);
const proposedWebsiteRows = allImports.filter((row) =>
  asText(row, "field") === "website",
).length;
const proposedCareersRows = allImports.filter((row) =>
  asText(row, "field") === "careers",
).length;
const proposedNewWebsiteEmployerNames = new Set(
  allImports
    .filter((row) => asText(row, "field") === "website")
    .map((row) => legalName(asText(row, "organisation_name")))
    .filter((name) => {
      const targets = sponsorsByName.get(name) ?? [];
      return targets.length > 0 && targets.every((target) => !target.website.trim());
    }),
);
const productionVacancyVisibilityBaseline = {
  capturedAt: "2026-09-28",
  predicate:
    "GET /sponsor-licences/vacancy-stats liveness/evidence gates plus the manager-role approval gate, with last_verified_at within 48 hours",
  sources: [
    { sourceType: "company_site", eligibleRows: 2478, employers: 513 },
    { sourceType: "job_board", eligibleRows: 1710, employers: 580 },
  ],
  totalEligibleRows: 4188,
  productionStagingTableExists: false,
};
const report = [
  "# Production URL blocker resolution preview",
  "",
  "## Safety status",
  "",
  "- Dry run only. This review did not change production sponsor website/careers rows, create staging rows, or invoke a vacancy job. Existing production schedules continue independently and may write vacancy rows.",
  "- Apply candidates are isolated in `reviewed-source-import-candidates.csv`; review the live production import preview and plan hash before any apply.",
  "- Source staging remains separate from discovery. Careers-only rows without a production sponsor website do not make an employer scheduler-ready.",
  "- No existing URL was classified for replacement: no liveness/redirect verification was performed, and a `bad` probe status alone is not proof that a URL is dead.",
  "",
  "## Blocker totals",
  "",
  `- Identity-review rows examined: ${sourceRows.identity.length}.`,
  `- Identity rows mapped to one production sponsor or a clearly grouped same-employer set: ${identityAuto.length + identityMulti.length}; source rows with a proposed direct source or normalized no-op: ${identityUsable}; manual identity rows: ${identityManual.length}.`,
  `- URL-conflict rows examined: ${sourceRows.conflict.length}.`,
  `- URL conflicts converted to a production careers source or normalized no-op: ${conflictUsable} (${conflictNoop.length} no-op, ${conflictCareers.length} careers-source writes); secondary sources held in staging: ${conflictSecondary.length}; manual URL reviews: ${conflictManual.length}; dead/bad replacements: ${conflictReplace.length}.`,
  "- No URL conflict qualified for a direct careers-source write: candidate homepages are not careers destinations, and other close cases did not match the reviewed development URL or already had a different production careers URL. Keep these staged/manual; do not loosen the evidence rules.",
  `- Missing-data rows examined: ${sourceRows.missing.length}.`,
  `- Missing rows recovered to a direct import or normalized no-op: ${missingDirect}; additional rows retained as staging candidates: ${missingRecovered.length - missingDirect}; manual missing-data rows: ${missingManual.length}.`,
  `- Rows in the staging review CSV: ${validStageRows.length}.`,
  `- Target URL collisions withheld from apply: ${applyCollisions.length} rows across ${collisionKeys.size} target fields.`,
  "",
  "## Proposed apply counts",
  "",
  `- Source-import CSV rows: ${allImports.length} (includes ${baselineSafe.length} previously auto-resolved candidates, deduplicated with this review).`,
  `- Candidate rows by field: website ${importsByField.website ?? 0}, careers ${importsByField.careers ?? 0}.`,
  `- Website target rows proposed: ${proposedWebsiteRows}; careers target rows proposed: ${proposedCareersRows}.`,
  `- Existing sponsor rows with websites: 9,791 (production snapshot).`,
  `- Existing careers-site rows: 8,810; rows with careers URLs: 3,096; verified ATS mappings: 29 (production snapshot).`,
  `- Proposed source coverage, row-based upper bound before live-plan no-op checks: up to ${9791 + proposedWebsiteRows} sponsor website rows and ${3096 + proposedCareersRows} careers URLs. The live import preview may reduce these counts where current production already matches.`,
  `- Newly website-bearing distinct employer names visible in the exported target set: ${proposedNewWebsiteEmployerNames.size}. These are only a subset of the global scheduler pool and are not a live scheduler count.`,
  `- Verified newly resolved employers eligible for a bounded allowlisted pilot: ${pilotCandidates.length}; the first ten are in \`vacancy-pilot-allowlist.csv\`, and the deterministic first candidate is in \`vacancy-pilot-first-source.csv\`. Careers-only rows without a production website are excluded.`,
  "",
  "## Production vacancy baseline",
  "",
  `- Read-only snapshot captured ${productionVacancyVisibilityBaseline.capturedAt}: ${productionVacancyVisibilityBaseline.sources.map((source) => `${source.sourceType} ${source.eligibleRows} rows across ${source.employers} employers`).join("; ")}; total ${productionVacancyVisibilityBaseline.totalEligibleRows} rows.`,
  "- This is the production vacancy-stats liveness/evidence count with the manager-role approval gate. It is not an exact count for every candidate feed: category, industry, contact, apply-link, and candidate-specific matching filters further narrow the feed.",
  "- Sponsor URL/careers metadata imports do not create vacancy rows. Existing production schedules can change the baseline independently, so capture a fresh count before any future pilot.",
  "- No post-pilot count exists because this review did not invoke the pilot worker. The allowlisted pilot still needs the same candidate-specific before/after review after separate authorization; do not infer candidate-visible roles from raw discovery totals.",
  "",
  "## Identity method and guardrails",
  "",
  "- Auto-mapping requires exact normalized legal-name agreement plus matching supplied location fields, or a unique exact-name production row whose existing official website already matches the candidate domain without contradicting supplied location.",
  "- Same-employer fan-out is limited to exact same-name/location groups with a single non-conflicting website value and independent audit or distinctive-brand evidence.",
  "- Domain similarity alone never promotes a source. Automatic promotion additionally requires high confidence in both source and development review, an importable review action, a matching reviewed development value, and independent same-site or strong page/location evidence.",
  "- URL comparison ignores HTTP/HTTPS, `www`, trailing slash, and fragment differences; it preserves path and query. Existing URLs are not overwritten.",
  "- Careers pages are accepted only when the path identifies a current jobs/careers destination or a verified ATS mapping does. Policy, training, editorial, and search-result pages remain out of automatic promotion.",
  "",
  "## Counts by reason",
  "",
  "| Reason code | Rows |",
  "| --- | ---: |",
  ...Object.entries(identityMappingCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `| identity_mapping:${reason} | ${count} |`),
  ...Object.entries(countsByReason)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => `| ${reason} | ${count} |`),
  "",
  "## Pilot readiness",
  "",
  "- Do not start the pilot until the reviewed apply is run and verified.",
  "- Use only names from `vacancy-pilot-allowlist.csv` after the reviewed import is applied. The internal company-site job now accepts `organisationNames` and applies the normalized exact-name filter before priority selection, limit, and discovery.",
  "- Begin with one newly resolved employer, then stop and inspect. For one employer, any error is a 100% error rate and stops the pilot. Do not widen the cohort until inserted, updated, rejected, and error counts plus candidate-visible counts are reviewed.",
  "- Production staging table is currently absent; the local staging CSV is not a production queue.",
  "",
  "## Sample manual rows",
  "",
  ...identityManual.slice(0, 5).map((row) =>
    `- Identity: ${asText(row, "organisation_name")} — ${asText(row, "reason_code")}: ${asText(row, "resolution_reason")}`,
  ),
  ...conflictManual.slice(0, 5).map((row) =>
    `- URL conflict: ${asText(row, "organisation_name")} — ${asText(row, "reason_code")}: ${asText(row, "resolution_reason")}`,
  ),
  ...missingManual.slice(0, 5).map((row) =>
    `- Missing data: ${asText(row, "organisation_name")} — ${asText(row, "reason_code")}: ${asText(row, "resolution_reason")}`,
  ),
  "",
].join("\n");
writeFileSync(
  path.join(DATA_DIR, "production-url-blocker-resolution-preview.md"),
  report,
  "utf8",
);
writeFileSync(
  path.join(DATA_DIR, "production-url-blocker-resolution-counts.json"),
  JSON.stringify({
    totalRowsExamined:
      sourceRows.identity.length + sourceRows.conflict.length + sourceRows.missing.length,
    identity: {
      total: sourceRows.identity.length,
      autoMapped: identityAuto.length,
      sameEmployerMultiRow: identityMulti.length,
      sourceUsable: identityUsable,
      manual: identityManual.length,
    },
    conflicts: {
      total: sourceRows.conflict.length,
      normalizedNoop: conflictNoop.length,
      addCareersSource: conflictCareers.length,
      replaceDeadExisting: conflictReplace.length,
      secondarySource: conflictSecondary.length,
      manual: conflictManual.length,
    },
    missing: {
      total: sourceRows.missing.length,
      recoveredDirectOrNoop: missingDirect,
      recoveredForStaging: missingRecovered.length - missingDirect,
      manual: missingManual.length,
    },
    stagingRows: validStageRows.length,
    applyCandidates: allImports.length,
    applyByField: importsByField,
    targetUrlCollisionRows: applyCollisions.length,
    collisionTargetFields: collisionKeys.size,
    countsByReason,
    identityMappingCounts,
    pilotEligibleEmployers: pilotCandidates.length,
    pilotAllowlist: pilotAllowlist.map((row) => row.organisation_name),
    productionVacancyVisibilityBaseline,
  }, null, 2),
  "utf8",
);

console.log(JSON.stringify({
  identity: {
    total: sourceRows.identity.length,
    auto: identityAuto.length,
    multi: identityMulti.length,
    manual: identityManual.length,
    usable: identityUsable,
  },
  conflicts: {
    total: sourceRows.conflict.length,
    noop: conflictNoop.length,
    addCareers: conflictCareers.length,
    secondary: conflictSecondary.length,
    manual: conflictManual.length,
    replaceDead: conflictReplace.length,
  },
  missing: {
    total: sourceRows.missing.length,
    recoveredDirectOrNoop: missingDirect,
    recoveredForStaging: missingRecovered.length - missingDirect,
    manual: missingManual.length,
  },
  stagingRows: validStageRows.length,
  applyCandidates: allImports.length,
  applyByField: importsByField,
  collisions: { rows: applyCollisions.length, targetFields: collisionKeys.size },
  pilotEligibleEmployers: pilotCandidates.length,
  pilotAllowlist: pilotAllowlist.map((row) => row.organisation_name),
  productionVacancyVisibilityBaseline,
}, null, 2));