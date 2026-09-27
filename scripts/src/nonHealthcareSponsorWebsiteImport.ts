import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  db,
  pool,
  sponsorLicenceCompanySiteChecksTable,
  sponsorLicenceWebsiteEnrichmentAuditsTable,
  sponsorLicencesTable,
} from "@workspace/db";
import type {
  InsertSponsorLicenceWebsiteEnrichmentAudit,
  SponsorWebsiteAuditCandidate,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { stringifyCsv } from "./sponsor-contact-discovery/csv";
import {
  decideWebsiteImportAction,
  normalizeSponsorIdentity,
  NON_HEALTHCARE_WEBSITE_IMPORT_COLUMNS,
  parseNonHealthcareWebsiteCsv,
  type NonHealthcareWebsiteImportAction,
  type NonHealthcareWebsiteRow,
} from "./nonHealthcareSponsorWebsiteImportCore";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const resolveRepositoryPath = (path: string) => resolve(REPOSITORY_ROOT, path);
const AUDIT_BATCH_SIZE = 250;

const DIFF_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "town_city",
  "industry",
  "website_confidence",
  "existing_website",
  "proposed_website",
  "website_evidence_url",
  "source",
  "action",
  "reason",
  "notes",
] as const;

type Options = {
  input: string;
  confirmDevelopmentDb: boolean;
  applyDevelopment: boolean;
  expectedPlanHash: string;
  diffOutput: string;
  reportOutput: string;
};

type SponsorSnapshot = {
  id: number;
  organisationName: string;
  townCity: string | null;
  industry: string | null;
  website: string | null;
};

type SiteSnapshot = {
  organisationName: string;
  careersUrl: string | null;
  atsProvider: string | null;
  atsBoardId: string | null;
  atsMappingStatus: "verified" | "unverified" | "invalid";
  atsMappingEvidenceUrl: string | null;
};

type WebsiteChange = {
  sponsorId: number;
  organisationName: string;
  townCity: string | null;
  industry: string | null;
  url: string;
};

type ImportPlan = {
  runId: string;
  planHash: string;
  databaseName: string;
  websiteChanges: WebsiteChange[];
  auditRecords: InsertSponsorLicenceWebsiteEnrichmentAudit[];
  diffRows: Array<Record<string, string>>;
  confidenceCounts: Record<string, number>;
  actionCounts: Record<string, number>;
};

function parseOptions(args: string[]): Options {
  const raw: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    if (inlineValue !== undefined) raw[key!] = inlineValue;
    else if (args[index + 1] && !args[index + 1]!.startsWith("--")) {
      raw[key!] = args[++index]!;
    } else {
      raw[key!] = true;
    }
  }

  const stringValue = (key: string): string =>
    typeof raw[key] === "string" ? raw[key] as string : "";
  const applyDevelopment = raw["apply-dev"] === true;
  if (!stringValue("input")) throw new Error("Provide --input FILE.");
  if (raw["confirm-development-db"] !== true) {
    throw new Error("Refusing database access without --confirm-development-db.");
  }
  if (applyDevelopment && !stringValue("expected-plan-hash")) {
    throw new Error("--apply-dev requires --expected-plan-hash from a reviewed dry run.");
  }
  return {
    input: resolveRepositoryPath(stringValue("input")),
    confirmDevelopmentDb: true,
    applyDevelopment,
    expectedPlanHash: stringValue("expected-plan-hash"),
    diffOutput: resolveRepositoryPath(
      stringValue("diff-output") || "artifacts/non-healthcare-website-import-dev-diff.csv",
    ),
    reportOutput: resolveRepositoryPath(
      stringValue("report-output") ||
        `artifacts/non-healthcare-website-import-dev-${applyDevelopment ? "applied" : "dry-run"}.md`,
    ),
  };
}

