import { createHash } from "node:crypto";
import {
  normalizeSponsorIdentityValue,
  normalizeSponsorLegalNameValue,
} from "./sponsorUrlResolverNormalization";

export const RESOLVER_CLASSIFICATIONS = [
  "safe_auto_resolve",
  "safe_noop_already_done",
  "needs_manual_identity_resolution",
  "needs_manual_url_conflict_review",
  "needs_manual_low_confidence_review",
  "unresolved_due_to_missing_data",
] as const;

export type ResolverClassification = (typeof RESOLVER_CLASSIFICATIONS)[number];
export type CsvRecord = Record<string, string>;

export type ProductionApplyAudit = {
  createdAt: string;
  action: string;
  target: string;
  details: {
    rowCount: number;
    websiteUpdates: number;
    careersUpdates: number;
    safeTargetWrites?: number;
    mappingsStored: number;
    counts: Record<string, number>;
  };
};

export type ProductionSponsorTarget = {
  production_sponsor_id: string;
  organisation_name: string;
  town_city: string;
  county: string;
  region: string;
  industry: string;
  route: string;
  sub_route: string;
  website: string;
};

export type ProductionCareersTarget = {
  production_company_site_check_id: string;
  organisation_name: string;
  careers_url: string;
};

export type ProductionIdentityMapping = {
  identity_key: string;
  identity_snapshot: string;
  target_sponsor_licence_id: string;
  resolution_method: string;
};

export type ResolverResult = {
  source: CsvRecord;
  classification: ResolverClassification;
  reason: string;
  resolvedSponsorId: string;
  resolvedSponsorIds: string[];
  resolvedCareersId: string;
  currentValue: string;
  targetCurrentValues: Record<string, string>;
  identityMatchMethod: string;
  evidence: string;
};

export type ResolverRun = {
  results: ResolverResult[];
  counts: Record<ResolverClassification, number>;
};

const LOCATION_FIELDS = ["town_city", "county", "region"] as const;
const RECORD_DETAIL_FIELDS = ["industry", "route", "sub_route"] as const;
const IDENTITY_FIELDS = [
  "town_city",
  "county",
  "region",
  "industry",
  "route",
  "sub_route",
] as const;
const IMPORTABLE_DEVELOPMENT_ACTIONS = new Set([
  "promote_high_blank",
  "update_blank",
  "preserve_existing_same",
]);
const PILOT_ONLY_STATUSES = new Set([
  "upgraded_to_high_in_pilot_not_imported",
  "pilot_high_upgrade_not_imported",
]);

export const RESOLVER_OUTPUT_COLUMNS = [
  "resolver_classification",
  "resolver_reason",
  "resolver_target_sponsor_id",
  "resolver_target_sponsor_ids",
  "resolver_target_company_site_check_id",
  "resolver_current_production_value",
  "resolver_identity_match_method",
  "resolver_evidence",
] as const;

export function normalizeImportUrl(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return "";
    }
    parsed.hash = "";
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return "";
  }
}

