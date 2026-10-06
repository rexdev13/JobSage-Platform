import type { Stage1OdsWebsiteRow } from "./stage1OdsWebsiteTargets";

export type Stage2OdsCandidate = {
  id: string;
  organisation_name: string;
  town_city: string;
  county: string;
  region: string;
  industry: string;
  website: string;
  website_ods_code: string;
  website_ods_record_url: string;
};

export type OdsTrustSummary = {
  Name: string;
  OrgId: string;
  Status: string;
  PrimaryRoleId: string;
  PrimaryRoleDescription: string;
  OrgLink: string;
};

type OdsRole = {
  id?: string;
  Status?: string;
};

type OdsContact = {
  type?: string;
  value?: string;
};

export type OdsOrganisation = {
  Name?: string;
  Status?: string;
  OrgId?: { extension?: string };
  Roles?: { Role?: OdsRole | OdsRole[] };
  GeoLoc?: { Location?: { Town?: string } };
  Contacts?: { Contact?: OdsContact | OdsContact[] };
};

export type OdsDetailSnapshotEntry = {
  code: string;
  record: OdsOrganisation;
};

export type Stage2OdsClassification = {
  sourceRowId: string;
  sourceGroup: string;
  organisationName: string;
  townCity: string;
  county: string;
  industry: string;
  classification: "CLEAN" | "HELD" | "CONFLICT" | "NO_MATCH";
  reason: string;
  exactOdsName: string;
  odsStatus: string;
  odsCode: string;
  odsTown: string;
  odsWebsite: string;
  odsListedHttpContacts: string[];
  odsRecordUrl: string;
  explicitNonWriteHold: boolean;
};

export type Stage2OdsWriteTarget = {
  organisationName: string;
  odsName: string;
  odsCode: string;
  website: string;
  odsRecordUrl: string;
  expectedRowCount: number;
};

export type Stage2OdsWritePlan = {
  version: 1;
  generatedAt: string;
  targets: Stage2OdsWriteTarget[];
};

export type Stage2OdsWriterRow = Pick<
  Stage2OdsCandidate,
  "id" | "organisation_name" | "website" | "website_ods_code" | "website_ods_record_url"
>;

export function normalizeOdsExactName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOdsLocation(value: string | null | undefined): string {
  return normalizeOdsExactName(value);
}

function writerNameKey(value: string): string {
  return value.trim().toLowerCase();
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function normalisedHttpsContacts(record: OdsOrganisation): {
  listedHttpContacts: string[];
  httpsWebsites: string[];
} {
  const listedHttpContacts = [
    ...new Set(
      asArray(record.Contacts?.Contact)
        .filter((contact) => contact.type?.toLowerCase() === "http")
        .map((contact) => contact.value?.trim() ?? "")
        .filter(Boolean),
    ),
  ];
  const httpsWebsites = new Set<string>();
  for (const value of listedHttpContacts) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && url.hostname && !url.username && !url.password) {
        httpsWebsites.add(url.toString());
      }
    } catch {
      // Invalid ODS contact values are retained in the report, but never used as websites.
    }
  }
  return {
    listedHttpContacts,
    httpsWebsites: [...httpsWebsites],
  };
}

function odsRecordUrl(code: string): string {
  return `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/${encodeURIComponent(code)}`;
}