function assertDevelopmentTarget(): void {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Non-Healthcare website imports are development-only; set NODE_ENV=development.");
  }
  if (process.env.REPLIT_DEPLOYMENT || process.env.REPLIT_DEPLOYMENT_ID) {
    throw new Error("Refusing to import from a Replit deployment.");
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

function blank(value: string | null | undefined): boolean {
  return !value?.trim();
}

function stableRunId(csvText: string): string {
  const digest = createHash("sha256").update(csvText, "utf8").digest("hex").slice(0, 16);
  return `non-healthcare-company-websites-${digest}`;
}

function candidateForRow(row: NonHealthcareWebsiteRow): SponsorWebsiteAuditCandidate[] {
  const confidence = row.website_confidence;
  const url = row.official_website_url || row.website_evidence_url;
  if (!url || confidence === "unverified") return [];
  const parsed = new URL(url);
  const accepted = confidence === "high" || confidence === "medium";
  return [{
    url,
    hostname: parsed.hostname,
    title: row.organisation_name,
    snippet: row.notes,
    sourceUrl: row.website_evidence_url || url,
    sourceType: accepted
      ? "official_site"
      : row.source.includes("SponsorList")
        ? "directory"
        : "other",
    confidence: accepted ? confidence : "low",
    reason: row.notes || `Discovery source: ${row.source || "unspecified"}.`,
  }];
}

function actionReason(action: NonHealthcareWebsiteImportAction): string {
  switch (action) {
    case "promote_high_blank":
      return "High-confidence first-party result; target website is blank.";
    case "preserve_existing_same":
      return "Existing website already matches the high-confidence result; no update.";
    case "preserve_existing_different":
      return "A different website is already stored; existing value is preserved.";
    case "review_medium":
      return "Medium-confidence result is stored for review and is not promoted.";
    case "review_low":
      return "Low-confidence lead is stored for review and is not promoted.";
    case "unverified":
      return "No first-party identity-verified website was found.";
  }
}

function makePlan(input: {
  rows: NonHealthcareWebsiteRow[];
  sponsors: SponsorSnapshot[];
  sites: SiteSnapshot[];
  csvText: string;
  databaseName: string;
}): ImportPlan {
  const sponsorById = new Map(input.sponsors.map((sponsor) => [sponsor.id, sponsor]));
  const siteByName = new Map(input.sites.map((site) => [site.organisationName, site]));
  const seenIds = new Set<number>();
  const identitySnapshot: Array<Record<string, string | number | null>> = [];
  const websiteChanges: WebsiteChange[] = [];
  const auditRecords: InsertSponsorLicenceWebsiteEnrichmentAudit[] = [];
  const diffRows: Array<Record<string, string>> = [];
  const confidenceCounts: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
    unverified: 0,
  };
  const actionCounts: Record<string, number> = {};

  for (const row of input.rows) {
    const sponsorId = Number(row.sponsor_licence_id);
    const sponsor = sponsorById.get(sponsorId);
    if (!sponsor) {
      throw new Error(`Sponsor ID ${sponsorId} is absent from the development database.`);
    }
    if (seenIds.has(sponsorId)) throw new Error(`Duplicate sponsor ID ${sponsorId} in import plan.`);
    seenIds.add(sponsorId);

    if (
      normalizeSponsorIdentity(sponsor.organisationName) !==
        normalizeSponsorIdentity(row.organisation_name) ||
      normalizeSponsorIdentity(sponsor.townCity) !== normalizeSponsorIdentity(row.town_city) ||
      (sponsor.industry ?? "").trim() !== row.industry.trim() ||
      (sponsor.industry ?? "").trim().toLowerCase() === "healthcare"
    ) {
      throw new Error(
        `Sponsor ID ${sponsorId} no longer matches its exact non-Healthcare/name/town source identity.`,
      );
    }

    const site = siteByName.get(sponsor.organisationName);
    const currentWebsite = sponsor.website ?? "";
    const action = decideWebsiteImportAction(row, currentWebsite);
    confidenceCounts[row.website_confidence] = (confidenceCounts[row.website_confidence] ?? 0) + 1;
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    if (action === "promote_high_blank") {
      websiteChanges.push({
        sponsorId,
        organisationName: sponsor.organisationName,
        townCity: sponsor.townCity,
        industry: sponsor.industry,
        url: row.official_website_url,
      });
    }

    identitySnapshot.push({
      id: sponsor.id,
      organisationName: sponsor.organisationName,
      townCity: sponsor.townCity,
      industry: sponsor.industry,
      website: sponsor.website,
      careersUrl: site?.careersUrl ?? null,
      atsProvider: site?.atsProvider ?? null,
      atsBoardId: site?.atsBoardId ?? null,
      atsMappingStatus: site?.atsMappingStatus ?? null,
      sourceConfidence: row.website_confidence,
      sourceWebsite: row.official_website_url || null,
      sourceEvidence: row.website_evidence_url || null,
    });

    const websiteConfidence =
      row.website_confidence === "unverified" ? "none" : row.website_confidence;
    auditRecords.push({
      runId: stableRunId(input.csvText),
      organisationKey: `sponsor_licence_id:${sponsor.id}`,
      organisationName: sponsor.organisationName,
      sampleGroup: "non_healthcare_company_websites_all_sectors",
      sector: sponsor.industry,
      townCity: sponsor.townCity,
      existingWebsiteUrl: sponsor.website,
      existingCareersUrl: site?.careersUrl ?? null,
      websiteUrl: row.official_website_url || null,
      websiteConfidence,
      websiteEvidenceUrl: row.website_evidence_url || null,
      careersUrl: null,
      careersConfidence: "none",
      careersEvidenceUrl: null,
      atsProvider: site?.atsProvider ?? null,
      atsBoardId: site?.atsBoardId ?? null,
      atsMappingStatus: site?.atsMappingStatus ?? null,
      atsMappingEvidenceUrl: site?.atsMappingEvidenceUrl ?? null,
      classifications: [
        "source:non_healthcare_company_websites_all_sectors",
        `industry:${row.industry || "(blank)"}`,
        `website_confidence:${row.website_confidence}`,
        `discovery_source:${row.source || "unspecified"}`,
        `import_action:${action}`,
      ],
      candidateResults: candidateForRow(row),
      searchQueries: [],
      lastError: null,
    });

    diffRows.push({
      sponsor_licence_id: String(sponsor.id),
      organisation_name: sponsor.organisationName,
      town_city: sponsor.townCity ?? "",
      industry: sponsor.industry ?? "",
      website_confidence: row.website_confidence,
      existing_website: sponsor.website ?? "",
      proposed_website: row.official_website_url,
      website_evidence_url: row.website_evidence_url,
      source: row.source,
      action,
      reason: actionReason(action),
      notes: row.notes,
    });
  }

  if (seenIds.size !== input.rows.length) {
    throw new Error("Import plan did not retain every sponsor identity.");
  }
  const orderedDiff = diffRows.sort(
    (left, right) =>
      Number(left.sponsor_licence_id) - Number(right.sponsor_licence_id),
  );
  const orderedIdentity = identitySnapshot.sort((left, right) =>
    Number(left.id) - Number(right.id),
  );
  const orderedChanges = websiteChanges.sort((left, right) => left.sponsorId - right.sponsorId);
  const runId = stableRunId(input.csvText);
  const planHash = createHash("sha256")
    .update(JSON.stringify({
      runId,
      databaseName: input.databaseName,
      identitySnapshot: orderedIdentity,
      diffRows: orderedDiff,
      websiteChanges: orderedChanges,
    }))
    .digest("hex");

  return {
    runId,
    planHash,
    databaseName: input.databaseName,
    websiteChanges: orderedChanges,
    auditRecords,
    diffRows: orderedDiff,
    confidenceCounts,
    actionCounts,
  };
}