function hostOf(value: string): string {
  const normalized = normalizeImportUrl(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeLegalName(value: string | null | undefined): string {
  return normalizeSponsorLegalNameValue(value);
}

function equalProvidedIdentityFields(
  source: CsvRecord,
  target: ProductionSponsorTarget,
): boolean {
  return IDENTITY_FIELDS.every((field) => {
    const sourceValue = normalizeSponsorIdentityValue(source[field]);
    return !sourceValue || sourceValue === normalizeSponsorIdentityValue(target[field]);
  });
}

function identityIsComplete(source: CsvRecord): boolean {
  return LOCATION_FIELDS.some((field) => normalizeSponsorIdentityValue(source[field])) &&
    RECORD_DETAIL_FIELDS.some((field) => normalizeSponsorIdentityValue(source[field]));
}

function identitySnapshot(source: CsvRecord): Record<string, string> {
  return {
    organisationName: normalizeSponsorIdentityValue(source.organisation_name),
    townCity: normalizeSponsorIdentityValue(source.town_city),
    county: normalizeSponsorIdentityValue(source.county),
    region: normalizeSponsorIdentityValue(source.region),
    industry: normalizeSponsorIdentityValue(source.industry),
    route: normalizeSponsorIdentityValue(source.route),
    subRoute: normalizeSponsorIdentityValue(source.sub_route),
  };
}

function identityKey(source: CsvRecord): string {
  return createHash("sha256")
    .update(JSON.stringify(identitySnapshot(source)), "utf8")
    .digest("hex");
}

function completeSponsorSignature(target: ProductionSponsorTarget): string {
  return JSON.stringify([
    normalizeSponsorIdentityValue(target.organisation_name),
    normalizeSponsorIdentityValue(target.town_city),
    normalizeSponsorIdentityValue(target.county),
    normalizeSponsorIdentityValue(target.region),
    normalizeSponsorIdentityValue(target.industry),
    normalizeSponsorIdentityValue(target.route),
    normalizeSponsorIdentityValue(target.sub_route),
  ]);
}

function identicalCompleteSponsorGroup(targets: ProductionSponsorTarget[]): boolean {
  return targets.length > 1 &&
    new Set(targets.map(completeSponsorSignature)).size === 1;
}

function parseMappingSnapshot(value: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const keys = [
      "organisationName",
      "townCity",
      "county",
      "region",
      "industry",
      "route",
      "subRoute",
    ];
    if (keys.some((key) => typeof parsed[key] !== "string")) return null;
    return Object.fromEntries(keys.map((key) => [
      key,
      normalizeSponsorIdentityValue(parsed[key] as string),
    ]));
  } catch {
    return null;
  }
}

function hasCareerPathSignal(rawUrl: string): boolean {
  const normalized = normalizeImportUrl(rawUrl);
  if (!normalized) return false;
  let segments: string[];
  try {
    segments = new URL(normalized).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment).toLowerCase().replace(/\.html?$/i, ""));
  } catch {
    return false;
  }
  if (segments.some((segment) =>
    /^(?:news|blogs?|press|media|articles?|insights?|resources?|events?|updates?|stories|case-studies)(?:[-_].*)?$/.test(segment),
  )) {
    return false;
  }
  return segments.some((segment) =>
    /^(?:careers?|vacancies?|recruitment|employment|hiring|jobs?)(?:[-_].*)?$/.test(segment) ||
    /^(?:job-(?:vacancies|opportunities|openings|search|application)|apply-for-job)$/.test(segment) ||
    /^(?:join-us|work-with-us|working-with-us|work-for-us|our-careers?|current-vacancies)$/.test(segment) ||
    /^(?:practice|current|role|staff)-vacancies$/.test(segment),
  );
}

function explicitlyVerifiesExternalAts(source: CsvRecord, candidateHost: string, evidenceHost: string): boolean {
  if (!candidateHost || !evidenceHost || candidateHost === evidenceHost) return false;
  const evidence = (source.verification_evidence ?? "").toLowerCase();
  const mentionsCandidateHost = evidence.includes(candidateHost);
  const hasLinkConfirmation = /\b(linked|link|official|verified|confirmed)\b/.test(evidence);
  return mentionsCandidateHost && hasLinkConfirmation;
}

function result(
  source: CsvRecord,
  classification: ResolverClassification,
  reason: string,
  extras: Partial<Omit<ResolverResult, "source" | "classification" | "reason">> = {},
): ResolverResult {
  return {
    source,
    classification,
    reason,
    resolvedSponsorId: "",
    resolvedSponsorIds: [],
    resolvedCareersId: "",
    currentValue: "",
    targetCurrentValues: {},
    identityMatchMethod: "",
    evidence: "",
    ...extras,
  };
}

