import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import {
  buildStage2OdsWritePlan,
  classifyStage2OdsCandidates,
  normalizeOdsExactName,
  type OdsDetailSnapshotEntry,
  type OdsTrustSummary,
  type Stage2OdsCandidate,
  type Stage2OdsClassification,
  type Stage2OdsWriterRow,
} from "./stage2OdsWebsiteTargets";

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUTPUT_DIR = resolve(WORKSPACE_ROOT, ".agents/outputs/ods-stage2-2026-10-06");
const CANDIDATE_FILE = resolve(
  OUTPUT_DIR,
  "production-healthcare-and-nhs-hospital-no-website.csv",
);
const WRITER_ROWS_FILE = resolve(
  OUTPUT_DIR,
  "production-exact-ods-writer-row-states.csv",
);
const ODS_SUMMARY_FILE = resolve(OUTPUT_DIR, "ods-trust-search.json");
const ODS_DETAILS_FILE = resolve(OUTPUT_DIR, "ods-trust-detail-records.json");
const EXPLICIT_HOLDS_FILE = resolve(OUTPUT_DIR, "manual-nonwrite-holds.json");
const PREFLIGHT_FILE = resolve(OUTPUT_DIR, "production-writer-preflight.json");
const READONLY_SNAPSHOT_FILE = resolve(OUTPUT_DIR, "production-readonly-count-snapshot.json");
const RECEIPT_FILE = resolve(OUTPUT_DIR, "production-writer-apply-receipt.json");

type OdsSummarySnapshot = {
  organisations: OdsTrustSummary[];
};

type OdsDetailSnapshot = {
  records: OdsDetailSnapshotEntry[];
};

type ManualHolds = {
  names: string[];
};

type ApplyReceipt = {
  status?: string;
  selectedEmployers?: number;
  writesAttempted?: number;
  updatedRows?: number;
  countsBefore?: Record<string, unknown>;
  countsAfter?: Record<string, unknown>;
};

type PreflightReceipt = {
  status?: string;
  reason?: string;
  databaseConnectionAttempted?: boolean;
  writesAttempted?: number;
  beforeImageCreated?: boolean;
};

type ReadonlyCountSnapshot = {
  capturedAt?: string;
  rowCount?: number;
  blankWebsiteRows?: number;
  blankAllThreeRows?: number;
  note?: string;
};

function readCsv<T extends Record<string, string>>(path: string): T[] {
  return parse(readFileSync(path, "utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as T[];
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n") + "\n";
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function countByClassification(
  rows: readonly Stage2OdsClassification[],
): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
    return counts;
  }, {});
}

function relatedOdsName(candidateName: string): string {
  const key = normalizeOdsExactName(candidateName);
  if (key === normalizeOdsExactName("Oxford University Hospitals NHS Trust")) {
    return "OXFORD UNIVERSITY HOSPITALS NHS FOUNDATION TRUST (RTH); not an exact name match";
  }
  if (key === normalizeOdsExactName("King's College Hospital Charity")) {
    return "KING'S COLLEGE HOSPITAL NHS FOUNDATION TRUST (RJZ); charity is not the Trust";
  }
  return "";
}

function buildWorkbook(
  summaryRows: Record<string, unknown>[],
  reportRows: Record<string, unknown>[],
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(summaryRows),
    "Summary",
  );
  for (const classification of ["CLEAN", "HELD", "CONFLICT", "NO_MATCH"]) {
    const rows = reportRows.filter((row) => row.classification === classification);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rows),
      classification === "NO_MATCH" ? "No match" : classification,
    );
  }
  return workbook;
}

function markdownTableRow(values: readonly unknown[]): string {
  return `| ${values.map((value) =>
    String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
  ).join(" | ")} |`;
}