async function fetchSnapshots(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  rows: NonHealthcareWebsiteRow[],
  lockRows: boolean,
): Promise<{ sponsors: SponsorSnapshot[]; sites: SiteSnapshot[]; databaseName: string }> {
  const ids = rows.map((row) => Number(row.sponsor_licence_id));
  const sponsorQuery = tx.select({
    id: sponsorLicencesTable.id,
    organisationName: sponsorLicencesTable.organisationName,
    townCity: sponsorLicencesTable.townCity,
    industry: sponsorLicencesTable.industry,
    website: sponsorLicencesTable.website,
  }).from(sponsorLicencesTable).where(inArray(sponsorLicencesTable.id, ids));
  const [sponsors, currentDatabase] = await Promise.all([
    lockRows ? sponsorQuery.for("update") : sponsorQuery,
    tx.execute<{ database_name: string }>(sql`SELECT current_database() AS database_name`),
  ]);
  const databaseName = currentDatabase.rows[0]?.database_name;
  if (!databaseName || /(^|[._/-])(prod|production)([._/-]|$)/i.test(databaseName)) {
    throw new Error("Connected database name is missing or marked as production.");
  }
  if (sponsors.length !== rows.length) {
    throw new Error(
      `Expected ${rows.length} sponsor IDs in the development database; found ${sponsors.length}.`,
    );
  }

  const names = [...new Set(sponsors.map((sponsor) => sponsor.organisationName))];
  const siteQuery = tx.select({
    organisationName: sponsorLicenceCompanySiteChecksTable.organisationName,
    careersUrl: sponsorLicenceCompanySiteChecksTable.careersUrl,
    atsProvider: sponsorLicenceCompanySiteChecksTable.atsProvider,
    atsBoardId: sponsorLicenceCompanySiteChecksTable.atsBoardId,
    atsMappingStatus: sponsorLicenceCompanySiteChecksTable.atsMappingStatus,
    atsMappingEvidenceUrl: sponsorLicenceCompanySiteChecksTable.atsMappingEvidenceUrl,
  }).from(sponsorLicenceCompanySiteChecksTable)
    .where(inArray(sponsorLicenceCompanySiteChecksTable.organisationName, names));
  const sites = lockRows ? await siteQuery.for("update") : await siteQuery;
  return { sponsors, sites, databaseName };
}