function validateAudit(audit: ProductionApplyAudit, candidateCount: number): void {
  if (audit.action !== "sponsor_website_import_applied") {
    throw new Error(`Unexpected production audit action: ${audit.action || "(missing)"}`);
  }
  if (!audit.target.startsWith("plan:")) {
    throw new Error("The production audit event does not identify an import plan.");
  }
  if (audit.details.rowCount !== candidateCount) {
    throw new Error(
      `Production audit rowCount ${audit.details.rowCount} does not match reconciliation rows ${candidateCount}.`,
    );
  }
  const auditedRows = Object.values(audit.details.counts).reduce((total, count) => total + count, 0);
  if (auditedRows !== audit.details.rowCount) {
    throw new Error(`Production audit reason counts total ${auditedRows}, expected ${audit.details.rowCount}.`);
  }
  const appliedTargetWrites = audit.details.websiteUpdates + audit.details.careersUpdates;
  if (audit.details.safeTargetWrites !== undefined) {
    if (audit.details.safeTargetWrites !== appliedTargetWrites) {
      throw new Error("Production audit safeTargetWrites does not match its website/careers update totals.");
    }
  } else if (audit.details.counts.safe_to_import !== appliedTargetWrites) {
    throw new Error("Legacy production audit safe_to_import count does not match its website/careers update totals.");
  }
}

function resolveSponsorTarget(
  source: CsvRecord,
  sponsors: ProductionSponsorTarget[],
  mappings: ProductionIdentityMapping[],
): {
  target: ProductionSponsorTarget | null;
  targets: ProductionSponsorTarget[];
  classification?: ResolverClassification;
  reason?: string;
  method: string;
  evidence: string;
} {
  const legalName = normalizeLegalName(source.organisation_name);
  if (!legalName) {
    return {
      target: null,
      targets: [],
      classification: "unresolved_due_to_missing_data",
      reason: "The candidate has no organisation name.",
      method: "",
      evidence: "",
    };
  }

  const sourceIdentityKey = identityKey(source);
  const manualMappings = mappings.filter((candidate) =>
    candidate.identity_key === sourceIdentityKey &&
    candidate.resolution_method === "manual_review",
  );
  const manualTargetIds = new Set(
    manualMappings.map((candidate) => candidate.target_sponsor_licence_id),
  );
  if (manualTargetIds.size > 1) {
    return {
      target: null,
      targets: [],
      classification: "needs_manual_identity_resolution",
      reason: "Conflicting manually reviewed production crosswalk rows select different targets.",
      method: "conflicting_manual_crosswalks",
      evidence: "More than one reviewed production target uses this exact normalized source identity key.",
    };
  }
  const mapping = manualMappings[0];
  if (mapping) {
    const snapshot = parseMappingSnapshot(mapping.identity_snapshot);
    const snapshotHash = snapshot
      ? createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex")
      : "";
    const mappedTarget = sponsors.find(
      (candidate) => candidate.production_sponsor_id === mapping.target_sponsor_licence_id,
    );
    if (
      snapshotHash !== mapping.identity_key ||
      !mappedTarget ||
      normalizeLegalName(mappedTarget.organisation_name) !== legalName ||
      !equalProvidedIdentityFields(source, mappedTarget)
    ) {
      return {
        target: null,
        targets: [],
        classification: "needs_manual_identity_resolution",
        reason: "A saved production crosswalk exists but its snapshot or selected target is no longer compatible with the candidate identity.",
        method: "incompatible_manual_crosswalk",
        evidence: "The crosswalk snapshot hash, production target, or supplied identity fields do not agree.",
      };
    }
    return {
      target: mappedTarget,
      targets: [mappedTarget],
      method: "manual_review_crosswalk",
      evidence: "A saved manual-review crosswalk selects this production sponsor and its current identity still agrees.",
    };
  }

  const nameTargets = sponsors.filter(
    (target) => normalizeLegalName(target.organisation_name) === legalName,
  );
  const identityMatches = nameTargets.filter((target) =>
    equalProvidedIdentityFields(source, target),
  );

  if (identityMatches.length === 1) {
    const target = identityMatches[0]!;
    const exactNormalizedName =
      normalizeSponsorIdentityValue(source.organisation_name) ===
      normalizeSponsorIdentityValue(target.organisation_name);
    return {
      target,
      targets: [target],
      method: exactNormalizedName
        ? "unique_complete_identity"
        : "unique_ltd_limited_name_identity",
      evidence: "Exactly one current production sponsor matches the legal name and every supplied location/detail field.",
    };
  }

  if (identityMatches.length > 1) {
    if (identityIsComplete(source) && identicalCompleteSponsorGroup(identityMatches)) {
      return {
        target: identityMatches[0]!,
        targets: identityMatches,
        method: "identical_complete_duplicate_group",
        evidence: `All ${identityMatches.length} current production sponsor rows have identical complete normalized identity records.`,
      };
    }
    return {
      target: null,
      targets: [],
      classification: "needs_manual_identity_resolution",
      reason: `${identityMatches.length} current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence.`,
      method: "multiple_strong_identity_matches",
      evidence: "The source identity does not distinguish one target, and the matching production records are not an identical complete sponsor group.",
    };
  }

  if (nameTargets.length) {
    return {
      target: null,
      targets: [],
      classification: "needs_manual_identity_resolution",
      reason: "Production rows share the organisation name, but supplied identity fields conflict.",
      method: "identity_attribute_conflict",
      evidence: "At least one supplied location or sponsor-detail field differs from every candidate production row.",
    };
  }

  return {
    target: null,
    targets: [],
    classification: "unresolved_due_to_missing_data",
    reason: "No current production sponsor target could be found from the candidate name or prior production candidate IDs.",
    method: "no_current_production_target",
    evidence: "The audit is aggregate-only and does not contain a row-level target identity.",
  };
}

