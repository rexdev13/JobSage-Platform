import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsvObjects,
  stringifyCsv,
} from "../../../scripts/src/sponsor-contact-discovery/csv";
import {
  normalizeImportUrl,
  normalizeSponsorLegalNameValue,
} from "../src/lib/sponsorWebsiteCrossEnvIdentity";
import {
  buildSponsorWebsiteImportPlan,
  type SponsorWebsiteImportCandidate,
  type SponsorWebsiteImportField,
  type SponsorWebsiteImportRowPlan,
  type SponsorWebsiteImportPlan,
  type SponsorCareersProductionTarget,
  type SponsorIdentityMapping,
  type SponsorWebsiteProductionTarget,
} from "../src/lib/sponsorWebsiteImportPlan";

type CsvRow = Record<string, string> & {
  field: string;
  source_ref: string;
};
type ProductionSnapshot = {
  capturedOn: string;
  sponsors: SponsorWebsiteProductionTarget[];
  careers: SponsorCareersProductionTarget[];
  mappings: SponsorIdentityMapping[];
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const DATA_DIR = path.join(
  WORKSPACE_ROOT,
  "artifacts/production-url-resolution-2026-09-28",
);
const LATEST_FILE = path.join(DATA_DIR, "reviewed-source-import-candidates.csv");
const PRIOR_SAFE_FILE = path.join(DATA_DIR, "safe-auto-resolved.csv");
const SNAPSHOT_FILE = path.join(DATA_DIR, "current-production-import-state.json");
const FINAL_FILE = path.join(DATA_DIR, "final-approved-production-url-import.csv");
const REPORT_FILE = path.join(DATA_DIR, "final-production-url-import-validation.md");
const PILOT_SOURCE_POOL_FILE = path.join(DATA_DIR, "vacancy-pilot-candidate-pool.csv");
const PILOT_FINAL_POOL_FILE = path.join(DATA_DIR, "vacancy-pilot-final-candidate-pool.csv");
const PILOT_ALLOWLIST_FILE = path.join(DATA_DIR, "vacancy-pilot-allowlist.csv");
const PILOT_FIRST_SOURCE_FILE = path.join(DATA_DIR, "vacancy-pilot-first-source.csv");
const PILOT_PROBE_FILE = path.join(DATA_DIR, "pilot-live-probe-statuses.json");

const IMPORT_COLUMNS = [
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
];

function readCsv(filePath: string): CsvRow[] {
  return parseCsvObjects(readFileSync(filePath, "utf8")) as CsvRow[];
}

function value(row: Record<string, string>, key: string): string {
  return String(row[key] ?? "").trim();
}

function toImportRow(row: CsvRow, reasonCodeFallback: string): CsvRow {
  return Object.fromEntries(IMPORT_COLUMNS.map((column) => [
    column,
    column === "reason_code"
      ? value(row, column) || value(row, "resolver_classification") || reasonCodeFallback
      : value(row, column),
  ])) as CsvRow;
}

function importTuple(row: CsvRow): string {
  return [
    value(row, "field").toLowerCase(),
    normalizeSponsorLegalNameValue(value(row, "organisation_name")),
    normalizeImportUrl(value(row, "candidate_url")),
  ].join("|");
}

function toCandidate(row: CsvRow): SponsorWebsiteImportCandidate {
  const field = value(row, "field").toLowerCase();
  if (field !== "website" && field !== "careers") {
    throw new Error(`Invalid URL field for ${value(row, "source_ref")}: ${field}`);
  }
  return {
    sourceRef: value(row, "source_ref"),
    field: field as SponsorWebsiteImportField,
    confidence: value(row, "confidence").toLowerCase(),
    developmentConfidence: value(row, "development_confidence").toLowerCase(),
    organisationName: value(row, "organisation_name"),
    townCity: value(row, "town_city"),
    county: value(row, "county"),
    region: value(row, "region"),
    industry: value(row, "industry"),
    route: value(row, "route"),
    subRoute: value(row, "sub_route"),
    candidateUrl: value(row, "candidate_url"),
    evidenceUrl: value(row, "evidence_url"),
    verificationEvidence: value(row, "verification_evidence"),
    developmentCurrentValue: value(row, "development_current_value"),
    developmentAction: value(row, "development_action").toLowerCase(),
    verificationStatus: value(row, "verification_status").toLowerCase(),
    reasonCode: value(row, "reason_code"),
  };
}

function statusCounts(plan: SponsorWebsiteImportPlan): Record<string, number> {
  const entries = Object.entries(plan.counts)
    .map(([status, count]) => [status, Number(count)] as [string, number])
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries) as Record<string, number>;
}