export function classifyStage2OdsCandidates(
  candidates: readonly Stage2OdsCandidate[],
  summaries: readonly OdsTrustSummary[],
  details: readonly OdsDetailSnapshotEntry[],
  explicitNonWriteNames: readonly string[] = [],
): Stage2OdsClassification[] {
  const summariesByName = new Map<string, OdsTrustSummary[]>();
  for (const summary of summaries) {
    const key = normalizeOdsExactName(summary.Name);
    const matching = summariesByName.get(key) ?? [];
    matching.push(summary);
    summariesByName.set(key, matching);
  }
  const detailsByCode = new Map(details.map((entry) => [entry.code, entry.record]));
  const explicitHoldKeys = new Set(explicitNonWriteNames.map(normalizeOdsExactName));

  return candidates.map((candidate) => {
    const exactName = normalizeOdsExactName(candidate.organisation_name);
    const explicitNonWriteHold = explicitHoldKeys.has(exactName);
    const base = {
      sourceRowId: candidate.id,
      sourceGroup: candidate.industry === "Healthcare"
        ? "Healthcare industry"
        : "Healthcare/NHS-name row outside Healthcare industry",
      organisationName: candidate.organisation_name,
      townCity: candidate.town_city,
      county: candidate.county,
      industry: candidate.industry,
      exactOdsName: "",
      odsStatus: "",
      odsCode: "",
      odsTown: "",
      odsWebsite: "",
      odsListedHttpContacts: [] as string[],
      odsRecordUrl: "",
      explicitNonWriteHold,
    };
    const exactRecords = summariesByName.get(exactName) ?? [];

    if (exactRecords.length === 0) {
      return {
        ...base,
        classification: "NO_MATCH",
        reason: explicitNonWriteHold
          ? "No exact NHS Trust name in the ODS role search; explicitly named for non-write review."
          : "No exact NHS Trust name in the current ODS role search.",
      };
    }

    const activeRecords = exactRecords.filter((record) =>
      record.Status === "Active" &&
      record.PrimaryRoleId === "RO197" &&
      record.PrimaryRoleDescription === "NHS TRUST"
    );
    const inactiveRecords = exactRecords.filter((record) =>
      record.Status === "Inactive" &&
      record.PrimaryRoleId === "RO197" &&
      record.PrimaryRoleDescription === "NHS TRUST"
    );

    if (activeRecords.length === 0) {
      return {
        ...base,
        classification: "HELD",
        reason: explicitNonWriteHold
          ? "No active exact-name NHS Trust record; explicitly named for non-write review."
          : "An exact-name ODS NHS Trust record exists, but none is active.",
        exactOdsName: exactRecords[0]?.Name ?? "",
        odsStatus: inactiveRecords.map((record) => record.Status).join("|"),
        odsCode: inactiveRecords.map((record) => record.OrgId).join("|"),
      };
    }

    if (activeRecords.length > 1) {
      return {
        ...base,
        classification: explicitNonWriteHold ? "HELD" : "CONFLICT",
        reason: explicitNonWriteHold
          ? "Multiple active exact-name ODS NHS Trust records; explicitly named for non-write review."
          : "More than one active exact-name ODS NHS Trust record.",
        exactOdsName: activeRecords.map((record) => record.Name).join(" | "),
        odsStatus: activeRecords.map((record) => record.Status).join("|"),
        odsCode: activeRecords.map((record) => record.OrgId).join("|"),
      };
    }

    const summary = activeRecords[0]!;
    const detail = detailsByCode.get(summary.OrgId);
    const detailRoles = asArray(detail?.Roles?.Role);
    const activeTrustRoles = detailRoles.filter((role) =>
      role.id === "RO197" && role.Status === "Active"
    );
    const odsTown = detail?.GeoLoc?.Location?.Town?.trim() ?? "";
    const websites = detail ? normalisedHttpsContacts(detail) : {
      listedHttpContacts: [] as string[],
      httpsWebsites: [] as string[],
    };
    const hasOneHttpsWebsite = websites.httpsWebsites.length === 1;
    const locationAgrees = Boolean(
      candidate.town_city.trim() &&
      odsTown &&
      normalizeOdsLocation(candidate.town_city) === normalizeOdsLocation(odsTown),
    );
    const recordConfirmed = Boolean(
      detail &&
      detail.Status === "Active" &&
      normalizeOdsExactName(detail.Name) === normalizeOdsExactName(summary.Name) &&
      detail.OrgId?.extension === summary.OrgId &&
      activeTrustRoles.length === 1,
    );
    const failures: string[] = [];

    if (!recordConfirmed) {
      failures.push("The full ODS record does not confirm one active RO197 NHS TRUST record.");
    }
    if (!locationAgrees) {
      failures.push(
        `Location mismatch or missing town (sponsor: ${candidate.town_city || "(blank)"}; ODS: ${odsTown || "(blank)"}).`,
      );
    }
    if (!hasOneHttpsWebsite) {
      failures.push(websites.httpsWebsites.length === 0
        ? "The ODS record lists no valid HTTPS website."
        : "The ODS record lists multiple distinct HTTPS websites.");
    }

    const evidence = {
      ...base,
      exactOdsName: summary.Name,
      odsStatus: detail?.Status ?? summary.Status,
      odsCode: summary.OrgId,
      odsTown,
      odsWebsite: hasOneHttpsWebsite ? websites.httpsWebsites[0]! : "",
      odsListedHttpContacts: websites.listedHttpContacts,
      odsRecordUrl: odsRecordUrl(summary.OrgId),
    };

    if (explicitNonWriteHold) {
      return {
        ...evidence,
        classification: "HELD",
        reason: [
          ...failures,
          "Explicitly named for non-write review.",
        ].join(" "),
      };
    }
    if (failures.some((failure) => failure.startsWith("Location mismatch"))) {
      return {
        ...evidence,
        classification: "CONFLICT",
        reason: failures.join(" "),
      };
    }
    if (failures.length > 0) {
      return {
        ...evidence,
        classification: "HELD",
        reason: failures.join(" "),
      };
    }
    return {
      ...evidence,
      classification: "CLEAN",
      reason: "Exact active NHS Trust record; town agrees; one HTTPS ODS website listed.",
    };
  });
}