function classifyOne(
  source: CsvRecord,
  sponsors: ProductionSponsorTarget[],
  careersTargets: ProductionCareersTarget[],
  mappings: ProductionIdentityMapping[],
): ResolverResult {
  const field = (source.field ?? "").trim().toLowerCase();
  const candidateUrl = normalizeImportUrl(source.candidate_url);
  const evidenceUrl = normalizeImportUrl(source.evidence_url);
  if (!candidateUrl) {
    return result(
      source,
      "unresolved_due_to_missing_data",
      "The candidate URL is missing or is not a valid HTTP(S) URL.",
    );
  }
  if (field !== "website" && field !== "careers") {
    return result(
      source,
      "unresolved_due_to_missing_data",
      `Unsupported candidate field: ${field || "(missing)"}.`,
    );
  }
  if (!evidenceUrl) {
    return result(source, "unresolved_due_to_missing_data", "A valid supporting evidence URL is missing.");
  }

  const identity = resolveSponsorTarget(source, sponsors, mappings);
  if (!identity.target) {
    return result(
      source,
      identity.classification ?? "needs_manual_identity_resolution",
      identity.reason ?? "Production sponsor identity is unresolved.",
      { identityMatchMethod: identity.method, evidence: identity.evidence },
    );
  }
  const target = identity.target;
  const matchedTargets = identity.targets.length ? identity.targets : [target];
  if (!identityIsComplete(source)) {
    return result(
      source,
      "unresolved_due_to_missing_data",
      "The source identity lacks at least one location field and one sponsor-detail field.",
      {
        resolvedSponsorId: target.production_sponsor_id,
        identityMatchMethod: identity.method,
        evidence: identity.evidence,
      },
    );
  }

  let currentValue = "";
  let targetCurrentValues: Record<string, string> = {};
  let careersTarget: ProductionCareersTarget | undefined;
  if (field === "website") {
    targetCurrentValues = Object.fromEntries(
      matchedTargets.map((candidateTarget) => [
        candidateTarget.production_sponsor_id,
        candidateTarget.website ?? "",
      ]),
    );
    const currentValues = Object.values(targetCurrentValues);
    const conflictingValue = currentValues.find(
      (value) => value !== "" && normalizeImportUrl(value) !== candidateUrl,
    );
    currentValue = conflictingValue ?? currentValues.find((value) => value !== "") ?? "";
  } else {
    const siteTargets = careersTargets.filter(
      (site) => normalizeLegalName(site.organisation_name) === normalizeLegalName(target.organisation_name),
    );
    if (siteTargets.length !== 1) {
      const alreadyPresent = siteTargets.filter(
        (site) => normalizeImportUrl(site.careers_url) === candidateUrl,
      );
      if (alreadyPresent.length === 1) {
        return result(
          source,
          "safe_noop_already_done",
          "This careers URL is already present on one uniquely matching production careers-site row.",
          {
            resolvedSponsorId: target.production_sponsor_id,
            resolvedCareersId: alreadyPresent[0]!.production_company_site_check_id,
            currentValue: alreadyPresent[0]!.careers_url,
            identityMatchMethod: identity.method,
            evidence: identity.evidence,
          },
        );
      }
      return result(
        source,
        "unresolved_due_to_missing_data",
        siteTargets.length === 0
          ? "The sponsor identity is resolved, but no production careers-site target exists."
          : `${siteTargets.length} careers-site rows match this sponsor; none uniquely contains the candidate URL.`,
        {
          resolvedSponsorId: target.production_sponsor_id,
          identityMatchMethod: identity.method,
          evidence: identity.evidence,
        },
      );
    }
    careersTarget = siteTargets[0]!;
    currentValue = careersTarget.careers_url ?? "";
  }

  const baseTarget = {
    resolvedSponsorId: target.production_sponsor_id,
    resolvedSponsorIds: matchedTargets.map((candidateTarget) => candidateTarget.production_sponsor_id),
    resolvedCareersId: careersTarget?.production_company_site_check_id ?? "",
    currentValue,
    targetCurrentValues,
    identityMatchMethod: identity.method,
    evidence: identity.evidence,
  };
  const currentValues = field === "website"
    ? Object.values(targetCurrentValues)
    : [currentValue];
  const conflictingValue = currentValues.find(
    (value) => value !== "" && normalizeImportUrl(value) !== candidateUrl,
  );
  if (conflictingValue) {
    return result(
      source,
      "needs_manual_url_conflict_review",
      "At least one exact matching production target already has a different URL. Existing production values are never overwritten automatically.",
      { ...baseTarget, currentValue: conflictingValue },
    );
  }
  if (
    currentValues.length > 0 &&
    currentValues.every((value) => value !== "" && normalizeImportUrl(value) === candidateUrl)
  ) {
    return result(
      source,
      "safe_noop_already_done",
      matchedTargets.length > 1 && field === "website"
        ? "The candidate URL already matches every identical complete production sponsor row."
        : "The candidate URL already matches the current production field.",
      baseTarget,
    );
  }

  const candidateHost = hostOf(candidateUrl);
  const evidenceHost = hostOf(evidenceUrl);
  const developmentUrl = normalizeImportUrl(source.development_current_value);
  const developmentAgrees = Boolean(developmentUrl && developmentUrl === candidateUrl);
  const pilotOnly = PILOT_ONLY_STATUSES.has((source.verification_status ?? "").trim().toLowerCase());
  const confidenceHigh = (source.confidence ?? "").trim().toLowerCase() === "high";
  const developmentConfidenceHigh =
    (source.development_confidence ?? "").trim().toLowerCase() === "high";
  const actionAllowed = IMPORTABLE_DEVELOPMENT_ACTIONS.has(
    (source.development_action ?? "").trim().toLowerCase(),
  );
  const sameHostEvidence = Boolean(candidateHost && candidateHost === evidenceHost);
  const explicitAtsEvidence = explicitlyVerifiesExternalAts(source, candidateHost, evidenceHost);
  const careerDestinationConfirmed =
    field !== "careers" || hasCareerPathSignal(candidateUrl) || explicitAtsEvidence;
  const productionOwnedCareerPage =
    field === "careers" &&
    matchedTargets.every((candidateTarget) => hostOf(candidateTarget.website) === candidateHost) &&
    Boolean(candidateHost) &&
    candidateHost === evidenceHost &&
    hasCareerPathSignal(candidateUrl) &&
    developmentAgrees &&
    !pilotOnly;

  if (productionOwnedCareerPage) {
    return result(
      source,
      "safe_auto_resolve",
      "The blank careers field has a first-party URL on the current production sponsor website, an explicit careers-path signal, and matching reviewed development evidence.",
      {
        ...baseTarget,
        evidence: `${identity.evidence} Current production sponsor website, candidate, and evidence URL share one host; candidate path identifies a careers page.`,
      },
    );
  }

  if (!confidenceHigh) {
    return result(
      source,
      "needs_manual_low_confidence_review",
      "The candidate is not high confidence and has no independent first-party ownership evidence sufficient to upgrade it.",
      {
        ...baseTarget,
        evidence: `${identity.evidence} Candidate confidence=${source.confidence || "missing"}; development confidence=${source.development_confidence || "missing"}; candidate/evidence hosts ${candidateHost || "(invalid)"} / ${evidenceHost || "(invalid)"}.`,
      },
    );
  }
  if (pilotOnly) {
    return result(
      source,
      "unresolved_due_to_missing_data",
      "The verification pilot upgrade is not recorded in the development source data.",
      baseTarget,
    );
  }
  if (!developmentConfidenceHigh) {
    return result(
      source,
      "needs_manual_low_confidence_review",
      "The development source has not independently reached high confidence.",
      baseTarget,
    );
  }
  if (!developmentAgrees) {
    return result(
      source,
      "unresolved_due_to_missing_data",
      "The candidate does not match a valid reviewed development value.",
      baseTarget,
    );
  }
  if (!actionAllowed) {
    return result(
      source,
      "needs_manual_low_confidence_review",
      "The development review action does not authorize automatic promotion.",
      baseTarget,
    );
  }

  if (
    confidenceHigh &&
    developmentConfidenceHigh &&
    actionAllowed &&
    (sameHostEvidence || explicitAtsEvidence) &&
    careerDestinationConfirmed
  ) {
    return result(
      source,
      "safe_auto_resolve",
      "Unique production identity, blank target, high confidence in both environments, matching reviewed development value, and first-party or explicitly verified ATS evidence.",
      {
        ...baseTarget,
        evidence: `${identity.evidence} Candidate and evidence URLs share one host or an explicit ATS link confirmation is present.`,
      },
    );
  }

  return result(
    source,
    "needs_manual_low_confidence_review",
    field === "careers" && !careerDestinationConfirmed
      ? "The candidate has no clear careers-path signal or explicitly verified ATS-link evidence."
      : "The URL lacks sufficient first-party ownership evidence or high-confidence agreement across source and development review.",
    {
      ...baseTarget,
      evidence: `${identity.evidence} Candidate confidence=${source.confidence || "missing"}; development confidence=${source.development_confidence || "missing"}; candidate/evidence hosts ${candidateHost || "(invalid)"} / ${evidenceHost || "(invalid)"}.`,
    },
  );
}

