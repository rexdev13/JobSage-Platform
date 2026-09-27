import { createHash } from "node:crypto";
import {
  normalizeImportUrl,
  normalizeSponsorIdentityValue,
  resolveSponsorIdentity,
  sponsorIdentityMatchesProvidedFields,
  sponsorIdentityKey,
  SPONSOR_IDENTITY_SOURCE,
  type SponsorIdentity,
  type SponsorIdentityTarget,
} from "./sponsorWebsiteCrossEnvIdentity";

export type SponsorWebsiteImportField = "website" | "careers";

export type SponsorWebsiteImportCandidate = SponsorIdentity & {
  sourceRef: string;
  field: SponsorWebsiteImportField;
  confidence: string;
  developmentConfidence: string;
  candidateUrl: string;
  evidenceUrl: string;
  developmentCurrentValue: string;
  developmentAction: string;
  verificationStatus: string;
};

export type SponsorWebsiteProductionTarget = SponsorIdentityTarget & {
  website: string | null;
};

export type SponsorCareersProductionTarget = {
  id: number;
  organisationName: string;
  careersUrl: string | null;
};

export type SponsorIdentityMapping = {
  identityKey: string;
  targetSponsorLicenceId: number;
  resolutionMethod: "exact_unique" | "manual_review";
};

export type SponsorWebsiteImportRowPlan = {
  sourceRef: string;
  field: SponsorWebsiteImportField;
  identityKey: string;
  identity: SponsorIdentity;
  organisationName: string;
  candidateUrl: string;
  evidenceUrl: string;
  status: string;
  reason: string;
  targetSponsorLicenceId: number | null;
  targetCompanySiteCheckId: number | null;
  currentValue: string;
  productionCandidates: Array<{
    id: number;
    organisationName: string;
    townCity: string;
    county: string;
    region: string;
    industry: string;
    route: string;
    subRoute: string;
  }>;
};

export type SponsorWebsiteImportPlan = {
  rows: SponsorWebsiteImportRowPlan[];
  counts: Record<string, number>;
  planHash: string;
  inputHash: string;
  writes: Array<{
    sourceRef: string;
    field: SponsorWebsiteImportField;
    identityKey: string;
    identity: SponsorIdentity;
    targetSponsorLicenceId: number;
    targetCompanySiteCheckId: number | null;
    organisationName: string;
    url: string;
    currentValue: string;
  }>;
  exactMappings: Array<{
    identityKey: string;
    identitySnapshot: Record<string, string>;
    targetSponsorLicenceId: number;
  }>;
};

export function sponsorLicenceIdsForImportWrites(
  writes: readonly Pick<
    SponsorWebsiteImportPlan["writes"][number],
    "targetSponsorLicenceId"
  >[],
): number[] {
  return [...new Set(writes.map((write) => write.targetSponsorLicenceId))];
}

const MAX_REVIEW_CANDIDATES = 20;
const pilotNotImportedStatuses = new Set([
  "upgraded_to_high_in_pilot_not_imported",
  "pilot_high_upgrade_not_imported",
]);
const importableDevelopmentActions = new Set([
  "promote_high_blank",
  "update_blank",
  "preserve_existing_same",
]);

function normalizedEqual(left: string, right: string): boolean {
  const a = normalizeImportUrl(left);
  const b = normalizeImportUrl(right);
  return Boolean(a && b && a === b);
}

function candidateSummaries(targets: SponsorIdentityTarget[]) {
  return targets.slice(0, MAX_REVIEW_CANDIDATES).map((target) => ({
    id: target.id,
    organisationName: target.organisationName,
    townCity: target.townCity,
    county: target.county,
    region: target.region,
    industry: target.industry,
    route: target.route,
    subRoute: target.subRoute,
  }));
}