async function applyPlan(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  plan: ImportPlan,
): Promise<{ websitesApplied: number; auditRowsInserted: number; auditRowsAlreadyStored: number }> {
  let websitesApplied = 0;
  for (const change of plan.websiteChanges) {
    const updated = await tx.update(sponsorLicencesTable)
      .set({ website: change.url })
      .where(and(
        eq(sponsorLicencesTable.id, change.sponsorId),
        eq(sponsorLicencesTable.organisationName, change.organisationName),
        sql`${sponsorLicencesTable.townCity} IS NOT DISTINCT FROM ${change.townCity}`,
        sql`${sponsorLicencesTable.industry} IS NOT DISTINCT FROM ${change.industry}`,
        sql`(${sponsorLicencesTable.website} IS NULL OR btrim(${sponsorLicencesTable.website}) = '')`,
      ))
      .returning({ id: sponsorLicencesTable.id });
    if (updated.length !== 1) {
      throw new Error(
        `Sponsor ${change.sponsorId} changed during import; the transaction was stopped.`,
      );
    }
    websitesApplied += 1;
  }

  let auditRowsInserted = 0;
  for (let offset = 0; offset < plan.auditRecords.length; offset += AUDIT_BATCH_SIZE) {
    const inserted = await tx.insert(sponsorLicenceWebsiteEnrichmentAuditsTable)
      .values(plan.auditRecords.slice(offset, offset + AUDIT_BATCH_SIZE))
      .onConflictDoNothing({
        target: [
          sponsorLicenceWebsiteEnrichmentAuditsTable.runId,
          sponsorLicenceWebsiteEnrichmentAuditsTable.organisationKey,
        ],
      })
      .returning({ id: sponsorLicenceWebsiteEnrichmentAuditsTable.id });
    auditRowsInserted += inserted.length;
  }
  return {
    websitesApplied,
    auditRowsInserted,
    auditRowsAlreadyStored: plan.auditRecords.length - auditRowsInserted,
  };
}

async function writeNewOrIdentical(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== content) {
      throw new Error(`Refusing to overwrite non-identical output: ${path}`);
    }
  }
}