function classifyTargetCollisions(results: ResolverResult[]): void {
  const byTarget = new Map<string, ResolverResult[]>();
  for (const item of results) {
    const field = (item.source.field ?? "").trim().toLowerCase();
    const candidateUrl = normalizeImportUrl(item.source.candidate_url);
    if (!candidateUrl) continue;
    const targetIds = field === "website"
      ? item.resolvedSponsorIds.filter((targetId) => {
          const value = item.targetCurrentValues[targetId] ?? "";
          return value === "" || normalizeImportUrl(value) === candidateUrl;
        })
      : item.resolvedCareersId &&
          (item.currentValue === "" || normalizeImportUrl(item.currentValue) === candidateUrl)
        ? [item.resolvedCareersId]
        : [];
    for (const targetId of targetIds) {
      const key = `${field}:${targetId}`;
      byTarget.set(key, [...(byTarget.get(key) ?? []), item]);
    }
  }

  const collided = new Set<ResolverResult>();
  for (const candidates of byTarget.values()) {
    const distinctUrls = new Set(candidates.map((item) => normalizeImportUrl(item.source.candidate_url)));
    if (distinctUrls.size > 1) {
      for (const item of candidates) {
        collided.add(item);
      }
    }
  }

  for (const item of collided) {
    item.classification = "needs_manual_url_conflict_review";
    item.reason = "Different candidate URLs compete for the same blank production target, including candidates that are not yet approved; none will be selected automatically.";
  }

  const firstSafeByTarget = new Map<string, ResolverResult>();
  for (const item of results) {
    if (item.classification !== "safe_auto_resolve" || collided.has(item)) continue;
    const field = (item.source.field ?? "").trim().toLowerCase();
    const candidateUrl = normalizeImportUrl(item.source.candidate_url);
    const targetIds = field === "website"
      ? item.resolvedSponsorIds.filter((targetId) =>
          (item.targetCurrentValues[targetId] ?? "") === "",
        )
      : item.resolvedCareersId && item.currentValue === ""
        ? [item.resolvedCareersId]
        : [];
    const keys = targetIds.map((targetId) => `${field}:${targetId}`);
    if (keys.length > 0 && keys.every((key) => {
      const prior = firstSafeByTarget.get(key);
      return prior && normalizeImportUrl(prior.source.candidate_url) === candidateUrl;
    })) {
      item.classification = "safe_noop_already_done";
      item.reason = "The identical verified URL is already queued for every blank target in this candidate group.";
      continue;
    }
    for (const key of keys) {
      if (!firstSafeByTarget.has(key)) firstSafeByTarget.set(key, item);
    }
  }
}