export function buildSponsorWebsiteImportPlan(input: {
  candidates: SponsorWebsiteImportCandidate[];
  sponsors: SponsorWebsiteProductionTarget[];
  careersTargets: SponsorCareersProductionTarget[];
  mappings: SponsorIdentityMapping[];
  inputHash: string;
}): SponsorWebsiteImportPlan {
  const mappingByKey = new Map(input.mappings.map((mapping) => [mapping.identityKey, mapping]));
  const sponsorsById = new Map(input.sponsors.map((sponsor) => [sponsor.id, sponsor]));
  const sponsorsByNormalizedName = new Map<string, SponsorWebsiteProductionTarget[]>();
  for (const sponsor of input.sponsors) {
    const key = normalizeSponsorIdentityValue(sponsor.organisationName);
    const sameName = sponsorsByNormalizedName.get(key) ?? [];
    sameName.push(sponsor);
    sponsorsByNormalizedName.set(key, sameName);
  }
  const careersByNormalizedName = new Map<string, SponsorCareersProductionTarget[]>();
  for (const site of input.careersTargets) {
    const key = normalizeSponsorIdentityValue(site.organisationName);
    const current = careersByNormalizedName.get(key) ?? [];
    current.push(site);
    careersByNormalizedName.set(key, current);
  }

  const rows: SponsorWebsiteImportRowPlan[] = [];
  for (const candidate of input.candidates) {
    const identityKey = sponsorIdentityKey(candidate);
    const mapping = mappingByKey.get(identityKey);
    const sameNameTargets =
      sponsorsByNormalizedName.get(normalizeSponsorIdentityValue(candidate.organisationName)) ?? [];
    const manuallyReviewedTargetId =
      mapping?.resolutionMethod === "manual_review"
        ? mapping.targetSponsorLicenceId
        : undefined;
    const match = resolveSponsorIdentity(
      candidate,
      sameNameTargets,
      manuallyReviewedTargetId,
    );
    const compatibleCandidates = match.status === "identity_conflict"
      ? sameNameTargets.filter((target) =>
          sponsorIdentityMatchesProvidedFields(candidate, target),
        )
      : match.matches;
    const row: SponsorWebsiteImportRowPlan = {
      sourceRef: candidate.sourceRef,
      field: candidate.field,
      identityKey,
      identity: {
        organisationName: candidate.organisationName,
        townCity: candidate.townCity,
        county: candidate.county,
        region: candidate.region,
        industry: candidate.industry,
        route: candidate.route,
        subRoute: candidate.subRoute,
      },
      organisationName: candidate.organisationName,
      candidateUrl: candidate.candidateUrl,
      evidenceUrl: candidate.evidenceUrl,
      status: "",
      reason: "",
      targetSponsorLicenceId: null,
      targetCompanySiteCheckId: null,
      currentValue: "",
      productionCandidates: candidateSummaries(compatibleCandidates),
    };

    if (!normalizeImportUrl(candidate.candidateUrl)) {
      row.status = "manual_review_invalid_url_or_evidence";
      row.reason = "The candidate URL must be a valid HTTP(S) URL.";
      rows.push(row);
      continue;
    }
    if (match.status === "ambiguous") {
      row.status = "manual_review_ambiguous_identity";
      row.reason = "More than one production sponsor row matches the available identity fields.";
      rows.push(row);
      continue;
    }
    if (match.status === "identity_conflict") {
      row.status = "manual_review_identity_conflict";
      row.reason = "The production row with this name has conflicting identity attributes.";
      rows.push(row);
      continue;
    }
    if (match.status === "incomplete_identity") {
      row.status = "manual_review_incomplete_identity";
      row.reason = "The source identity lacks enough location and sponsor-record detail.";
      rows.push(row);
      continue;
    }
    if (match.status === "not_found") {
      row.status = "manual_review_no_production_match";
      row.reason = "No production sponsor has this normalized organisation name.";
      rows.push(row);
      continue;
    }

    const target = sponsorsById.get(match.target.id);
    if (!target) {
      row.status = "manual_review_no_production_match";
      row.reason = "The production sponsor target disappeared during planning.";
      rows.push(row);
      continue;
    }
    row.targetSponsorLicenceId = target.id;
    if (candidate.field === "website") {
      row.currentValue = target.website ?? "";
    } else {
      const siteTargets =
        careersByNormalizedName.get(normalizeSponsorIdentityValue(target.organisationName)) ??
        [];
      if (siteTargets.length !== 1) {
        row.status = "manual_review_careers_target";
        row.reason =
          siteTargets.length === 0
            ? "No unique production careers-site row exists for this employer."
            : "More than one production careers-site row matches this employer.";
        rows.push(row);
        continue;
      }
      row.targetCompanySiteCheckId = siteTargets[0]!.id;
      row.currentValue = siteTargets[0]!.careersUrl ?? "";
    }

    if (row.currentValue.trim() && normalizedEqual(row.currentValue, candidate.candidateUrl)) {
      row.status = "already_matches_production_noop";
      row.reason = "The production field already contains this URL.";
      rows.push(row);
      continue;
    }
    if (row.currentValue.trim()) {
      row.status = "manual_review_existing_production_value";
      row.reason = "A different production URL is present and will not be overwritten.";
      rows.push(row);
      continue;
    }
    if (candidate.confidence.toLowerCase() !== "high") {
      row.status = "rejected_confidence";
      row.reason = "Only high-confidence candidates can enter the automatic import set.";
      rows.push(row);
      continue;
    }
    if (pilotNotImportedStatuses.has(candidate.verificationStatus)) {
      row.status = "manual_review_pilot_not_in_development";
      row.reason = "The pilot upgrade is not recorded in the development source data.";
      rows.push(row);
      continue;
    }
    if (candidate.developmentConfidence.toLowerCase() !== "high") {
      row.status = "manual_review_development_confidence";
      row.reason = "The development source has not independently reached high confidence.";
      rows.push(row);
      continue;
    }
    if (!normalizeImportUrl(candidate.evidenceUrl)) {
      row.status = "manual_review_invalid_url_or_evidence";
      row.reason = "The candidate's supporting evidence must be a valid HTTP(S) URL.";
      rows.push(row);
      continue;
    }
    if (!normalizedEqual(candidate.developmentCurrentValue, candidate.candidateUrl)) {
      row.status = "manual_review_development_value_conflict";
      row.reason = "The candidate does not match the currently reviewed development value.";
      rows.push(row);
      continue;
    }
    if (!importableDevelopmentActions.has(candidate.developmentAction)) {
      row.status = "manual_review_development_action";
      row.reason = "The development review action does not authorize automatic promotion.";
      rows.push(row);
      continue;
    }
    row.status = "safe_to_import";
    row.reason =
      match.status === "manual_mapping"
        ? "A saved, identity-checked crosswalk selects this production sponsor."
        : "One complete production identity match; target is blank and development agrees.";
    rows.push(row);
  }

  const changeKeys = new Map<string, Set<string>>();
  const potentialTargetRows = rows.filter((row) =>
    row.targetSponsorLicenceId != null &&
    !row.currentValue.trim() &&
    normalizeImportUrl(row.candidateUrl) &&
    (row.field === "website" || row.targetCompanySiteCheckId != null),
  );
  for (const row of potentialTargetRows) {
    const targetKey =
      row.field === "website"
        ? `website:${row.targetSponsorLicenceId}`
        : `careers:${row.targetCompanySiteCheckId}`;
    const urls = changeKeys.get(targetKey) ?? new Set<string>();
    urls.add(normalizeImportUrl(row.candidateUrl));
    changeKeys.set(targetKey, urls);
  }
  for (const row of potentialTargetRows) {
    const targetKey =
      row.field === "website"
        ? `website:${row.targetSponsorLicenceId}`
        : `careers:${row.targetCompanySiteCheckId}`;
    if ((changeKeys.get(targetKey)?.size ?? 0) > 1) {
      row.status = "manual_review_target_url_collision";
      row.reason =
        "Different candidate URLs compete for the same production field, including candidates that are not yet approved for import.";
    }
  }

  const safeRows = rows.filter((row) => row.status === "safe_to_import");
  const primaryWriteByTarget = new Map<string, SponsorWebsiteImportRowPlan>();
  const writes: SponsorWebsiteImportPlan["writes"] = [];
  for (const row of safeRows) {
    const targetKey =
      row.field === "website"
        ? `website:${row.targetSponsorLicenceId}`
        : `careers:${row.targetCompanySiteCheckId}`;
    const prior = primaryWriteByTarget.get(targetKey);
    if (prior && normalizedEqual(prior.candidateUrl, row.candidateUrl)) {
      row.status = "duplicate_candidate_same_target_noop";
      row.reason = "An identical verified candidate for this production field is already queued.";
      continue;
    }
    primaryWriteByTarget.set(targetKey, row);
    writes.push({
      sourceRef: row.sourceRef,
      field: row.field,
      identityKey: row.identityKey,
      identity: row.identity,
      targetSponsorLicenceId: row.targetSponsorLicenceId!,
      targetCompanySiteCheckId: row.targetCompanySiteCheckId,
      organisationName: row.organisationName,
      url: row.candidateUrl,
      currentValue: row.currentValue,
    });
  }

  const exactMappingsByKey = new Map<
    string,
    SponsorWebsiteImportPlan["exactMappings"][number]
  >();
  for (const row of rows) {
    if (
      row.targetSponsorLicenceId == null ||
      row.status === "manual_review_ambiguous_identity" ||
      row.status === "manual_review_identity_conflict" ||
      row.status === "manual_review_incomplete_identity" ||
      row.status === "manual_review_no_production_match"
    ) {
      continue;
    }
    const target = sponsorsById.get(row.targetSponsorLicenceId);
    if (!target) continue;
    exactMappingsByKey.set(row.identityKey, {
      identityKey: row.identityKey,
      identitySnapshot: Object.fromEntries(
        Object.entries({
          organisationName: target.organisationName,
          townCity: target.townCity,
          county: target.county,
          region: target.region,
          industry: target.industry,
          route: target.route,
          subRoute: target.subRoute,
        }).map(([key, value]) => [key, String(value ?? "")]),
      ),
      targetSponsorLicenceId: target.id,
    });
  }

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const planHash = createHash("sha256")
    .update(
      JSON.stringify({
        inputHash: input.inputHash,
        rows: rows.map((row) => ({
          sourceRef: row.sourceRef,
          field: row.field,
          identityKey: row.identityKey,
          candidateUrl: normalizeImportUrl(row.candidateUrl),
          status: row.status,
          targetSponsorLicenceId: row.targetSponsorLicenceId,
          targetCompanySiteCheckId: row.targetCompanySiteCheckId,
          currentValue: normalizeImportUrl(row.currentValue),
          productionCandidates: row.productionCandidates,
        })),
      }),
      "utf8",
    )
    .digest("hex");

  return {
    rows,
    counts,
    planHash,
    inputHash: input.inputHash,
    writes,
    exactMappings: [...exactMappingsByKey.values()],
  };
}

export function sponsorWebsiteIdentitySource(): string {
  return SPONSOR_IDENTITY_SOURCE;
}