export function buildStage2OdsWritePlan(
  classifications: readonly Stage2OdsClassification[],
  writerRows: readonly Stage2OdsWriterRow[],
  generatedAt: string,
): { classifications: Stage2OdsClassification[]; plan: Stage2OdsWritePlan } {
  const result = classifications.map((classification) => ({ ...classification }));
  const candidateById = new Map(writerRows.map((row) => [row.id, row]));
  const cleanGroups = new Map<string, Stage2OdsClassification[]>();

  for (const classification of result) {
    if (classification.classification !== "CLEAN") continue;
    const key = writerNameKey(classification.organisationName);
    const group = cleanGroups.get(key) ?? [];
    group.push(classification);
    cleanGroups.set(key, group);
  }

  const targets: Stage2OdsWriteTarget[] = [];
  for (const [key, group] of cleanGroups) {
    const ids = new Set(group.map((row) => row.sourceRowId));
    const matchingWriterRows = writerRows.filter((row) =>
      writerNameKey(row.organisation_name) === key
    );
    const sameCandidateRows = matchingWriterRows.length === ids.size &&
      matchingWriterRows.every((row) => ids.has(row.id));
    const allBlank = matchingWriterRows.length > 0 && matchingWriterRows.every((row) =>
      !row.website.trim() &&
      !row.website_ods_code.trim() &&
      !row.website_ods_record_url.trim()
    );
    const sameOdsEvidence = group.every((row) =>
      row.odsCode === group[0]!.odsCode &&
      row.odsWebsite === group[0]!.odsWebsite &&
      row.odsRecordUrl === group[0]!.odsRecordUrl &&
      row.exactOdsName === group[0]!.exactOdsName
    );

    if (!sameCandidateRows || !allBlank || !sameOdsEvidence) {
      const reason = !sameCandidateRows
        ? "The production writer-name snapshot does not contain exactly the audited candidate rows."
        : !allBlank
          ? "At least one matching production row has a nonblank website or ODS evidence field."
          : "Duplicate sponsor rows do not share one identical ODS result.";
      for (const classification of group) {
        classification.classification = "HELD";
        classification.reason = reason;
      }
      continue;
    }

    targets.push({
      organisationName: group[0]!.organisationName,
      odsName: group[0]!.exactOdsName,
      odsCode: group[0]!.odsCode,
      website: group[0]!.odsWebsite,
      odsRecordUrl: group[0]!.odsRecordUrl,
      expectedRowCount: matchingWriterRows.length,
    });
  }

  const keys = new Set<string>();
  const codes = new Set<string>();
  for (const target of targets) {
    const key = writerNameKey(target.organisationName);
    if (keys.has(key)) throw new Error("Stage 2 write plan contains a duplicate sponsor name.");
    if (codes.has(target.odsCode)) {
      throw new Error("Stage 2 write plan maps multiple sponsor names to one ODS code.");
    }
    keys.add(key);
    codes.add(target.odsCode);
  }

  return {
    classifications: result,
    plan: { version: 1, generatedAt, targets },
  };
}