export function runProductionSponsorUrlResolver(input: {
  audit: ProductionApplyAudit;
  reconciliationRows: CsvRecord[];
  sponsors: ProductionSponsorTarget[];
  careersTargets: ProductionCareersTarget[];
  mappings?: ProductionIdentityMapping[];
}): ResolverRun {
  validateAudit(input.audit, input.reconciliationRows.length);
  const refs = input.reconciliationRows.map((row) => (row.source_ref ?? "").trim());
  if (refs.some((ref) => !ref) || new Set(refs).size !== refs.length) {
    throw new Error("Reconciliation rows must have unique, non-empty source_ref values.");
  }

  const results = input.reconciliationRows.map((source) =>
    classifyOne(source, input.sponsors, input.careersTargets, input.mappings ?? []),
  );
  classifyTargetCollisions(results);

  const counts = Object.fromEntries(
    RESOLVER_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<ResolverClassification, number>;
  for (const item of results) counts[item.classification] += 1;
  return { results, counts };
}

export function auditReasonTotal(audit: ProductionApplyAudit): number {
  return Object.values(audit.details.counts).reduce((sum, value) => sum + value, 0);
}

export function resolverSourceColumns(rows: CsvRecord[]): string[] {
  return [...new Set([
    ...rows.flatMap((row) => Object.keys(row)),
    ...RESOLVER_OUTPUT_COLUMNS,
  ])];
}

export function withResolverColumns(item: ResolverResult): CsvRecord {
  return {
    ...item.source,
    resolver_classification: item.classification,
    resolver_reason: item.reason,
    resolver_target_sponsor_id: item.resolvedSponsorId,
    resolver_target_sponsor_ids: item.resolvedSponsorIds.join("|"),
    resolver_target_company_site_check_id: item.resolvedCareersId,
    resolver_current_production_value: item.currentValue,
    resolver_identity_match_method: item.identityMatchMethod,
    resolver_evidence: item.evidence,
  };
}