function main(): void {
  for (const path of [
    CANDIDATE_FILE,
    WRITER_ROWS_FILE,
    ODS_SUMMARY_FILE,
    ODS_DETAILS_FILE,
    EXPLICIT_HOLDS_FILE,
  ]) {
    if (!existsSync(path)) throw new Error(`Required Stage 2 input is missing: ${path}`);
  }

  const candidates = readCsv<Stage2OdsCandidate>(CANDIDATE_FILE);
  const writerRows = readCsv<Stage2OdsCandidate>(WRITER_ROWS_FILE);
  const odsSearch = readJson<OdsSummarySnapshot>(ODS_SUMMARY_FILE);
  const odsDetails = readJson<OdsDetailSnapshot>(ODS_DETAILS_FILE);
  const manualHolds = readJson<ManualHolds>(EXPLICIT_HOLDS_FILE);
  const initialClassifications = classifyStage2OdsCandidates(
    candidates,
    odsSearch.organisations,
    odsDetails.records,
    manualHolds.names,
  );
  const { classifications, plan } = buildStage2OdsWritePlan(
    initialClassifications,
    writerRows as Stage2OdsWriterRow[],
    new Date().toISOString(),
  );

  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reportRows = classifications.map((classification) => {
    const candidate = candidatesById.get(classification.sourceRowId);
    if (!candidate) throw new Error("Classification is missing its source row.");
    return {
      source_row_id: classification.sourceRowId,
      source_group: classification.sourceGroup,
      organisation_name: classification.organisationName,
      town_city: classification.townCity,
      county: classification.county,
      industry: classification.industry,
      classification: classification.classification,
      reason: classification.reason,
      exact_ods_name: classification.exactOdsName,
      ods_status: classification.odsStatus,
      ods_code: classification.odsCode,
      ods_town: classification.odsTown,
      ods_website: classification.odsWebsite,
      ods_listed_http_contacts: classification.odsListedHttpContacts.join(" | "),
      ods_record_url: classification.odsRecordUrl,
      related_ods_record_note: relatedOdsName(classification.organisationName),
      website_before: candidate.website,
      ods_code_before: candidate.website_ods_code,
      ods_record_url_before: candidate.website_ods_record_url,
      website_after: classification.classification === "CLEAN"
        ? classification.odsWebsite
        : "",
      ods_code_after: classification.classification === "CLEAN"
        ? classification.odsCode
        : "",
      ods_record_url_after: classification.classification === "CLEAN"
        ? classification.odsRecordUrl
        : "",
    };
  });
  const counts = countByClassification(classifications);
  const cleanRows = classifications.filter((row) => row.classification === "CLEAN");
  const uniqueCleanNames = new Set(cleanRows.map((row) =>
    normalizeOdsExactName(row.organisationName)
  ));
  const sourceHealthcareRows = candidates.filter((row) => row.industry === "Healthcare").length;
  const additionalRows = candidates.length - sourceHealthcareRows;
  let applyReceipt: ApplyReceipt | null = null;
  if (existsSync(RECEIPT_FILE)) {
    applyReceipt = readJson<ApplyReceipt>(RECEIPT_FILE);
  }
  const preflightReceipt = existsSync(PREFLIGHT_FILE)
    ? readJson<PreflightReceipt>(PREFLIGHT_FILE)
    : null;
  const readonlySnapshot = existsSync(READONLY_SNAPSHOT_FILE)
    ? readJson<ReadonlyCountSnapshot>(READONLY_SNAPSHOT_FILE)
    : null;
  const applyStatus = applyReceipt?.status ??
    (preflightReceipt?.status === "blocked_before_database_connection"
      ? "Not applied; preflight blocked before database connection"
      : "Not yet applied");
  const writerCountsNotRun = "No writer transaction ran";

  const summaryRows: Record<string, unknown>[] = [
    { metric: "Candidate rows reviewed", value: candidates.length },
    { metric: "Healthcare-industry blank-website rows", value: sourceHealthcareRows },
    { metric: "Additional NHS/hospital/healthcare-name rows from other industries", value: additionalRows },
    { metric: "Active NHS Trust ODS search records", value: odsSearch.organisations.filter((row) => row.Status === "Active").length },
    { metric: "Inactive NHS Trust ODS search records", value: odsSearch.organisations.filter((row) => row.Status === "Inactive").length },
    { metric: "Clean rows", value: counts.CLEAN ?? 0 },
    { metric: "Clean distinct employers", value: uniqueCleanNames.size },
    { metric: "Held rows", value: counts.HELD ?? 0 },
    { metric: "Conflict rows", value: counts.CONFLICT ?? 0 },
    { metric: "No-match rows", value: counts.NO_MATCH ?? 0 },
    { metric: "Planned write rows", value: plan.targets.reduce((total, target) => total + target.expectedRowCount, 0) },
    { metric: "Planned write employers", value: plan.targets.length },
    { metric: "Production writer preflight status", value: preflightReceipt?.status ?? "Not run" },
    { metric: "Production writer preflight reason", value: preflightReceipt?.reason ?? "" },
    { metric: "Production apply status", value: applyStatus },
    { metric: "Rows written", value: applyReceipt?.writesAttempted ?? applyReceipt?.updatedRows ?? 0 },
    { metric: "Last read-only production sponsor rows", value: readonlySnapshot?.rowCount ?? "Not recorded" },
    { metric: "Last read-only blank websites", value: readonlySnapshot?.blankWebsiteRows ?? "Not recorded" },
    { metric: "Last read-only blank website/ODS rows", value: readonlySnapshot?.blankAllThreeRows ?? "Not recorded" },
    { metric: "Production sponsor rows before writer transaction", value: applyReceipt?.countsBefore?.rowCount ?? writerCountsNotRun },
    { metric: "Production sponsor rows after writer transaction", value: applyReceipt?.countsAfter?.rowCount ?? writerCountsNotRun },
    { metric: "Blank websites before writer transaction", value: applyReceipt?.countsBefore?.blankWebsiteRows ?? writerCountsNotRun },
    { metric: "Blank websites after writer transaction", value: applyReceipt?.countsAfter?.blankWebsiteRows ?? writerCountsNotRun },
  ];

  const columns = [
    "source_row_id",
    "source_group",
    "organisation_name",
    "town_city",
    "county",
    "industry",
    "classification",
    "reason",
    "exact_ods_name",
    "ods_status",
    "ods_code",
    "ods_town",
    "ods_website",
    "ods_listed_http_contacts",
    "ods_record_url",
    "related_ods_record_note",
    "website_before",
    "ods_code_before",
    "ods_record_url_before",
    "website_after",
    "ods_code_after",
    "ods_record_url_after",
  ];
  writeFileSync(
    resolve(OUTPUT_DIR, "ods-stage2-classification.csv"),
    toCsv(reportRows, columns),
  );
  writeFileSync(
    resolve(OUTPUT_DIR, "ods-stage2-apply-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  writeFileSync(
    resolve(OUTPUT_DIR, "ods-stage2-summary.json"),
    `${JSON.stringify({
      generatedAt: plan.generatedAt,
      candidateRows: candidates.length,
      sourceHealthcareRows,
      additionalRows,
      odsSearchRecordCount: odsSearch.organisations.length,
      odsDetailRecordCount: odsDetails.records.length,
      counts,
      distinctCleanEmployers: uniqueCleanNames.size,
      plannedTargets: plan.targets.length,
      plannedWriteRows: plan.targets.reduce((total, target) => total + target.expectedRowCount, 0),
      applyReceipt,
    }, null, 2)}\n`,
  );

  const examples = reportRows
    .filter((row) => row.classification === "CLEAN")
    .slice(0, 10);
  const markdown = [
    "# Stage 2 NHS ODS website match report",
    "",
    `Generated: ${plan.generatedAt}`,
    "",
    "## Scope and rules",
    "",
    `Reviewed ${candidates.length} blank-website rows: ${sourceHealthcareRows} rows classified as Healthcare, plus ${additionalRows} additional no-website rows whose employer names contain NHS, hospital, or healthcare terms outside that industry label. This includes NHS Trusts categorized as Public Services.`,
    "",
    `Compared against ${odsSearch.organisations.length} NHS Trust ODS search records (${odsSearch.organisations.filter((row) => row.Status === "Active").length} active and ${odsSearch.organisations.filter((row) => row.Status === "Inactive").length} inactive). Exact matching preserves legal suffixes; it normalizes case, spacing, punctuation, apostrophes, and ampersand/“and” only. No fuzzy match or suffix stripping was used.`,
    "",
    "A write was eligible only with one active RO197 NHS TRUST record, an exact normalized name, an exact town match, one HTTPS website listed in that ODS record, all three production fields blank, and no explicit non-write hold.",
    "",
    "## Counts",
    "",
    markdownTableRow(["Measure", "Count"]),
    markdownTableRow(["---", "---"]),
    markdownTableRow(["Candidate rows", candidates.length]),
    markdownTableRow(["Clean rows", counts.CLEAN ?? 0]),
    markdownTableRow(["Clean distinct employers", uniqueCleanNames.size]),
    markdownTableRow(["Held rows", counts.HELD ?? 0]),
    markdownTableRow(["Location conflicts", counts.CONFLICT ?? 0]),
    markdownTableRow(["No exact NHS Trust match", counts.NO_MATCH ?? 0]),
    markdownTableRow(["Planned write rows", plan.targets.reduce((total, target) => total + target.expectedRowCount, 0)]),
    markdownTableRow(["Planned write employers", plan.targets.length]),
    markdownTableRow(["Writer preflight status", preflightReceipt?.status ?? "Not run"]),
    markdownTableRow(["Writer preflight reason", preflightReceipt?.reason ?? ""]),
    markdownTableRow(["Production apply status", applyStatus]),
    markdownTableRow(["Last read-only production sponsor rows", readonlySnapshot?.rowCount ?? "Not recorded"]),
    markdownTableRow(["Last read-only blank websites", readonlySnapshot?.blankWebsiteRows ?? "Not recorded"]),
    markdownTableRow(["Last read-only blank website/ODS rows", readonlySnapshot?.blankAllThreeRows ?? "Not recorded"]),
    markdownTableRow(["Production sponsor rows before writer transaction", applyReceipt?.countsBefore?.rowCount ?? writerCountsNotRun]),
    markdownTableRow(["Production sponsor rows after writer transaction", applyReceipt?.countsAfter?.rowCount ?? writerCountsNotRun]),
    markdownTableRow(["Blank websites before writer transaction", applyReceipt?.countsBefore?.blankWebsiteRows ?? writerCountsNotRun]),
    markdownTableRow(["Blank websites after writer transaction", applyReceipt?.countsAfter?.blankWebsiteRows ?? writerCountsNotRun]),
    "",
    "## Ten clean-match examples",
    "",
    markdownTableRow(["Employer", "Website", "ODS code", "ODS record"]),
    markdownTableRow(["---", "---", "---", "---"]),
    ...examples.map((row) => markdownTableRow([
      row.organisation_name,
      row.website_after,
      row.ods_code_after,
      row.ods_record_url_after,
    ])),
    "",
    "## Named non-write examples",
    "",
    markdownTableRow(["Employer", "Result", "Reason"]),
    markdownTableRow(["---", "---", "---"]),
    ...reportRows
      .filter((row) =>
        /University College London Hospitals|Northumbria Healthcare|Kings College Hospital|Oxford University Hospitals|King's College Hospital Charity/i
          .test(String(row.organisation_name))
      )
      .map((row) => markdownTableRow([
        row.organisation_name,
        row.classification,
        `${row.reason}${row.related_ods_record_note ? ` ${row.related_ods_record_note}.` : ""}`,
      ])),
    "",
    "Oxford Health NHS Foundation Trust is a separate exact-name organisation; it is not Oxford University Hospitals NHS Trust.",
    "",
    "## Undo",
    "",
    "No production write occurred in this run. After a successful apply, the guarded writer will create `ods-stage2-before-image.json` in this directory before updating any rows. To undo a later successful apply, first run a read-only restore preflight:",
    "",
    "```sh",
    "pnpm --filter @workspace/api-server sponsor:stage1-ods-websites -- --restore-before-image-file=.agents/outputs/ods-stage2-2026-10-06/ods-stage2-before-image.json --preflight-only=true",
    "```",
    "",
    "If that preflight confirms every row still has the Stage 2 values, apply the restore with the fingerprint printed by that preflight:",
    "",
    "```sh",
    "pnpm --filter @workspace/api-server sponsor:stage1-ods-websites -- --restore-before-image-file=.agents/outputs/ods-stage2-2026-10-06/ods-stage2-before-image.json --apply=true --expected-db-fingerprint=<restore-preflight-fingerprint> --confirm-production-ods-restore=true",
    "```",
    "",
    "The restore is conditional and will refuse if target values or row counts changed. These commands require the production writer secret to be a valid PostgreSQL URL.",
    "",
    preflightReceipt?.status === "blocked_before_database_connection"
      ? `The production writer aborted before opening a database connection: ${preflightReceipt.reason} No production write or transaction before-image was created. The exact-match before-value snapshot is saved separately as production-exact-ods-writer-row-states.csv.`
      : "The accompanying workbook and CSV list every candidate row, including each held, conflict, and no-match reason. The before-image and guarded-writer receipt are separate files in this report directory.",
    "",
  ].join("\n");
  writeFileSync(resolve(OUTPUT_DIR, "ods-stage2-report.md"), markdown);

  const workbook = buildWorkbook(summaryRows, reportRows);
  XLSX.writeFile(workbook, resolve(OUTPUT_DIR, "ods-stage2-report.xlsx"));

  process.stdout.write(`${JSON.stringify({
    status: "report_generated",
    candidateRows: candidates.length,
    counts,
    uniqueCleanEmployers: uniqueCleanNames.size,
    plannedTargets: plan.targets.length,
    plannedWriteRows: plan.targets.reduce((total, target) => total + target.expectedRowCount, 0),
    workbook: ".agents/outputs/ods-stage2-2026-10-06/ods-stage2-report.xlsx",
    report: ".agents/outputs/ods-stage2-2026-10-06/ods-stage2-report.md",
    classificationCsv: ".agents/outputs/ods-stage2-2026-10-06/ods-stage2-classification.csv",
    applyPlan: ".agents/outputs/ods-stage2-2026-10-06/ods-stage2-apply-plan.json",
  }, null, 2)}\n`);
}

main();