function reportMarkdown(input: {
  mode: "dry-run" | "applied";
  options: Options;
  plan: ImportPlan;
  applied?: {
    websitesApplied: number;
    auditRowsInserted: number;
    auditRowsAlreadyStored: number;
  };
}): string {
  const { mode, options, plan, applied } = input;
  const lines = [
    "# Non-Healthcare sponsor website import",
    "",
    `- Mode: **${mode}**`,
    `- Input CSV: \`${options.input}\``,
    `- Database: development only (\`${plan.databaseName}\`)`,
    `- Run ID: \`${plan.runId}\``,
    `- Reviewed plan SHA-256: \`${plan.planHash}\``,
    `- Input rows/audit records: **${plan.auditRecords.length}**`,
    `- Confidence counts: high **${plan.confidenceCounts.high}**, medium **${plan.confidenceCounts.medium}**, low **${plan.confidenceCounts.low}**, unverified **${plan.confidenceCounts.unverified}**`,
    `- Planned high-confidence website updates into blank fields: **${plan.websiteChanges.length}**`,
    `- Action counts: ${Object.entries(plan.actionCounts).map(([action, count]) => `${action} **${count}**`).join("; ")}`,
    "",
    "Only high-confidence websites are promoted, and only into blank sponsor website fields. Existing websites are never overwritten. Medium- and low-confidence findings remain in the audit table for review; low-confidence URLs are not accepted as official websites. Unverified rows are recorded without a website candidate.",
    "",
    mode === "dry-run"
      ? "**Dry run only: no database changes were made.**"
      : `Applied website updates: **${applied?.websitesApplied ?? 0}**; audit rows inserted: **${applied?.auditRowsInserted ?? 0}**; already stored from this run: **${applied?.auditRowsAlreadyStored ?? 0}**.`,
    "",
    "Production was not accessed or changed.",
    "",
  ];
  return `${lines.join("\n")}`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  assertDevelopmentTarget();
  const csvText = await readFile(options.input, "utf8");
  const rows = parseNonHealthcareWebsiteCsv(csvText);
  const runId = stableRunId(csvText);
  let plan: ImportPlan | undefined;
  let applied: {
    websitesApplied: number;
    auditRowsInserted: number;
    auditRowsAlreadyStored: number;
  } | undefined;

  await db.transaction(async (tx) => {
    if (!options.applyDevelopment) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const snapshots = await fetchSnapshots(tx, rows, options.applyDevelopment);
    plan = makePlan({
      rows,
      sponsors: snapshots.sponsors,
      sites: snapshots.sites,
      csvText,
      databaseName: snapshots.databaseName,
    });
    if (plan.runId !== runId) throw new Error("Internal import run ID mismatch.");
    if (options.applyDevelopment) {
      if (plan.planHash !== options.expectedPlanHash) {
        throw new Error("The development data changed since dry run; refusing to apply this plan.");
      }
      applied = await applyPlan(tx, plan);
    }
  });

  if (!plan) throw new Error("Import plan was not created.");
  await writeNewOrIdentical(options.diffOutput, stringifyCsv(plan.diffRows, DIFF_COLUMNS));
  await writeNewOrIdentical(
    options.reportOutput,
    reportMarkdown({
      mode: options.applyDevelopment ? "applied" : "dry-run",
      options,
      plan,
      applied,
    }),
  );
  process.stdout.write(`${JSON.stringify({
    mode: options.applyDevelopment ? "applied" : "dry-run",
    inputRows: rows.length,
    runId: plan.runId,
    planHash: plan.planHash,
    confidenceCounts: plan.confidenceCounts,
    actionCounts: plan.actionCounts,
    plannedWebsiteUpdates: plan.websiteChanges.length,
    auditRowsInserted: applied?.auditRowsInserted ?? 0,
    auditRowsAlreadyStored: applied?.auditRowsAlreadyStored ?? 0,
    websitesApplied: applied?.websitesApplied ?? 0,
    diffOutput: options.diffOutput,
    reportOutput: options.reportOutput,
  }, null, 2)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });