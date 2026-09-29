import { createHash } from "node:crypto";

export const SPONSOR_IDENTITY_SOURCE = "non_healthcare_sponsor_website_candidates";

export type SponsorIdentity = {
  organisationName: string;
  townCity: string;
  county: string;
  region: string;
  industry: string;
  route: string;
  subRoute: string;
};

export type SponsorIdentityTarget = SponsorIdentity & {
  id: number;
};

export type SponsorIdentityMatch =
  | { status: "exact_unique"; target: SponsorIdentityTarget; matches: SponsorIdentityTarget[] }
  | { status: "manual_mapping"; target: SponsorIdentityTarget; matches: SponsorIdentityTarget[] }
  | { status: "ambiguous"; matches: SponsorIdentityTarget[] }
  | { status: "identity_conflict"; matches: SponsorIdentityTarget[] }
  | { status: "incomplete_identity"; matches: SponsorIdentityTarget[] }
  | { status: "not_found"; matches: SponsorIdentityTarget[] };

const IDENTITY_FIELDS = [
  "organisationName",
  "townCity",
  "county",
  "region",
  "industry",
  "route",
  "subRoute",
] as const satisfies readonly (keyof SponsorIdentity)[];

const LOCATION_FIELDS = ["townCity", "county", "region"] as const;
const RECORD_DETAIL_FIELDS = ["industry", "route", "subRoute"] as const;

export function normalizeSponsorIdentityValue(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Legal suffix matching is intentionally narrower than the stable identity
 * snapshot normalizer: it treats only a trailing "Ltd" as "Limited".
 * Keeping identitySnapshot on the original normalizer preserves existing
 * cross-environment mapping keys.
 */
export function normalizeSponsorLegalNameValue(value: string | null | undefined): string {
  return normalizeSponsorIdentityValue(value).replace(/\bltd$/, "limited");
}

export function identitySnapshot(identity: SponsorIdentity): Record<string, string> {
  return Object.fromEntries(
    IDENTITY_FIELDS.map((field) => [field, normalizeSponsorIdentityValue(identity[field])]),
  );
}

export function sponsorIdentityKey(identity: SponsorIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify(identitySnapshot(identity)), "utf8")
    .digest("hex");
}

function suppliedDiscriminatorCount(identity: SponsorIdentity): {
  locations: number;
  recordDetails: number;
} {
  return {
    locations: LOCATION_FIELDS.filter((field) =>
      normalizeSponsorIdentityValue(identity[field]),
    ).length,
    recordDetails: RECORD_DETAIL_FIELDS.filter((field) =>
      normalizeSponsorIdentityValue(identity[field]),
    ).length,
  };
}

export function sponsorIdentityMatchesProvidedFields(
  source: SponsorIdentity,
  target: SponsorIdentity,
): boolean {
  if (
    normalizeSponsorLegalNameValue(source.organisationName) !==
    normalizeSponsorLegalNameValue(target.organisationName)
  ) {
    return false;
  }

  return IDENTITY_FIELDS.slice(1).every((field) => {
    const sourceValue = normalizeSponsorIdentityValue(source[field]);
    return !sourceValue || sourceValue === normalizeSponsorIdentityValue(target[field]);
  });
}

export function resolveSponsorIdentity(
  source: SponsorIdentity,
  targets: SponsorIdentityTarget[],
  mappedTargetId?: number | null,
): SponsorIdentityMatch {
  const name = normalizeSponsorLegalNameValue(source.organisationName);
  if (!name) return { status: "incomplete_identity", matches: [] };

  const sameName = targets.filter(
    (target) =>
      normalizeSponsorLegalNameValue(target.organisationName) === name,
  );

  if (mappedTargetId != null) {
    const mappedTarget = targets.find((target) => target.id === mappedTargetId);
    if (mappedTarget && sponsorIdentityMatchesProvidedFields(source, mappedTarget)) {
      return { status: "manual_mapping", target: mappedTarget, matches: [mappedTarget] };
    }
    return { status: "identity_conflict", matches: sameName };
  }

  const matchingTargets = sameName.filter((target) =>
    sponsorIdentityMatchesProvidedFields(source, target),
  );
  if (matchingTargets.length === 0) {
    return sameName.length
      ? { status: "identity_conflict", matches: sameName }
      : { status: "not_found", matches: [] };
  }
  if (matchingTargets.length > 1) {
    return { status: "ambiguous", matches: matchingTargets };
  }

  const discriminatorCount = suppliedDiscriminatorCount(source);
  if (discriminatorCount.locations === 0 || discriminatorCount.recordDetails === 0) {
    return { status: "incomplete_identity", matches: matchingTargets };
  }
  return { status: "exact_unique", target: matchingTargets[0]!, matches: matchingTargets };
}

export function normalizeImportUrl(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  try {
    const parsed = new URL(value.trim());
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return "";
    }
    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.hash = "";
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return "";
  }
}