function targetWriteKey(
  write: SponsorWebsiteImportPlan["writes"][number],
): string {
  const target = write.field === "website"
    ? `website:${write.targetSponsorLicenceId}`
    : write.targetCompanySiteCheckId == null
      ? `careers:new:${normalizeSponsorLegalNameValue(write.organisationName)}`
      : `careers:${write.targetCompanySiteCheckId}`;
  return `${target}|${write.field}|${normalizeImportUrl(write.url)}`;
}

function assertNoWriteCollisions(plan: SponsorWebsiteImportPlan): {
  uniqueWriteKeys: number;
  duplicateWriteKeys: number;
  collidingTargets: number;
  nonblankWrites: number;
} {
  const seen = new Set<string>();
  const urlsByTarget = new Map<string, Set<string>>();
  let duplicateWriteKeys = 0;
  let nonblankWrites = 0;
  for (const write of plan.writes) {
    const key = targetWriteKey(write);
    if (seen.has(key)) duplicateWriteKeys += 1;
    seen.add(key);
    const target = key.slice(0, key.lastIndexOf("|"));
    const urls = urlsByTarget.get(target) ?? new Set<string>();
    urls.add(normalizeImportUrl(write.url));
    urlsByTarget.set(target, urls);
    if (String(write.currentValue ?? "").trim()) nonblankWrites += 1;
  }
  const collidingTargets = [...urlsByTarget.values()].filter((urls) => urls.size > 1).length;
  if (duplicateWriteKeys || collidingTargets || nonblankWrites) {
    throw new Error(
      `Unsafe write plan: duplicate keys=${duplicateWriteKeys}, colliding targets=${collidingTargets}, nonblank values=${nonblankWrites}.`,
    );
  }
  return {
    uniqueWriteKeys: seen.size,
    duplicateWriteKeys,
    collidingTargets,
    nonblankWrites,
  };
}

function countField(rows: Array<{ field: string }>, field: string): number {
  return rows.filter((row) => row.field === field).length;
}