export function planStage2OdsWebsiteUpdates(
  plan: Stage2OdsWritePlan,
  selectedRows: readonly Stage1OdsWebsiteRow[],
): Stage2OdsWriteTarget[] {
  if (plan.version !== 1 || !Array.isArray(plan.targets)) {
    throw new Error("The Stage 2 ODS plan has an unsupported format.");
  }

  const targetsByName = new Map<string, Stage2OdsWriteTarget>();
  const codeSet = new Set<string>();
  for (const target of plan.targets) {
    const key = writerNameKey(target.organisationName);
    if (!key || targetsByName.has(key)) {
      throw new Error("Stage 2 ODS plan contains a blank or duplicate sponsor name.");
    }
    if (!/^[A-Z0-9]{2,8}$/i.test(target.odsCode)) {
      throw new Error(`Stage 2 ODS plan contains an invalid ODS code for ${target.organisationName}.`);
    }
    if (codeSet.has(target.odsCode)) {
      throw new Error("Stage 2 ODS plan maps multiple sponsor names to one ODS code.");
    }
    codeSet.add(target.odsCode);
    if (normalizeOdsExactName(target.organisationName) !== normalizeOdsExactName(target.odsName)) {
      throw new Error(`ODS name is not an exact normalized match for ${target.organisationName}.`);
    }
    if (!Number.isInteger(target.expectedRowCount) || target.expectedRowCount < 1) {
      throw new Error(`Stage 2 ODS plan has an invalid expected row count for ${target.organisationName}.`);
    }
    try {
      const website = new URL(target.website);
      if (website.protocol !== "https:" || !website.hostname || website.username || website.password) {
        throw new Error("invalid website");
      }
    } catch {
      throw new Error(`Stage 2 ODS plan contains an invalid HTTPS website for ${target.organisationName}.`);
    }
    if (target.odsRecordUrl !== odsRecordUrl(target.odsCode)) {
      throw new Error(`Stage 2 ODS plan contains an unexpected ODS record URL for ${target.organisationName}.`);
    }
    targetsByName.set(key, target);
  }

  const selectedByName = new Map<string, Stage1OdsWebsiteRow[]>();
  for (const row of selectedRows) {
    const key = writerNameKey(row.organisation_name);
    if (!targetsByName.has(key)) {
      throw new Error("Production selection returned a sponsor outside the approved Stage 2 list.");
    }
    const matches = selectedByName.get(key) ?? [];
    matches.push(row);
    selectedByName.set(key, matches);
  }

  for (const target of plan.targets) {
    const rows = selectedByName.get(writerNameKey(target.organisationName)) ?? [];
    if (rows.length !== target.expectedRowCount) {
      throw new Error(
        `Expected ${target.expectedRowCount} production sponsor rows for ${target.organisationName}; found ${rows.length}.`,
      );
    }
    if (rows.some((row) =>
      row.website?.trim() ||
      row.website_ods_code?.trim() ||
      row.website_ods_record_url?.trim()
    )) {
      throw new Error(`Refusing to overwrite a nonblank website or ODS field for ${target.organisationName}.`);
    }
  }

  if (selectedRows.length !== plan.targets.reduce((count, target) =>
    count + target.expectedRowCount, 0
  )) {
    throw new Error("Stage 2 production selection row count does not match the approved plan.");
  }
  return plan.targets;
}
