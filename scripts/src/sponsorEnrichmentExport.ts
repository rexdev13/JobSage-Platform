import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { parseCsv, parseCsvObjects, writeCsvFile } from "./sponsor-contact-discovery/csv";
import {
  createOfficialRecordMatcher,
  officialRecordsFromFile,
} from "./sponsor-contact-discovery/discovery";
import type { OfficialRecord, SponsorInput } from "./sponsor-contact-discovery/types";

export const REPORT_DIRECTORY = "../.local/reports/sponsor-enrichment";
export const FULL_EXPORT_LIMIT = 50_000;
export const DEFAULT_UNENRICHED_SAMPLE_SIZE = 5_000;

export const SPONSOR_EXPORT_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "normalized_organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "route",
  "sub_route",
  "rating",
  "existing_website",
  "existing_contact_email",
  "existing_contact_phone",
  "existing_careers_url",
  "existing_ats_provider",
  "existing_ats_board_id",
  "existing_ats_mapping_status",
  "existing_ats_mapping_evidence_url",
  "last_company_site_checked_at",
  "last_company_site_error",
] as const;

export const COMPANY_SITE_EXPORT_COLUMNS = [
  "organisation_name",
  "careers_url",
  "ats_provider",
  "ats_board_id",
  "ats_mapping_status",
  "ats_mapping_evidence_url",
  "probe_status",
  "last_outcome",
  "last_error",
  "last_attempted_at",
  "last_completed_at",
  "last_pages_fetched",
  "last_adverts_found",
  "last_rejected_count",
] as const;

export const VACANCY_SOURCE_EXPORT_COLUMNS = [
  "organisation_name",
  "source_type",
  "board_name",
  "url_host",
  "sample_detail_url",
  "sample_application_url",
  "vacancy_count",
  "latest_check_date",
  "latest_verification_status",
] as const;

export const IMPORT_TEMPLATE_COLUMNS = [
  "organisation_name",
  "sponsor_licence_id",
  "website_url",
  "website_confidence",
  "website_evidence_url",
  "careers_url",
  "careers_confidence",
  "careers_evidence_url",
  "ats_provider",
  "ats_board_id",
  "ats_mapping_status",
  "ats_mapping_evidence_url",
  "source",
  "notes",
] as const;

const COMPANY_SITE_FIELDS = [
  ["organisation_name", "text"],
  ["careers_url", "text"],
  ["ats_provider", "text"],
  ["ats_board_id", "text"],
  ["ats_mapping_status", "text"],
  ["ats_mapping_evidence_url", "text"],
  ["probe_status", "text"],
  ["last_outcome", "text"],
  ["last_error", "text"],
  ["last_attempted_at", "text"],
  ["last_completed_at", "text"],
  ["last_pages_fetched", "text"],
  ["last_adverts_found", "text"],
  ["last_rejected_count", "text"],
] as const;

const SECTOR_RULES = {
  "healthcare-social-care": /\b(health(?:care)?|medical|nhs|clinical|nurs(?:e|ing)|social care|care home|care provider)\b/i,
  education: /\b(school|academy|college|university|education|educational|trust)\b/i,
  technology: /\b(technology|tech|software|information technology|computer|digital|telecom|cyber|data services)\b/i,
  engineering: /\b(engineer(?:ing)?|aerospace|manufactur(?:e|ing)|construction|mechanical|electrical)\b/i,
  finance: /\b(finance|financial|bank|banking|insurance|account(?:ing|ancy)|investment|payments)\b/i,
} as const;

type SponsorRecord = Record<string, unknown> & {
  sponsor_licence_id: number | string;
  organisation_name: string;
};

type VacancyRow = {
  organisation_name: string;
  source_type: string | null;
  board_name: string | null;
  url: string | null;
  application_url: string | null;
  check_date: string | Date | null;
  last_verified_at: string | Date | null;
  liveness: string | null;
  row_id: number | string | null;
};

type Snapshot = {
  sponsors: SponsorRecord[];
  companySites: Array<Record<string, unknown>>;
  vacancies: VacancyRow[];
  columns: Map<string, Set<string>>;
  unavailableFields: string[];
};

type SponsorSelection = {
  selected: SponsorRecord[];
  fullExport: boolean;
  totalRows: number;
  enrichedRows: number;
  sampledRows: number;
  sectorTotals: Record<string, number>;
  sectorSelected: Record<string, number>;
};

export type VacancySourceExportRow = {
  organisation_name: string;
  source_type: string;
  board_name: string;
  url_host: string;
  sample_detail_url: string;
  sample_application_url: string;
  vacancy_count: number;
  latest_check_date: string;
  latest_verification_status: string;
};

export type SourceCoverage = {
  source: string;
  sourceFile: string;
  sourceSnapshotDate: string;
  sourceVersionEvidence: string;
  sourceRecordCount: number;
  sourceRecordsWithWebsite: number;
  sourceRecordsWithEmail: number;
  sourceRecordMatches: number;
  sponsorRowsMatched: number;
  matchedRowsWithWebsite: number;
  matchedRowsWithEmail: number;
  potentialWebsiteAdds: number;
  potentialEmailAdds: number;
  confirmedPersistedEnrichments: number;
  samples: Array<{
    sponsorLicenceId: string;
    sponsorName: string;
    matchedSourceName: string;
    matchMethod: string;
    confidence: string;
    sourceEvidenceUrl: string;
    websiteAvailable: boolean;
    emailAvailable: boolean;
  }>;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function rowText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function normalizeOrganisationName(value: string): string {
  return value.normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sponsorSectors(record: SponsorRecord): string[] {
  const text = `${rowText(record, "industry")} ${record.organisation_name}`;
  return Object.entries(SECTOR_RULES)
    .filter(([, rule]) => rule.test(text))
    .map(([sector]) => sector);
}

function hasExistingWebsiteCareersOrAts(record: SponsorRecord): boolean {
  return Boolean(
    rowText(record, "website") ||
    rowText(record, "careers_url") ||
    rowText(record, "ats_provider") ||
    rowText(record, "ats_board_id") ||
    rowText(record, "ats_mapping_status") ||
    rowText(record, "ats_mapping_evidence_url"),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function selectSponsorRows(
  sponsors: SponsorRecord[],
  fullExportLimit = FULL_EXPORT_LIMIT,
  sampleSize = DEFAULT_UNENRICHED_SAMPLE_SIZE,
): SponsorSelection {
  const sectorTotals: Record<string, number> = Object.fromEntries(
    Object.keys(SECTOR_RULES).map((sector) => [sector, 0]),
  );
  const sectorSelected: Record<string, number> = Object.fromEntries(
    Object.keys(SECTOR_RULES).map((sector) => [sector, 0]),
  );
  for (const sponsor of sponsors) {
    for (const sector of sponsorSectors(sponsor)) sectorTotals[sector] = (sectorTotals[sector] ?? 0) + 1;
  }

  const enrichedRows = sponsors.filter(hasExistingWebsiteCareersOrAts).length;
  if (sponsors.length <= fullExportLimit) {
    for (const sponsor of sponsors) {
      for (const sector of sponsorSectors(sponsor)) sectorSelected[sector] = (sectorSelected[sector] ?? 0) + 1;
    }
    return {
      selected: [...sponsors],
      fullExport: true,
      totalRows: sponsors.length,
      enrichedRows,
      sampledRows: 0,
      sectorTotals,
      sectorSelected,
    };
  }

  const allSectorRows = sponsors.filter((sponsor) => sponsorSectors(sponsor).length > 0);
  const sampleCandidates = sponsors.filter((sponsor) => !hasExistingWebsiteCareersOrAts(sponsor));
  const sampled = [...sampleCandidates]
    .sort((left, right) => sha256(String(left.sponsor_licence_id)).localeCompare(sha256(String(right.sponsor_licence_id))))
    .slice(0, sampleSize);
  const selectedById = new Map<string, SponsorRecord>();
  for (const sponsor of sponsors) {
    if (hasExistingWebsiteCareersOrAts(sponsor)) selectedById.set(String(sponsor.sponsor_licence_id), sponsor);
  }
  for (const sponsor of allSectorRows) selectedById.set(String(sponsor.sponsor_licence_id), sponsor);
  for (const sponsor of sampled) selectedById.set(String(sponsor.sponsor_licence_id), sponsor);

  const selected = [...selectedById.values()].sort((left, right) =>
    Number(left.sponsor_licence_id) - Number(right.sponsor_licence_id),
  );
  for (const sponsor of selected) {
    for (const sector of sponsorSectors(sponsor)) sectorSelected[sector] = (sectorSelected[sector] ?? 0) + 1;
  }
  return {
    selected,
    fullExport: false,
    totalRows: sponsors.length,
    enrichedRows,
    sampledRows: sampled.length,
    sectorTotals,
    sectorSelected,
  };
}

export function vacancyUrlHost(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function aggregateVacancySources(rows: VacancyRow[]): VacancySourceExportRow[] {
  const groups = new Map<string, {
    organisation_name: string;
    source_type: string;
    board_name: string;
    url_host: string;
    sample_detail_url: string;
    sample_application_url: string;
    vacancy_count: number;
    latest_check_date: string;
    verificationAt: number;
    fallbackCheckAt: number;
    latest_verification_status: string;
  }>();

  for (const row of rows) {
    const sourceType = row.source_type ?? "";
    const boardName = row.board_name ?? "";
    const host = vacancyUrlHost(row.url) || vacancyUrlHost(row.application_url);
    const key = JSON.stringify([row.organisation_name, sourceType, boardName, host]);
    const current = groups.get(key);
    const checkDate = row.check_date == null ? "" : rowText({ value: row.check_date }, "value");
    const verifyMs = row.last_verified_at == null ? -1 : Date.parse(rowText({ value: row.last_verified_at }, "value"));
    const checkMs = checkDate ? Date.parse(checkDate) : -1;
    if (!current) {
      groups.set(key, {
        organisation_name: row.organisation_name,
        source_type: sourceType,
        board_name: boardName,
        url_host: host,
        sample_detail_url: row.url ?? "",
        sample_application_url: row.application_url ?? "",
        vacancy_count: 1,
        latest_check_date: checkDate,
        verificationAt: verifyMs,
        fallbackCheckAt: checkMs,
        latest_verification_status: row.liveness ?? "unverified",
      });
      continue;
    }
    current.vacancy_count += 1;
    const newerCheck = checkMs > current.fallbackCheckAt;
    if (newerCheck) {
      current.fallbackCheckAt = checkMs;
      current.latest_check_date = checkDate;
    }
    if (verifyMs > current.verificationAt) {
      current.verificationAt = verifyMs;
      current.latest_verification_status = row.liveness ?? "unverified";
    } else if (current.verificationAt < 0 && newerCheck) {
      current.latest_verification_status = row.liveness ?? "unverified";
    }
    if (row.url && (!current.sample_detail_url || row.url.localeCompare(current.sample_detail_url) < 0)) {
      current.sample_detail_url = row.url;
    }
    if (row.application_url &&
      (!current.sample_application_url || row.application_url.localeCompare(current.sample_application_url) < 0)) {
      current.sample_application_url = row.application_url;
    }
  }

  return [...groups.values()]
    .map(({ verificationAt: _verificationAt, fallbackCheckAt: _fallbackCheckAt, ...row }) => row)
    .sort((left, right) =>
      left.organisation_name.localeCompare(right.organisation_name) ||
      left.source_type.localeCompare(right.source_type) ||
      left.board_name.localeCompare(right.board_name) ||
      left.url_host.localeCompare(right.url_host),
    );
}

export function assertDevelopmentTarget(args: string[]): void {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Sponsor enrichment export is development-only; set NODE_ENV=development.");
  }
  if (!args.includes("--confirm-development-db")) {
    throw new Error("Refusing database access without --confirm-development-db.");
  }
  if (process.env.REPLIT_DEPLOYMENT || process.env.REPLIT_DEPLOYMENT_ID) {
    throw new Error("Refusing to run inside a Replit deployment.");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
  let target: string;
  try {
    const parsed = new URL(databaseUrl);
    target = `${parsed.hostname} ${parsed.pathname}`.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (/(^|[._/-])(prod|production)([._/-]|$)/i.test(target)) {
    throw new Error("Refusing a database target marked as production.");
  }
}

async function loadSnapshot(): Promise<Snapshot> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const metadata = await tx.execute<{
      table_name: string;
      column_name: string;
    }>(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN (
          'sponsor_licences',
          'sponsor_licence_company_site_checks',
          'sponsor_licence_vacancies'
        )
    `);
    const columns = new Map<string, Set<string>>();
    for (const row of metadata.rows) {
      const names = columns.get(row.table_name) ?? new Set<string>();
      names.add(row.column_name);
      columns.set(row.table_name, names);
    }

    const unavailableFields: string[] = [];
    const available = (table: string, column: string): boolean =>
      Boolean(columns.get(table)?.has(column));
    const columnExpr = (
      table: string,
      alias: string,
      column: string,
      output: string,
      cast = "text",
    ): string => {
      if (available(table, column)) return `${alias}.${quoteIdentifier(column)} AS ${quoteIdentifier(output)}`;
      unavailableFields.push(`${table}.${column}`);
      return `NULL::${cast} AS ${quoteIdentifier(output)}`;
    };

    const sponsorTable = "sponsor_licences";
    if (!available(sponsorTable, "id") || !available(sponsorTable, "organisation_name")) {
      throw new Error("The development schema is missing sponsor_licences.id or organisation_name.");
    }
    const siteTable = "sponsor_licence_company_site_checks";
    const canJoinSites = available(siteTable, "organisation_name");
    if (columns.has(siteTable) && !canJoinSites) unavailableFields.push(`${siteTable}.organisation_name`);

    const sponsorFields: Array<[string, string, string]> = [
      ["id", "sponsor_licence_id", "integer"],
      ["organisation_name", "organisation_name", "text"],
      ["town_city", "town_city", "text"],
      ["county", "county", "text"],
      ["region", "region", "text"],
      ["industry", "industry", "text"],
      ["route", "route", "text"],
      ["sub_route", "sub_route", "text"],
      ["rating", "rating", "text"],
      ["website", "website", "text"],
      ["contact_email", "contact_email", "text"],
      ["contact_phone", "contact_phone", "text"],
    ];
    const sponsorSelect = sponsorFields
      .map(([column, output, cast]) => columnExpr(sponsorTable, "sl", column, output, cast));
    const siteFields: Array<[string, string]> = [
      ["careers_url", "careers_url"],
      ["ats_provider", "ats_provider"],
      ["ats_board_id", "ats_board_id"],
      ["ats_mapping_status", "ats_mapping_status"],
      ["ats_mapping_evidence_url", "ats_mapping_evidence_url"],
      ["last_error", "last_error"],
    ];
    for (const [column, output] of siteFields) {
      sponsorSelect.push(canJoinSites
        ? columnExpr(siteTable, "cs", column, output)
        : `NULL::text AS ${quoteIdentifier(output)}`);
      if (!canJoinSites && columns.has(siteTable)) unavailableFields.push(`${siteTable}.${column}`);
    }
    const checkedAtColumns = [
      "generic_checked_at",
      "ats_checked_at",
      "last_probed_at",
      "last_attempted_at",
      "last_completed_at",
    ]
      .filter((column) => available(siteTable, column));
    const checkedAtExpr = canJoinSites && checkedAtColumns.length > 0
      ? `GREATEST(${checkedAtColumns.map((column) => `cs.${quoteIdentifier(column)}`).join(", ")}) AS "last_company_site_checked_at"`
      : `NULL::timestamptz AS "last_company_site_checked_at"`;
    if (canJoinSites) {
      for (const column of [
        "generic_checked_at",
        "ats_checked_at",
        "last_probed_at",
        "last_attempted_at",
        "last_completed_at",
      ]) {
        if (!available(siteTable, column)) unavailableFields.push(`${siteTable}.${column}`);
      }
    } else {
      unavailableFields.push(
        `${siteTable}.generic_checked_at`,
        `${siteTable}.ats_checked_at`,
        `${siteTable}.last_probed_at`,
        `${siteTable}.last_attempted_at`,
        `${siteTable}.last_completed_at`,
      );
    }
    sponsorSelect.push(checkedAtExpr);

    const sponsorsResult = await tx.execute<SponsorRecord>(sql.raw(`
      SELECT ${sponsorSelect.join(",\n             ")}
      FROM sponsor_licences sl
      ${canJoinSites ? 'LEFT JOIN sponsor_licence_company_site_checks cs ON cs.organisation_name = sl.organisation_name' : ""}
      ORDER BY sl.id
    `));

    let companySites: Array<Record<string, unknown>> = [];
    if (columns.has(siteTable)) {
      const select = COMPANY_SITE_FIELDS.map(([column, cast]) =>
        columnExpr(siteTable, "cs", column, column, cast),
      );
      companySites = (await tx.execute<Record<string, unknown>>(sql.raw(`
        SELECT ${select.join(",\n               ")}
        FROM sponsor_licence_company_site_checks cs
        ${available(siteTable, "organisation_name") ? "ORDER BY cs.organisation_name" : ""}
      `))).rows;
    } else {
      unavailableFields.push(...COMPANY_SITE_FIELDS.map(([column]) => `${siteTable}.${column}`));
    }

    const vacancyTable = "sponsor_licence_vacancies";
    let vacancies: VacancyRow[] = [];
    if (columns.has(vacancyTable) && available(vacancyTable, "organisation_name")) {
      const vacancyFields: Array<[string, string, string]> = [
        ["organisation_name", "organisation_name", "text"],
        ["source_type", "source_type", "text"],
        ["board_name", "board_name", "text"],
        ["url", "url", "text"],
        ["application_url", "application_url", "text"],
        ["check_date", "check_date", "date"],
        ["last_verified_at", "last_verified_at", "timestamptz"],
        ["liveness", "liveness", "text"],
        ["id", "row_id", "integer"],
      ];
      const select = vacancyFields.map(([column, output, cast]) =>
        columnExpr(vacancyTable, "v", column, output, cast),
      );
      const ordering = [
        available(vacancyTable, "organisation_name") ? "v.organisation_name" : undefined,
        available(vacancyTable, "check_date") ? "v.check_date DESC NULLS LAST" : undefined,
        available(vacancyTable, "id") ? "v.id DESC" : undefined,
      ].filter(Boolean).join(", ");
      vacancies = (await tx.execute<VacancyRow>(sql.raw(`
        SELECT ${select.join(",\n               ")}
        FROM sponsor_licence_vacancies v
        ORDER BY ${ordering}
      `))).rows;
    } else {
      unavailableFields.push(...[
        "organisation_name", "source_type", "board_name", "url", "application_url",
        "check_date", "last_verified_at", "liveness", "id",
      ].map((column) => `${vacancyTable}.${column}`));
    }
    return {
      sponsors: sponsorsResult.rows,
      companySites,
      vacancies,
      columns,
      unavailableFields: [...new Set(unavailableFields)].sort(),
    };
  });
}

export function toSponsorExportRow(record: SponsorRecord): Record<string, unknown> {
  return {
    sponsor_licence_id: record.sponsor_licence_id,
    organisation_name: record.organisation_name,
    normalized_organisation_name: normalizeOrganisationName(record.organisation_name),
    town_city: record.town_city,
    county: record.county,
    region: record.region,
    industry: record.industry,
    route: record.route,
    sub_route: record.sub_route,
    rating: record.rating,
    existing_website: record.website,
    existing_contact_email: record.contact_email,
    existing_contact_phone: record.contact_phone,
    existing_careers_url: record.careers_url,
    existing_ats_provider: record.ats_provider,
    existing_ats_board_id: record.ats_board_id,
    existing_ats_mapping_status: record.ats_mapping_status,
    existing_ats_mapping_evidence_url: record.ats_mapping_evidence_url,
    last_company_site_checked_at: rowText(record, "last_company_site_checked_at"),
    last_company_site_error: record.last_error,
  };
}

function sponsorInput(record: SponsorRecord): SponsorInput {
  return {
    organisationName: record.organisation_name,
    townCity: rowText(record, "town_city"),
    county: rowText(record, "county"),
    industry: rowText(record, "industry"),
    website: rowText(record, "website"),
    contactEmail: rowText(record, "contact_email"),
    postcode: "",
  };
}

async function optionalFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function findCacheFile(cacheDir: string, pattern: RegExp): Promise<string | undefined> {
  try {
    const names = (await readdir(cacheDir)).filter((name) => pattern.test(name)).sort().reverse();
    for (const name of names) {
      const path = join(cacheDir, name);
      if (await optionalFile(path)) return path;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function cacheDate(path: string): Promise<string> {
  const dated = basename(path).match(/(\d{4}-\d{2}-\d{2})/);
  if (dated) return dated[1]!;
  return (await stat(path)).mtime.toISOString();
}

async function assessSource(
  source: string,
  path: string | undefined,
  sponsors: SponsorRecord[],
): Promise<SourceCoverage> {
  if (!path) {
    return {
      source,
      sourceFile: "not available in local cache; no network fetch attempted",
      sourceSnapshotDate: "unknown",
      sourceVersionEvidence: "no cached source file available",
      sourceRecordCount: 0,
      sourceRecordsWithWebsite: 0,
      sourceRecordsWithEmail: 0,
      sourceRecordMatches: 0,
      sponsorRowsMatched: 0,
      matchedRowsWithWebsite: 0,
      matchedRowsWithEmail: 0,
      potentialWebsiteAdds: 0,
      potentialEmailAdds: 0,
      confirmedPersistedEnrichments: 0,
      samples: [],
    };
  }

  const records = await officialRecordsFromFile(
    path,
    source === "Charity Commission" ? "charity_commission" : source.toLowerCase().replaceAll(" ", ""),
    source === "CQC"
      ? "https://www.cqc.org.uk/about-us/transparency/using-cqc-data"
      : source === "GIAS"
        ? "https://get-information-schools.service.gov.uk/Downloads"
        : "https://register-of-charities.charitycommission.gov.uk/",
  );
  const match = createOfficialRecordMatcher(records);
  const matchedRows = new Map<string, { sponsor: SponsorRecord; record: OfficialRecord; method: string; confidence: string }>();
  const matchedRecordKeys = new Set<string>();
  for (const sponsor of sponsors) {
    const result = match(sponsorInput(sponsor));
    if (!result) continue;
    const id = String(sponsor.sponsor_licence_id);
    matchedRows.set(id, {
      sponsor,
      record: result.record,
      method: result.method,
      confidence: result.confidence,
    });
    matchedRecordKeys.add(JSON.stringify([
      normalizeOrganisationName(result.record.organisationName),
      result.record.website,
      result.record.email,
      result.record.evidenceUrl,
    ]));
  }
  const rows = [...matchedRows.values()];
  const samples = rows.slice(0, 5).map(({ sponsor, record, method, confidence }) => ({
    sponsorLicenceId: String(sponsor.sponsor_licence_id),
    sponsorName: sponsor.organisation_name,
    matchedSourceName: record.organisationName,
    matchMethod: method,
    confidence,
    sourceEvidenceUrl: record.evidenceUrl,
    websiteAvailable: Boolean(record.website),
    emailAvailable: Boolean(record.email),
  }));
  return {
    source,
    sourceFile: relative(resolve(".."), path),
    sourceSnapshotDate: await cacheDate(path),
    sourceVersionEvidence: await sourceVersionEvidence(source, path),
    sourceRecordCount: records.length,
    sourceRecordsWithWebsite: records.filter((record) => Boolean(record.website)).length,
    sourceRecordsWithEmail: records.filter((record) => Boolean(record.email)).length,
    sourceRecordMatches: matchedRecordKeys.size,
    sponsorRowsMatched: rows.length,
    matchedRowsWithWebsite: rows.filter(({ record }) => Boolean(record.website)).length,
    matchedRowsWithEmail: rows.filter(({ record }) => Boolean(record.email)).length,
    potentialWebsiteAdds: rows.filter(({ record, sponsor }) => Boolean(record.website) && !rowText(sponsor, "website")).length,
    potentialEmailAdds: rows.filter(({ record, sponsor }) => Boolean(record.email) && !rowText(sponsor, "contact_email")).length,
    // No current JOBSAGE provenance column attributes persisted values to these public registers.
    confirmedPersistedEnrichments: 0,
    samples,
  };
}

async function sourceVersionEvidence(source: string, path: string): Promise<string> {
  if (source === "CQC") {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(16_384);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const metadata = buffer.subarray(0, bytesRead).toString("utf8");
      const produced = metadata.match(/produced on\s+([^,\r\n]+)/i)?.[1]?.trim();
      return produced
        ? `source CSV metadata says “produced on ${produced}”; cache filename date ${await cacheDate(path)}`
        : `no source-version date parsed; local cache date ${await cacheDate(path)}`;
    } finally {
      await file.close();
    }
  }
  if (source === "GIAS") {
    return `local cache dated ${await cacheDate(path)}; no single dataset version date is present in the CSV header`;
  }
  return `normalized local cache modified ${await cacheDate(path)}; no source-version column is present`;
}

async function assessPublicSources(cacheDir: string, sponsors: SponsorRecord[]): Promise<SourceCoverage[]> {
  const cqc = await findCacheFile(cacheDir, /^cqc-directory-\d{4}-\d{2}-\d{2}\.csv$/);
  const gias = await findCacheFile(cacheDir, /^gias-establishments-\d{4}-\d{2}-\d{2}\.csv$/);
  const charity = await findCacheFile(cacheDir, /^charity\.csv$/);
  const results: SourceCoverage[] = [];
  for (const [name, path] of [
    ["CQC", cqc],
    ["GIAS", gias],
    ["Charity Commission", charity],
  ] as const) {
    console.log(`[sponsor-enrichment-export] Assessing ${name} local cache${path ? `: ${path}` : ": unavailable"}`);
    const result = await assessSource(name, path, sponsors);
    results.push(result);
    console.log(`[sponsor-enrichment-export] ${name}: ${result.sourceRecordCount} records; ${result.sponsorRowsMatched} potential sponsor matches`);
  }
  return results;
}

function sourceReadinessReport(coverage: SourceCoverage[], generatedAt: string): string {
  const descriptions: Record<string, string[]> = {
    CQC: [
      "Yes. The sponsor-contact discovery adapter downloads/caches the CQC directory; the normalizer reads provider and location names, town/county/postcode when present, website, email, and evidence URL.",
      "Website: Yes, when populated in the CQC source. Email: the parser accepts an email field if present; availability is dataset-dependent.",
      "Yes. Existing matching uses normalized exact organization names (including provider/location roles), or strict fuzzy names with location agreement. Exact matches are high-confidence candidates; fuzzy matches are medium-confidence candidates. These remain potential matches, not verified enrichment.",
    ],
    GIAS: [
      "Yes. The adapter supports the GIAS downloads flow, including its generated/extract download process, resumable state, and local cache.",
      "The normalizer can extract establishment name, town/local authority, school website, main email, and an evidence URL. Website: Yes, when present. Email: Yes, when present.",
      "Yes. It uses the same normalized exact-name and strict location-assisted fuzzy matching. A school/establishment match is not proof that the sponsor legal entity is the same organization.",
    ],
    "Charity Commission": [
      "Yes. The adapter can query the Charity Commission API when configured; local normalized CSV files are also supported. This report only inspects the existing local cache.",
      "Extracts charity name, website, public email, and register evidence URL. Website: Yes, when returned. Email: Yes, when returned.",
      "Yes. Existing normalized name and location-assisted matching applies. Charity-to-sponsor identity can be ambiguous, so all matches remain potential pending review.",
    ],
    "Companies House": [
      "No Companies House bulk/API adapter or local Companies House cache was found in the current scripts package.",
      "There are no Companies House fields currently extracted by this code. Under a future company-identity lookup, company number, legal name, status, and registered office/address could support identity resolution; the current code has no website, careers URL, or public email retrieval.",
      "No current matching path or measured coverage exists. A future company-number mapping would need explicit source evidence and must not be inferred from name alone.",
    ],
  };

  const sourceBlocks = coverage.map((item) => {
    const [support, fields, matching] = descriptions[item.source]!;
    const samples = item.samples.length
      ? item.samples.map((sample) =>
        `- JOBSAGE ID ${sample.sponsorLicenceId}, “${sample.sponsorName}” ↔ “${sample.matchedSourceName}”; ${sample.matchMethod}/${sample.confidence}; website=${sample.websiteAvailable ? "available" : "no"}, email=${sample.emailAvailable ? "available" : "no"}; evidence: ${sample.sourceEvidenceUrl || "not supplied in file"}. Potential match only.`,
      ).join("\n")
      : "- No sample match available in the local source data.";
    return `## ${item.source}

- Already implemented: ${support}
- Extractable fields / web and email: ${fields}
- Can match to sponsor_licences: ${matching}
- Local source file: ${item.sourceFile}
- Snapshot/cache date: ${item.sourceSnapshotDate}; source/version evidence: ${item.sourceVersionEvidence}. No live fetch was performed for this report.
- Last adapter run: not recorded persistently by the current code; the local cache file date is the latest available run evidence.
- Source records parsed: ${item.sourceRecordCount}; records with website: ${item.sourceRecordsWithWebsite}; records with email: ${item.sourceRecordsWithEmail}.
- Distinct source-record matches: ${item.sourceRecordMatches}; JOBSAGE sponsor rows with a potential match: ${item.sponsorRowsMatched}.
- Matched sponsor rows where the source provides a website/email: ${item.matchedRowsWithWebsite}/${item.matchedRowsWithEmail}; potential missing website/email values: ${item.potentialWebsiteAdds}/${item.potentialEmailAdds}.
- Confirmed source-attributed enrichments already persisted in JOBSAGE: ${item.confirmedPersistedEnrichments}. The current persisted provenance fields do not identify these public sources, so source matches are not counted as confirmed JOBSAGE enrichment.

Sample evidence:
${samples}`;
  });
  return `# Public-source enrichment readiness

Generated: ${generatedAt}

This is a local-cache assessment only. It does not download datasets, crawl employer websites, create import candidates, or modify JOBSAGE data. A “potential match” is a name/location match under the existing discovery rules, not a verified organization identity. Source-record matches, candidate website/email availability, and persisted source-attributed enrichments are reported separately.

Matching method in the existing adapter: normalized exact organization name (including CQC provider/location role handling), exact name with location context, then strict fuzzy token similarity (minimum 0.88) with location agreement; ambiguous fuzzy matches are rejected. This sponsor table has town/county but no postcode column, so this assessment cannot use postcode. Exact matches are high-confidence candidates; fuzzy matches are medium-confidence candidates. Confidence is a review aid, not verification.

${sourceBlocks.join("\n\n")}

## Companies House

- Already implemented: ${descriptions["Companies House"]![0]}
- Extractable fields / website and email: ${descriptions["Companies House"]![1]}
- Can match to sponsor_licences: ${descriptions["Companies House"]![2]}
- Local dataset/cache and last-run evidence: none found in this codebase; no network lookup was attempted.
`;
}

function renderSelectionSummary(selection: SponsorSelection): string {
  const sectorLines = Object.entries(selection.sectorTotals)
    .map(([sector, count]) => `| ${sector} | ${count} | ${selection.sectorSelected[sector] ?? 0} |`)
    .join("\n");
  return `- Total sponsor licence rows in development database: **${selection.totalRows}**
- Sponsor rows with existing website/careers/ATS data: **${selection.enrichedRows}**
- Selection: ${selection.fullExport
    ? `all rows exported (below the ${FULL_EXPORT_LIMIT.toLocaleString()}-row full-export threshold).`
    : `all existing website/careers/ATS rows, all sector-coverage rows, plus ${selection.sampledRows.toLocaleString()} deterministic rows without website/careers/ATS data.`}
- Rows written: **${selection.selected.length}**

| Sector classifier (overlapping categories) | Database rows | Export rows |
| --- | ---: | ---: |
${sectorLines}

The fallback sample is stable across runs: IDs are ordered by SHA-256 of the internal sponsor row ID, then the first 5,000 eligible rows are selected. Sector categories are rule-based coverage labels, not authoritative industry classifications.`;
}

function countsForReport(
  sponsors: SponsorRecord[],
  companySites: Array<Record<string, unknown>>,
  vacancySources: VacancySourceExportRow[],
): {
  recordsWithWebsite: number;
  recordsWithEmail: number;
  recordsWithPhone: number;
  siteRowsWithCareers: number;
  siteRowsWithAts: number;
  employersWithAnySignal: number;
  vacancySourceEmployers: number;
} {
  const careersNames = new Set(companySites.filter((row) => rowText(row, "careers_url")).map((row) =>
    normalizeOrganisationName(rowText(row, "organisation_name")),
  ));
  const atsNames = new Set(companySites.filter((row) =>
    rowText(row, "ats_provider") || rowText(row, "ats_board_id") || rowText(row, "ats_mapping_evidence_url"),
  ).map((row) => normalizeOrganisationName(rowText(row, "organisation_name"))));
  const vacancyNames = new Set(vacancySources.map((row) => normalizeOrganisationName(row.organisation_name)));
  const employersWithSignal = new Set<string>();
  for (const sponsor of sponsors) {
    const name = normalizeOrganisationName(sponsor.organisation_name);
    if (
      rowText(sponsor, "website") ||
      rowText(sponsor, "contact_email") ||
      rowText(sponsor, "contact_phone") ||
      careersNames.has(name) ||
      atsNames.has(name) ||
      vacancyNames.has(name)
    ) employersWithSignal.add(String(sponsor.sponsor_licence_id));
  }
  return {
    recordsWithWebsite: sponsors.filter((row) => rowText(row, "website")).length,
    recordsWithEmail: sponsors.filter((row) => rowText(row, "contact_email")).length,
    recordsWithPhone: sponsors.filter((row) => rowText(row, "contact_phone")).length,
    siteRowsWithCareers: companySites.filter((row) => rowText(row, "careers_url")).length,
    siteRowsWithAts: companySites.filter((row) =>
      rowText(row, "ats_provider") || rowText(row, "ats_board_id") || rowText(row, "ats_mapping_evidence_url"),
    ).length,
    employersWithAnySignal: employersWithSignal.size,
    vacancySourceEmployers: vacancyNames.size,
  };
}

function finalReport(
  generatedAt: string,
  selection: SponsorSelection,
  counts: ReturnType<typeof countsForReport>,
  coverage: SourceCoverage[],
  companySiteCount: number,
  vacancySourceCount: number,
  unavailableFields: string[],
): string {
  const coverageBySource = new Map(coverage.map((item) => [item.source, item]));
  const cqc = coverageBySource.get("CQC")!;
  const gias = coverageBySource.get("GIAS")!;
  const charity = coverageBySource.get("Charity Commission")!;
  const unavailable = unavailableFields.length
    ? unavailableFields.map((field) => `- \`${field}\``).join("\n")
    : "- None of the requested database fields were unavailable.";

  return `# Sponsor enrichment export report

Generated: ${generatedAt}

All database reads were performed inside a development-only, read-only transaction. The export does not write database data, fetch public sources, crawl employer sites, import enrichment, or deploy.

## Seven requested questions

### 1. How many sponsor employers can already be enriched from existing JOBSAGE data?

**${counts.employersWithAnySignal} sponsor licence rows** have at least one existing useful signal among website, contact email/phone, careers/ATS mapping, or vacancy-source evidence. These are sponsor rows (internal IDs), not deduplicated legal entities.

- Sponsor rows with a saved website: ${counts.recordsWithWebsite}
- Sponsor rows with a saved contact email: ${counts.recordsWithEmail}
- Sponsor rows with a saved contact phone: ${counts.recordsWithPhone}
- Company-site/check rows with careers URL: ${counts.siteRowsWithCareers}
- Company-site/check rows with ATS provider, board ID, or evidence URL: ${counts.siteRowsWithAts}
- Distinct employer/source groups from existing vacancies: ${vacancySourceCount}; employers represented: ${counts.vacancySourceEmployers}
- Company-site/check rows exported: ${companySiteCount}

These counts describe stored JOBSAGE evidence; they do not imply that every URL or mapping is currently live or verified. The company-site export includes mapping status and evidence.

### 2. How many can likely be enriched from CQC?

**${cqc.sponsorRowsMatched} sponsor rows have a potential CQC source-record match**, representing ${cqc.sourceRecordMatches} distinct matched CQC source records. Among the matched sponsor rows, ${cqc.matchedRowsWithWebsite} have a source website and ${cqc.matchedRowsWithEmail} have a source email; ${cqc.potentialWebsiteAdds} / ${cqc.potentialEmailAdds} have those values missing in JOBSAGE. Confirmed CQC-attributed enrichments recorded in JOBSAGE: ${cqc.confirmedPersistedEnrichments}. These are name/location candidates, not confirmed identity matches.

### 3. How many can likely be enriched from GIAS?

**${gias.sponsorRowsMatched} sponsor rows have a potential GIAS source-record match**, representing ${gias.sourceRecordMatches} distinct matched GIAS source records. Among the matched sponsor rows, ${gias.matchedRowsWithWebsite} have a source website and ${gias.matchedRowsWithEmail} have a source email; ${gias.potentialWebsiteAdds} / ${gias.potentialEmailAdds} have those values missing in JOBSAGE. Confirmed GIAS-attributed enrichments recorded in JOBSAGE: ${gias.confirmedPersistedEnrichments}. An establishment can differ from the sponsor's legal entity, so review before using.

### 4. How many can likely be enriched from Charity Commission?

**${charity.sponsorRowsMatched} sponsor rows have a potential Charity Commission source-record match**, representing ${charity.sourceRecordMatches} distinct matched charity records. Among the matched sponsor rows, ${charity.matchedRowsWithWebsite} have a source website and ${charity.matchedRowsWithEmail} have a source email; ${charity.potentialWebsiteAdds} / ${charity.potentialEmailAdds} have those values missing in JOBSAGE. Confirmed Charity Commission-attributed enrichments recorded in JOBSAGE: ${charity.confirmedPersistedEnrichments}. These are name-based candidates and are not confirmed identity matches.

### 5. Does Companies House help with websites or only identity/address?

There is no Companies House bulk/API adapter or cached Companies House dataset in the current scripts package, so no coverage count is available. There is no current website, careers URL, or email extraction. A future identity lookup could use company number, legal name, company status, and registered office/address; those fields may help disambiguate sponsor identities but are not website enrichment.

### 6. What export should Codex use to generate a website/careers enrichment CSV?

Use \`jobsage-sponsor-base-export.csv\` as the sponsor identity and existing-state input; join by \`sponsor_licence_id\`, which is JOBSAGE's internal \`sponsor_licences.id\`. It is not an official Home Office licence identifier. Use \`jobsage-company-site-existing.csv\` for current careers/ATS states and evidence, and \`jobsage-existing-vacancy-sources.csv\` for existing employer/source URLs and provider hints. Use \`public-source-enrichment-readiness.md\` only to understand possible public-source matches and their uncertainty. The blank \`jobsage-website-enrichment-import-template.csv\` is the target shape; it contains headers only and no candidate data.

The live development schema exposes only the internal sponsor row ID; no separate official licence ID is exported or fabricated.
The helper \`normalized_organisation_name\` applies Unicode NFKC, lowercases, expands \`&\` to \`and\`, and collapses punctuation/spacing; it preserves legal suffixes and is not a write-time identity key.

${renderSelectionSummary(selection)}

### 7. What is the safest import path back into JOBSAGE?

Do not use the existing sponsor-contact email importer for this website/careers/ATS workflow. Build a dedicated development-first importer with a dry-run mode and a reviewable diff:

1. Validate required columns and URLs; match only by stable JOBSAGE \`sponsor_licence_id\`, never by fuzzy organization name during writes.
2. Show before counts and proposed changes, including website, careers URL, ATS provider/board/status, and evidence URL.
3. By default, fill only missing website/careers fields. Never downgrade a verified ATS mapping. Replace any existing verified ATS mapping only when the new mapping has stronger evidence/confidence and is explicitly approved.
4. Require review for medium/low confidence rows. Preserve each source/evidence URL and source/date metadata; reject unsupported ATS values rather than guessing.
5. Dry-run against development first, then apply only explicitly reviewed rows in development. Report inserted/updated/skipped/rejected counts and before/after counts.
6. Validate the development result and obtain approval before any separately authorized production change. No production read/write or deploy is part of this task.

## Files produced

- \`jobsage-sponsor-base-export.csv\`: ${selection.selected.length} rows
- \`jobsage-company-site-existing.csv\`: ${companySiteCount} rows
- \`jobsage-existing-vacancy-sources.csv\`: ${vacancySourceCount} rows
- \`jobsage-website-enrichment-import-template.csv\`: header only
- \`public-source-enrichment-readiness.md\`: local-only source assessment
- \`final-report.md\`: this summary and safe import plan

## Unavailable source fields

Fields absent from the live development schema are exported blank and listed here:
${unavailable}
`;
}

export async function writeExportArtifacts(options: {
  snapshot: Snapshot;
  outputDirectory: string;
  cacheDirectory: string;
  generatedAt?: string;
}): Promise<{ selection: SponsorSelection; coverage: SourceCoverage[]; vacancySources: VacancySourceExportRow[] }> {
  const { snapshot } = options;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const selection = selectSponsorRows(snapshot.sponsors);
  const vacancySources = aggregateVacancySources(snapshot.vacancies);
  const coverage = await assessPublicSources(options.cacheDirectory, snapshot.sponsors);
  await mkdir(options.outputDirectory, { recursive: true });

  await writeCsvFile(
    join(options.outputDirectory, "jobsage-sponsor-base-export.csv"),
    selection.selected.map(toSponsorExportRow),
    SPONSOR_EXPORT_COLUMNS,
  );
  await writeCsvFile(
    join(options.outputDirectory, "jobsage-company-site-existing.csv"),
    snapshot.companySites.map((row) => Object.fromEntries(
      COMPANY_SITE_EXPORT_COLUMNS.map((column) => [column, rowText(row, column)]),
    )),
    COMPANY_SITE_EXPORT_COLUMNS,
  );
  await writeCsvFile(
    join(options.outputDirectory, "jobsage-existing-vacancy-sources.csv"),
    vacancySources,
    VACANCY_SOURCE_EXPORT_COLUMNS,
  );
  await writeFile(
    join(options.outputDirectory, "jobsage-website-enrichment-import-template.csv"),
    `${IMPORT_TEMPLATE_COLUMNS.join(",")}\n`,
    "utf8",
  );
  await writeFile(
    join(options.outputDirectory, "public-source-enrichment-readiness.md"),
    sourceReadinessReport(coverage, generatedAt),
    "utf8",
  );
  const counts = countsForReport(snapshot.sponsors, snapshot.companySites, vacancySources);
  await writeFile(
    join(options.outputDirectory, "final-report.md"),
    finalReport(
      generatedAt,
      selection,
      counts,
      coverage,
      snapshot.companySites.length,
      vacancySources.length,
      snapshot.unavailableFields,
    ),
    "utf8",
  );
  const manifest = {
    generatedAt,
    databaseMode: "development-only, read-only transaction",
    totalSponsorRows: selection.totalRows,
    sponsorRowsWritten: selection.selected.length,
    companySiteRowsWritten: snapshot.companySites.length,
    distinctVacancySourceRowsWritten: vacancySources.length,
    sourceCoverage: coverage.map((item) => ({
      source: item.source,
      sourceFile: item.sourceFile,
      sourceSnapshotDate: item.sourceSnapshotDate,
      sourceVersionEvidence: item.sourceVersionEvidence,
      sourceRecordCount: item.sourceRecordCount,
      sourceRecordMatches: item.sourceRecordMatches,
      sponsorRowsMatched: item.sponsorRowsMatched,
      potentialWebsiteAdds: item.potentialWebsiteAdds,
      potentialEmailAdds: item.potentialEmailAdds,
      confirmedPersistedEnrichments: item.confirmedPersistedEnrichments,
    })),
    unavailableSourceFields: snapshot.unavailableFields,
  };
  await writeFile(join(options.outputDirectory, "export-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await validateExportArtifacts(options.outputDirectory, {
    sponsorRows: selection.selected.length,
    companySiteRows: snapshot.companySites.length,
    vacancySourceRows: vacancySources.length,
  });
  validateSourceCoverage(coverage, snapshot.sponsors.length);
  return { selection, coverage, vacancySources };
}

export async function validateExportArtifacts(
  outputDirectory: string,
  expected: { sponsorRows: number; companySiteRows: number; vacancySourceRows: number },
): Promise<void> {
  const files: Array<{ filename: string; headers: readonly string[]; expectedRows?: number }> = [
    { filename: "jobsage-sponsor-base-export.csv", headers: SPONSOR_EXPORT_COLUMNS, expectedRows: expected.sponsorRows },
    { filename: "jobsage-company-site-existing.csv", headers: COMPANY_SITE_EXPORT_COLUMNS, expectedRows: expected.companySiteRows },
    { filename: "jobsage-existing-vacancy-sources.csv", headers: VACANCY_SOURCE_EXPORT_COLUMNS, expectedRows: expected.vacancySourceRows },
    { filename: "jobsage-website-enrichment-import-template.csv", headers: IMPORT_TEMPLATE_COLUMNS, expectedRows: 0 },
  ];
  for (const file of files) {
    const parsed = parseCsv(await readFile(join(outputDirectory, file.filename), "utf8"));
    const header = parsed[0] ?? [];
    if (JSON.stringify(header) !== JSON.stringify(file.headers)) {
      throw new Error(`${file.filename} has an unexpected header.`);
    }
    for (let index = 1; index < parsed.length; index += 1) {
      if (parsed[index]!.length !== file.headers.length) {
        throw new Error(`${file.filename} row ${index + 1} has ${parsed[index]!.length} cells; expected ${file.headers.length}.`);
      }
    }
    const rows = parsed.length - 1;
    if (file.expectedRows !== undefined && rows !== file.expectedRows) {
      throw new Error(`${file.filename} has ${rows} rows; expected ${file.expectedRows}.`);
    }
  }
}

export function validateSourceCoverage(coverage: SourceCoverage[], sponsorCount: number): void {
  for (const item of coverage) {
    if (item.sourceRecordMatches > item.sourceRecordCount) {
      throw new Error(`${item.source} matched-record count exceeds the number of source records.`);
    }
    if (item.sponsorRowsMatched > sponsorCount) {
      throw new Error(`${item.source} matched-sponsor count exceeds the sponsor base.`);
    }
    if (
      item.matchedRowsWithWebsite > item.sponsorRowsMatched ||
      item.matchedRowsWithEmail > item.sponsorRowsMatched ||
      item.potentialWebsiteAdds > item.matchedRowsWithWebsite ||
      item.potentialEmailAdds > item.matchedRowsWithEmail
    ) {
      throw new Error(`${item.source} website/email coverage counts do not reconcile.`);
    }
    for (const sample of item.samples) {
      if (!sample.matchMethod || !sample.confidence || !sample.sourceEvidenceUrl) {
        throw new Error(`${item.source} sample match is missing evidence or uncertainty metadata.`);
      }
    }
    if (item.confirmedPersistedEnrichments !== 0) {
      throw new Error(`${item.source} cannot be marked as confirmed without source-attributed provenance.`);
    }
  }
}

async function main(): Promise<void> {
  assertDevelopmentTarget(process.argv.slice(2));
  const snapshot = await loadSnapshot();
  const outputDirectory = resolve(REPORT_DIRECTORY);
  const cacheDirectory = resolve("data/cache");
  const result = await writeExportArtifacts({ snapshot, outputDirectory, cacheDirectory });
  console.log(JSON.stringify({
    outputDirectory,
    databaseMode: "development-only, read-only transaction",
    sponsorRows: `${result.selection.selected.length}/${result.selection.totalRows}`,
    companySiteRows: snapshot.companySites.length,
    distinctVacancySources: result.vacancySources.length,
    sourceCoverage: result.coverage.map((item) => ({
      source: item.source,
      matchedSponsorRows: item.sponsorRowsMatched,
      potentialWebsiteAdds: item.potentialWebsiteAdds,
      potentialEmailAdds: item.potentialEmailAdds,
    })),
    unavailableSourceFields: snapshot.unavailableFields,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}