function summarizeRows(rows: SponsorWebsiteImportRowPlan[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join("\n");
}

function summarizeExcludedRows(rows: SponsorWebsiteImportRowPlan[]): string {
  return rows
    .filter((row) => row.status !== "safe_to_import")
    .map((row) => [
      row.sourceRef,
      row.field,
      row.status,
      row.reason.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim(),
    ])
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
}

function main(): void {
  const latestRows = readCsv(LATEST_FILE).map((row) =>
    toImportRow(row, "latest_blocker_review"),
  );
  const priorSafeRows = readCsv(PRIOR_SAFE_FILE).map((row) =>
    toImportRow(row, "prior_safe_auto_resolve"),
  );
  const snapshot = JSON.parse(
    readFileSync(SNAPSHOT_FILE, "utf8"),
  ) as ProductionSnapshot;

  const latestByRef = new Map<string, CsvRow>();
  for (const row of latestRows) {
    const sourceRef = value(row, "source_ref");
    if (!sourceRef || latestByRef.has(sourceRef)) {
      throw new Error(`Latest candidate file has an empty or duplicate source_ref: ${sourceRef}`);
    }
    latestByRef.set(sourceRef, row);
  }

  let priorAlreadyIncluded = 0;
  const priorOnlyRows: CsvRow[] = [];
  for (const prior of priorSafeRows) {
    const sourceRef = value(prior, "source_ref");
    const current = latestByRef.get(sourceRef);
    if (!current) {
      priorOnlyRows.push(prior);
      continue;
    }
    if (importTuple(current) !== importTuple(prior)) {
      throw new Error(
        `Prior safe candidate ${sourceRef} disagrees with the latest candidate's field, employer, or normalized URL.`,
      );
    }
    priorAlreadyIncluded += 1;
  }

  const unionRows = [...latestRows, ...priorOnlyRows];
  const refs = new Set<string>();
  for (const row of unionRows) {
    const sourceRef = value(row, "source_ref");
    if (refs.has(sourceRef)) {
      throw new Error(`Combined candidates contain duplicate source_ref ${sourceRef}.`);
    }
    refs.add(sourceRef);
  }

  const candidateNames = new Set(
    unionRows.map((row) =>
      normalizeSponsorLegalNameValue(value(row, "organisation_name")),
    ).filter(Boolean),
  );
  const liveNames = new Set(
    snapshot.sponsors.map((target) =>
      normalizeSponsorLegalNameValue(target.organisationName),
    ),
  );
  const missingLiveNames = [...candidateNames].filter((name) => !liveNames.has(name));
  if (missingLiveNames.length) {
    throw new Error(
      `The captured production snapshot misses ${missingLiveNames.length} candidate employer names; refresh it before planning.`,
    );
  }

  const unionCsv = stringifyCsv(unionRows, IMPORT_COLUMNS);
  const unionPlan = buildSponsorWebsiteImportPlan({
    candidates: unionRows.map(toCandidate),
    sponsors: snapshot.sponsors,
    careersTargets: snapshot.careers,
    mappings: snapshot.mappings,
    inputHash: createHash("sha256").update(unionCsv).digest("hex"),
  });

  const safeSourceRefs = new Set(
    unionPlan.rows
      .filter((row) => row.status === "safe_to_import")
      .map((row) => row.sourceRef),
  );
  const unionByRef = new Map(unionRows.map((row) => [value(row, "source_ref"), row]));
  const finalRows = [...safeSourceRefs]
    .map((sourceRef) => unionByRef.get(sourceRef)!)
    .sort((a, b) => value(a, "source_ref").localeCompare(value(b, "source_ref")));
  const finalCsv = stringifyCsv(finalRows, IMPORT_COLUMNS);
  const finalFileSha256 = createHash("sha256").update(finalCsv).digest("hex");
  writeFileSync(FINAL_FILE, finalCsv, "utf8");
  const uploadedCsv = readFileSync(FINAL_FILE, "utf8");
  if (createHash("sha256").update(uploadedCsv).digest("hex") !== finalFileSha256) {
    throw new Error("The final CSV changed after it was written.");
  }
  const uploadedRows = parseCsvObjects(uploadedCsv) as CsvRow[];
  const requiredColumns = IMPORT_COLUMNS.filter((column) => column !== "reason_code");
  if (
    uploadedRows.length !== finalRows.length ||
    uploadedRows.some((row) => requiredColumns.some((column) => !(column in row)))
  ) {
    throw new Error("The final CSV does not round-trip with all protected-importer columns.");
  }
  const finalPlan = buildSponsorWebsiteImportPlan({
    candidates: uploadedRows.map(toCandidate),
    sponsors: snapshot.sponsors,
    careersTargets: snapshot.careers,
    mappings: snapshot.mappings,
    inputHash: createHash("sha256").update(uploadedCsv).digest("hex"),
  });
  if (
    finalPlan.rows.length !== finalRows.length ||
    finalPlan.rows.some((row) => row.status !== "safe_to_import")
  ) {
    throw new Error("Filtered final CSV did not preview as safe_to_import for every row.");
  }

  const finalWriteSafety = assertNoWriteCollisions(finalPlan);
  const inputCounts = statusCounts(unionPlan);
  const applyCounts = statusCounts(finalPlan);
  const pilotPool = parseCsvObjects(readFileSync(PILOT_SOURCE_POOL_FILE, "utf8")) as Array<
    Record<string, string>
  >;
  const pilotProbeSnapshot = JSON.parse(
    readFileSync(PILOT_PROBE_FILE, "utf8"),
  ) as {
    capturedOn: string;
    rows: Array<{ organisationName: string; probeStatus: string | null }>;
  };
  const badProbeEmployers = new Set(
    pilotProbeSnapshot.rows
      .filter((row) => String(row.probeStatus ?? "").toLowerCase() === "bad")
      .map((row) => normalizeSponsorLegalNameValue(row.organisationName)),
  );
  const plannedWebsiteUrlsByTarget = new Map<number, Set<string>>();
  for (const write of finalPlan.writes) {
    if (write.field !== "website") continue;
    const urls = plannedWebsiteUrlsByTarget.get(write.targetSponsorLicenceId) ?? new Set<string>();
    urls.add(normalizeImportUrl(write.url));
    plannedWebsiteUrlsByTarget.set(write.targetSponsorLicenceId, urls);
  }
  const eligiblePilotPool = pilotPool
    .filter((row) => {
      const organisationName = value(row, "organisation_name");
      const normalizedName = normalizeSponsorLegalNameValue(organisationName);
      const targetId = Number(value(row, "sponsor_target_id"));
      const candidateUrl = normalizeImportUrl(value(row, "candidate_url"));
      const afterImportUrl = normalizeImportUrl(value(row, "website_after_apply"));
      const probeStatus = value(row, "careers_probe_status").toLowerCase();
      return (
        value(row, "newly_resolved_field").toLowerCase() === "website" &&
        Number.isSafeInteger(targetId) &&
        candidateUrl !== "" &&
        candidateUrl === afterImportUrl &&
        plannedWebsiteUrlsByTarget.get(targetId)?.has(afterImportUrl) === true &&
        !probeStatus.includes("bad") &&
        !badProbeEmployers.has(normalizedName)
      );
    })
    .sort((a, b) =>
      normalizeSponsorLegalNameValue(value(a, "organisation_name"))
        .localeCompare(normalizeSponsorLegalNameValue(value(b, "organisation_name"))) ||
      value(a, "organisation_name").localeCompare(value(b, "organisation_name")),
    );
  const pilotPoolByEmployer = new Map<string, Record<string, string>>();
  for (const row of eligiblePilotPool) {
    const key = normalizeSponsorLegalNameValue(value(row, "organisation_name"));
    if (key && !pilotPoolByEmployer.has(key)) pilotPoolByEmployer.set(key, row);
  }
  const finalPilotPool = [...pilotPoolByEmployer.values()];
  if (finalPilotPool.length < 10) {
    throw new Error(
      `Only ${finalPilotPool.length} pilot employers remain after final-import and probe checks; cannot prepare a ten-employer pilot.`,
    );
  }
  const pilotAllowlist = finalPilotPool.slice(0, 10);
  const pilotKnownBadSourceRows = pilotPool.filter((row) =>
    value(row, "careers_probe_status").toLowerCase().includes("bad") ||
    badProbeEmployers.has(
      normalizeSponsorLegalNameValue(value(row, "organisation_name")),
    ),
  ).length;
  const pilotWithoutFinalWebsiteWrite = pilotPool.filter((row) => {
    const targetId = Number(value(row, "sponsor_target_id"));
    const candidateUrl = normalizeImportUrl(value(row, "candidate_url"));
    const afterImportUrl = normalizeImportUrl(value(row, "website_after_apply"));
    return (
      value(row, "newly_resolved_field").toLowerCase() !== "website" ||
      !candidateUrl ||
      candidateUrl !== afterImportUrl ||
      plannedWebsiteUrlsByTarget.get(targetId)?.has(afterImportUrl) !== true
    );
  }).length;
  const pilotPoolColumns = Object.keys(pilotPool[0] ?? {});
  const pilotAllowlistColumns = Object.keys(
    parseCsvObjects(readFileSync(PILOT_ALLOWLIST_FILE, "utf8"))[0] ?? {},
  );
  const pilotFirstSourceColumns = Object.keys(
    parseCsvObjects(readFileSync(PILOT_FIRST_SOURCE_FILE, "utf8"))[0] ?? {},
  );
  writeFileSync(
    PILOT_FINAL_POOL_FILE,
    stringifyCsv(finalPilotPool, pilotPoolColumns),
    "utf8",
  );
  writeFileSync(
    PILOT_ALLOWLIST_FILE,
    stringifyCsv(
      pilotAllowlist.map((row) =>
        Object.fromEntries(pilotAllowlistColumns.map((column) => [column, row[column] ?? ""])),
      ),
      pilotAllowlistColumns,
    ),
    "utf8",
  );
  writeFileSync(
    PILOT_FIRST_SOURCE_FILE,
    stringifyCsv(
      [pilotAllowlist[0]!].map((row) =>
        Object.fromEntries(pilotFirstSourceColumns.map((column) => [column, row[column] ?? ""])),
      ),
      pilotFirstSourceColumns,
    ),
    "utf8",
  );
  const pilotNames = pilotAllowlist.map((row) => value(row, "organisation_name"));
  const pilotRequestBody = JSON.stringify({
    kind: "company_site",
    limit: 10,
    organisationNames: pilotNames,
  }, null, 2);
  const priorAudit = JSON.parse(
    readFileSync(path.join(DATA_DIR, "production-apply-audit.json"), "utf8"),
  ) as {
    createdAt: string;
    action: string;
    target: string;
    details: {
      rowCount: number;
      websiteUpdates: number;
      careersUpdates: number;
      mappingsStored: number;
      counts: Record<string, number>;
    };
  };

  const report = [
    "# Consolidated production URL import — read-only preflight",
    "",
    `Production snapshot date: ${snapshot.capturedOn}.`,
    "",
    "## Source reconciliation",
    "",
    `- Earlier safe candidate file: ${priorSafeRows.length} rows.`,
    `- Latest blocker-review candidate file: ${latestRows.length} rows.`,
    `- Earlier safe rows already represented in the latest file: ${priorAlreadyIncluded}.`,
    `- Earlier safe rows added separately because they were absent from the latest file: ${priorOnlyRows.length}.`,
    `- Combined distinct input rows sent through the import planner: ${unionRows.length}.`,
    `- Distinct normalized employer names in the candidates: ${candidateNames.size}.`,
    `- Current production sponsor targets loaded for those names: ${snapshot.sponsors.length}.`,
    `- Current company-site/careers targets loaded for those names: ${snapshot.careers.length}.`,
    `- Production identity-crosswalk mappings loaded: ${snapshot.mappings.length}.`,
    `- Separate previous production apply audit: ${priorAudit.createdAt}; ${priorAudit.details.rowCount} input rows, ${priorAudit.details.websiteUpdates} website updates and ${priorAudit.details.careersUpdates} careers/source updates (${priorAudit.details.counts.safe_to_import} approved rows); ${priorAudit.details.mappingsStored} identity mappings stored.`,
    "",
    "## Read-only importer-plan validation",
    "",
    "This uses the protected admin importer's shared planning function against a fresh read-only production snapshot. It does not call the apply, stage, or production preview endpoints. No authenticated production super-admin session was available for a live endpoint preview; no credentials were requested or used.",
    `- Already-present candidate URLs in the current production snapshot: ${unionPlan.rows.filter((row) => row.status === "already_matches_production_noop").length}.`,
    `- Candidates held because of an existing production URL value: ${unionPlan.rows.filter((row) => row.status === "manual_review_existing_production_value").length}.`,
    "",
    "| Input disposition | Rows |",
    "| --- | ---: |",
    summarizeRows(unionPlan.rows),
    "",
    "Excluded candidates:",
    "",
    "| source_ref | URL type | disposition | reason |",
    "| --- | --- | --- | --- |",
    summarizeExcludedRows(unionPlan.rows),
    "",
    "## Final CSV",
    "",
    `- File: \`${path.basename(FINAL_FILE)}\`.`,
    `- Candidate rows: ${finalRows.length}.`,
    `- Website rows: ${countField(finalRows, "website")}.`,
    `- Careers/source rows: ${countField(finalRows, "careers")}.`,
    `- Planned production writes after duplicate-group fan-out: ${finalPlan.writes.length}.`,
    `- Website target writes: ${countField(finalPlan.writes, "website")}.`,
    `- Careers/source target writes: ${countField(finalPlan.writes, "careers")}.`,
    `- Duplicate target/type/normalized-URL write keys: ${finalWriteSafety.duplicateWriteKeys}.`,
    `- Targets with competing URLs: ${finalWriteSafety.collidingTargets}.`,
    `- Nonblank production values that would be overwritten: ${finalWriteSafety.nonblankWrites}.`,
    `- CSV SHA-256: \`${finalFileSha256}\`.`,
    `- Input plan hash: \`${finalPlan.planHash}\`.`,
    "",
    "## Manual production import steps",
    "",
    "1. Open the published JOBSAGE production app and sign in as a super-admin.",
    "2. Open **Admin → Sponsor website and careers import** and upload this CSV.",
    "3. Run **Preview**. Confirm the environment is `production`; every row is `safe_to_import`; the row count, write count, website/careers write counts, and no-op/manual/collision counts match this report.",
    "4. If any value differs, or production changed since this snapshot, do not apply. Refresh the production snapshot and regenerate the package.",
    "5. Apply only after reviewing the live preview and its plan hash. The endpoint locks and rechecks targets, fills blank fields only, and records an audit event.",
    "",
    "This package is ready to upload for a fresh live preview. It is not authorization to bypass that preview or to apply if the live plan differs.",
    "",
    "## Bounded vacancy pilot",
    "",
    `- The original candidate pool had ${pilotPool.length} employers. The final pool has ${finalPilotPool.length} employers after matching each URL to a planned final-import website write; ${pilotWithoutFinalWebsiteWrite} candidates had no matching final write. Current production probe rows matched: ${pilotProbeSnapshot.rows.length}; known-bad candidates: ${pilotKnownBadSourceRows}.`,
    "- The prepared `vacancy-pilot-allowlist.csv` contains ten distinct exact employer names. `vacancy-pilot-first-source.csv` is the first listed employer for a separate one-employer smoke test if requested.",
    "",
    "Do not run ingestion now. After a successful manual URL import, a separately approved production publish containing the allowlist filter, and separate pilot authorization, send one request to the production service's `/internal/vacancy-jobs` route:",
    "",
    "```json",
    pilotRequestBody,
    "```",
    "",
    "The company-site selector chooses distinct employer names before applying the batch limit, so this payload is bounded to at most ten employers and ten selected rows. Before any future call, confirm the effective `COMPANY_SITE_BATCH_SIZE` is ten, the AI web-search cap is zero, the production deployment includes the `organisationNames` filter, and no other batch is running. Do not retry automatically on a conflict or timeout; inspect the result first. The configured job secret must remain in the existing secret flow and must not be placed in this plan.",
    "",
  ].join("\n");
  writeFileSync(REPORT_FILE, report, "utf8");

  console.log(JSON.stringify({
    priorSafeRows: priorSafeRows.length,
    latestRows: latestRows.length,
    priorAlreadyIncluded,
    priorOnlyRows: priorOnlyRows.length,
    unionInputRows: unionRows.length,
    inputCounts,
    finalRows: finalRows.length,
    finalWebsiteRows: countField(finalRows, "website"),
    finalCareersRows: countField(finalRows, "careers"),
    finalWrites: finalPlan.writes.length,
    websiteWrites: countField(finalPlan.writes, "website"),
    careersWrites: countField(finalPlan.writes, "careers"),
    finalPlanCounts: applyCounts,
    finalWriteSafety,
    finalFileSha256,
    planHash: finalPlan.planHash,
    pilotEligibleEmployers: finalPilotPool.length,
    pilotNames,
    finalFile: FINAL_FILE,
    reportFile: REPORT_FILE,
  }, null, 2));
}

main();