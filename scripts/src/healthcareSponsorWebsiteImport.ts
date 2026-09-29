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
  batchRunId,
  HEALTHCARE_SPONSOR_BATCH_COLUMNS,
  isMediumReviewRow,
  normalizeSponsorIdentity,
  parseHealthcareSponsorBatchCsv,
  type HealthcareSponsorBatchRow,
} from "./healthcareSponsorWebsiteImportCore";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const resolveRepositoryPath = (path: string) => resolve(REPOSITORY_ROOT, path);

const DIFF_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "town_city",
  "field",
  "existing_value",
  "proposed_value",
  "confidence",
  "evidence_url",
  "action",
  "reason",
] as const;

const MEDIUM_REVIEW_COLUMNS = [
  "batch_number",
  "review_status",
  ...HEALTHCARE_SPONSOR_BATCH_COLUMNS,
] as const;

type Options = {
  input: string;
  batchNumber: number;
  confirmDevelopmentDb: boolean;
  applyDevelopment: boolean;
  expectedPlanHash: string;
  diffOutput: string;
  mediumOutput: string;
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
  atsMappingStatus: string;
};

type DiffRow = Record<(typeof DIFF_COLUMNS)[number], string>;
type WebsiteChange = { sponsorId: number; url: string };
type CareersChange = { organisationName: string; url: string };

type ImportPlan = {
  runId: string;
  diffRows: DiffRow[];
  websiteChanges: WebsiteChange[];
  careersChanges: CareersChange[];
  auditRecords: InsertSponsorLicenceWebsiteEnrichmentAudit[];
  planHash: string;
  mediumCount: number;
  atsHeldCount: number;
  sponsorsWithWebsiteBefore: number;
  organisationsWithCareersBefore: number;
  databaseName: string;
};

function parseOptions(args: string[]): Options {
  const raw: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) continue;
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    if (inlineValue !== undefined) raw[key!] = inlineValue;
    else if (args[index + 1] && !args[index + 1]!.startsWith("--")) raw[key!] = args[++index]!;
    else raw[key!] = true;
  }
  const stringValue = (key: string): string => typeof raw[key] === "string" ? raw[key] as string : "";
  const batchNumber = Number(stringValue("batch-number"));
  const applyDevelopment = raw["apply-dev"] === true;
  if (!stringValue("input")) throw new Error("Provide --input FILE.");
  if (!Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > 6) {
    throw new Error("Provide --batch-number 1 through 6.");
  }
  if (raw["confirm-development-db"] !== true) {
    throw new Error("Refusing database access without --confirm-development-db.");
  }
  if (applyDevelopment && !stringValue("expected-plan-hash")) {
    throw new Error("--apply-dev requires --expected-plan-hash from a reviewed dry run.");
  }
  const suffix = `batch${batchNumber}`;
  const mode = applyDevelopment ? "applied" : "dry-run";
  return {
    input: resolveRepositoryPath(stringValue("input")),
    batchNumber,
    confirmDevelopmentDb: true,
    applyDevelopment,
    expectedPlanHash: stringValue("expected-plan-hash"),
    diffOutput: resolveRepositoryPath(stringValue("diff-output") ||
      `artifacts/healthcare-sponsor-website-import-${suffix}-diff.csv`),
    mediumOutput: resolveRepositoryPath(stringValue("medium-output") ||
      `artifacts/healthcare-sponsor-website-medium-review-${suffix}.csv`),
    reportOutput: resolveRepositoryPath(stringValue("report-output") ||
      `artifacts/healthcare-sponsor-website-import-${suffix}-${mode}.md`),
  };
}

function assertDevelopmentTarget(): void {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Healthcare sponsor website imports are development-only; set NODE_ENV=development.");
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

function auditCandidate(input: {
  url: string;
  evidenceUrl: string;
  type: SponsorWebsiteAuditCandidate["sourceType"];
  confidence: SponsorWebsiteAuditCandidate["confidence"];
  title: string;
  reason: string;
}): SponsorWebsiteAuditCandidate {
  const parsed = new URL(input.url);
  return {
    url: input.url,
    hostname: parsed.hostname,
    title: input.title,
    snippet: "",
    sourceUrl: input.evidenceUrl,
    sourceType: input.type,
    confidence: input.confidence,
    reason: input.reason,
  };
}

function validateAtsAuditFields(row: HealthcareSponsorBatchRow, rowNumber: number): void {
  const provider = row.ats_provider.trim();
  const boardId = row.ats_board_id.trim();
  const status = row.ats_mapping_status.trim();
  const evidence = row.ats_mapping_evidence_url.trim();
  if (!provider && !boardId && !status && !evidence) return;
  if (!provider || !status || !evidence) {
    throw new Error(`Row ${rowNumber}: ATS audit evidence is incomplete.`);
  }
  if (!["verified", "unverified", "invalid"].includes(status)) {
    throw new Error(`Row ${rowNumber}: unsupported ATS mapping status ${status}.`);
  }
  try {
    const parsed = new URL(evidence);
    if (parsed.protocol !== "https:" || !parsed.hostname) throw new Error();
  } catch {
    throw new Error(`Row ${rowNumber}: ATS mapping evidence must be an HTTPS URL.`);
  }
}

function currentSiteByName(sites: SiteSnapshot[]): Map<string, SiteSnapshot> {
  return new Map(sites.map((site) => [site.organisationName, site]));
}

function makePlan(input: {
  rows: HealthcareSponsorBatchRow[];
  sponsors: SponsorSnapshot[];
  sites: SiteSnapshot[];
  batchNumber: number;
  csvText: string;
  databaseName: string;
}): ImportPlan {
  const sponsorById = new Map(input.sponsors.map((row) => [row.id, row]));
  const siteByName = currentSiteByName(input.sites);
  const inputIds = new Set<number>();
  const seen = new Set<number>();
  const diffRows: DiffRow[] = [];
  const websiteChanges: WebsiteChange[] = [];
  const candidatesByEmployer = new Map<string, Array<{
    row: HealthcareSponsorBatchRow;
    confidence: string;
    evidence: string;
  }>>();
  const identitySnapshot: Array<Record<string, string | number | null>> = [];
  let mediumCount = 0;
  let atsHeldCount = 0;
  let sponsorsWithWebsiteBefore = 0;
  const careersNames = new Set<string>();

  for (const [index, row] of input.rows.entries()) {
    const sponsorId = Number(row.sponsor_licence_id);
    const sponsor = sponsorById.get(sponsorId);
    if (!sponsor) throw new Error(`Sponsor ID ${sponsorId} is absent from the development database.`);
    if (
      sponsor.industry !== "Healthcare" ||
      normalizeSponsorIdentity(sponsor.organisationName) !== normalizeSponsorIdentity(row.organisation_name) ||
      normalizeSponsorIdentity(sponsor.townCity) !== normalizeSponsorIdentity(row.town_city)
    ) {
      throw new Error(`Sponsor ID ${sponsorId} no longer matches its exact Healthcare/name/town source identity.`);
    }
    if (seen.has(sponsorId)) throw new Error(`Duplicate sponsor ID ${sponsorId} in import plan.`);
    seen.add(sponsorId);
    inputIds.add(sponsorId);
    validateAtsAuditFields(row, index + 2);

    const currentWebsite = sponsor.website ?? "";
    if (!blank(currentWebsite)) sponsorsWithWebsiteBefore += 1;
    const site = siteByName.get(sponsor.organisationName);
    const currentCareers = site?.careersUrl ?? "";
    if (row.careers_url) careersNames.add(sponsor.organisationName);
    if (isMediumReviewRow(row)) mediumCount += 1;
    if (row.ats_provider || row.ats_board_id || row.ats_mapping_status) atsHeldCount += 1;

    identitySnapshot.push({
      id: sponsor.id,
      organisationName: sponsor.organisationName,
      townCity: sponsor.townCity,
      industry: sponsor.industry,
      website: sponsor.website,
      careersUrl: currentCareers,
      atsProvider: site?.atsProvider ?? null,
      atsBoardId: site?.atsBoardId ?? null,
      atsMappingStatus: site?.atsMappingStatus ?? null,
    });

    if (row.website_url) {
      let action: string;
      let reason: string;
      if (row.website_confidence === "high") {
        if (blank(currentWebsite)) {
          action = "update_blank";
          reason = "high-confidence first-party evidence; target website is blank";
          websiteChanges.push({ sponsorId, url: row.website_url });
        } else {
          action = "skip_existing";
          reason = "existing development website value is preserved";
        }
      } else if (row.website_confidence === "medium") {
        action = "review_only";
        reason = "medium-confidence value is retained for later review, not promoted";
      } else {
        action = "audit_only";
        reason = "non-high-confidence value is retained in the audit record only";
      }
      diffRows.push({
        sponsor_licence_id: String(sponsorId),
        organisation_name: row.organisation_name,
        town_city: row.town_city,
        field: "website_url",
        existing_value: currentWebsite,
        proposed_value: row.website_url,
        confidence: row.website_confidence,
        evidence_url: row.website_evidence_url,
        action,
        reason,
      });
    }

    if (row.careers_url) {
      const candidates = candidatesByEmployer.get(sponsor.organisationName) ?? [];
      candidates.push({
        row,
        confidence: row.careers_confidence,
        evidence: row.careers_evidence_url,
      });
      candidatesByEmployer.set(sponsor.organisationName, candidates);
    }
  }

  const careersChanges: CareersChange[] = [];
  const careersGroupPlans = new Map<string, { action: string; reason: string; url: string; evidence: string }>();
  for (const [organisationName, candidates] of candidatesByEmployer) {
    const candidateUrls = [...new Set(candidates.map(({ row }) => row.careers_url))];
    const highCandidates = candidates.filter((candidate) => candidate.confidence === "high");
    const site = siteByName.get(organisationName);
    const currentCareers = site?.careersUrl ?? "";
    let action = "review_only";
    let reason = "medium-confidence value is retained for later review, not promoted";
    const selectedUrl = candidateUrls[0] ?? "";
    const selectedEvidence = candidates.find((candidate) => candidate.row.careers_url === selectedUrl)?.evidence ?? "";
    if (candidateUrls.length > 1) {
      action = "blocked_conflict";
      reason = "distinct careers URLs exist for the same company-site record; held for review";
    } else if (highCandidates.length > 0) {
      if (blank(currentCareers)) {
        action = "update_blank";
        reason = "high-confidence careers evidence; target careers URL is blank";
        careersChanges.push({ organisationName, url: selectedUrl });
      } else {
        action = "skip_existing";
        reason = "existing careers URL is preserved";
      }
    } else if (candidates.some((candidate) => candidate.confidence === "low")) {
      action = "audit_only";
      reason = "non-high-confidence careers value is retained in the audit record only";
    }
    careersGroupPlans.set(organisationName, {
      action,
      reason,
      url: selectedUrl,
      evidence: selectedEvidence,
    });
    for (const candidate of candidates) {
      const isMedium = candidate.confidence === "medium";
      diffRows.push({
        sponsor_licence_id: candidate.row.sponsor_licence_id,
        organisation_name: candidate.row.organisation_name,
        town_city: candidate.row.town_city,
        field: "careers_url",
        existing_value: currentCareers,
        proposed_value: candidate.row.careers_url,
        confidence: candidate.row.careers_confidence,
        evidence_url: candidate.evidence,
        action: isMedium ? "review_only" : action,
        reason: isMedium
          ? "medium-confidence value is retained for later review, not promoted"
          : reason,
      });
    }
  }

  const auditRecords: InsertSponsorLicenceWebsiteEnrichmentAudit[] = input.rows.map((row) => {
    const sponsor = sponsorById.get(Number(row.sponsor_licence_id))!;
    const site = siteByName.get(sponsor.organisationName);
    const candidates: SponsorWebsiteAuditCandidate[] = [];
    if (row.website_url) {
      candidates.push(auditCandidate({
        url: row.website_url,
        evidenceUrl: row.website_evidence_url,
        type: "official_site",
        confidence: row.website_confidence as Exclude<SponsorWebsiteAuditCandidate["confidence"], "none">,
        title: row.organisation_name,
        reason: row.notes || "First-party employer page recorded in the batch.",
      }));
    }
    if (row.careers_url) {
      candidates.push(auditCandidate({
        url: row.careers_url,
        evidenceUrl: row.careers_evidence_url,
        type: "careers",
        confidence: row.careers_confidence as Exclude<SponsorWebsiteAuditCandidate["confidence"], "none">,
        title: `${row.organisation_name} careers`,
        reason: row.notes || "Careers destination recorded in the batch.",
      }));
    }
    if (row.source_evidence_url) {
      try {
        const parsed = new URL(row.source_evidence_url);
        if (["https:", "http:"].includes(parsed.protocol)) {
          candidates.push(auditCandidate({
            url: row.source_evidence_url,
            evidenceUrl: row.source_evidence_url,
            type: "directory",
            confidence: "low",
            title: row.source || "Discovery lead",
            reason: "Discovery lead only; not accepted as an official employer website.",
          }));
        }
      } catch {
        // A malformed non-claim lead is left in the source fields and notes, not promoted.
      }
    }
    const careerPlan = careersGroupPlans.get(sponsor.organisationName);
    return {
      runId: batchRunId(input.batchNumber, input.csvText),
      organisationKey: `sponsor_licence_id:${sponsor.id}`,
      organisationName: sponsor.organisationName,
      sampleGroup: `healthcare_sponsor_website_batch_${String(input.batchNumber).padStart(3, "0")}`,
      sector: "Healthcare",
      townCity: sponsor.townCity,
      existingWebsiteUrl: sponsor.website,
      existingCareersUrl: site?.careersUrl ?? null,
      websiteUrl: row.website_url || null,
      websiteConfidence: row.website_confidence,
      websiteEvidenceUrl: row.website_evidence_url || null,
      careersUrl: row.careers_url || null,
      careersConfidence: row.careers_confidence,
      careersEvidenceUrl: row.careers_evidence_url || null,
      atsProvider: row.ats_provider || null,
      atsBoardId: row.ats_board_id || null,
      atsMappingStatus: row.ats_mapping_status
        ? row.ats_mapping_status as "verified" | "unverified" | "invalid"
        : null,
      atsMappingEvidenceUrl: row.ats_mapping_evidence_url || null,
      classifications: [
        "industry:Healthcare",
        `batch:${input.batchNumber}`,
        `website_confidence:${row.website_confidence}`,
        `careers_confidence:${row.careers_confidence}`,
        ...(isMediumReviewRow(row) ? ["review:medium_confidence_pending"] : []),
        ...(careerPlan?.action === "blocked_conflict" ? ["review:careers_conflict"] : []),
      ],
      candidateResults: candidates,
      searchQueries: [],
      lastError: row.notes || null,
    };
  });

  const orderedDiff = diffRows.sort((left, right) =>
    Number(left.sponsor_licence_id) - Number(right.sponsor_licence_id) ||
    left.field.localeCompare(right.field),
  );
  const runId = batchRunId(input.batchNumber, input.csvText);
  const planHash = createHash("sha256")
    .update(JSON.stringify({
      runId,
      identitySnapshot,
      orderedDiff,
      websiteChanges,
      careersChanges,
    }))
    .digest("hex");
  const siteNames = new Set(input.rows.map((row) =>
    sponsorById.get(Number(row.sponsor_licence_id))!.organisationName,
  ));
  const organisationsWithCareersBefore = [...siteNames].filter((name) =>
    !blank(siteByName.get(name)?.careersUrl),
  ).length;

  if (inputIds.size !== input.rows.length) throw new Error("Import plan did not retain every sponsor identity.");
  return {
    runId,
    diffRows: orderedDiff,
    websiteChanges,
    careersChanges,
    auditRecords,
    planHash,
    mediumCount,
    atsHeldCount,
    sponsorsWithWebsiteBefore,
    organisationsWithCareersBefore,
    databaseName: input.databaseName,
  };
}

async function fetchSnapshots(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  rows: HealthcareSponsorBatchRow[],
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
  const names = [...new Set(sponsors.map((sponsor) => sponsor.organisationName))];
  const siteQuery = tx.select({
    organisationName: sponsorLicenceCompanySiteChecksTable.organisationName,
    careersUrl: sponsorLicenceCompanySiteChecksTable.careersUrl,
    atsProvider: sponsorLicenceCompanySiteChecksTable.atsProvider,
    atsBoardId: sponsorLicenceCompanySiteChecksTable.atsBoardId,
    atsMappingStatus: sponsorLicenceCompanySiteChecksTable.atsMappingStatus,
  }).from(sponsorLicenceCompanySiteChecksTable)
    .where(inArray(sponsorLicenceCompanySiteChecksTable.organisationName, names));
  const sites = lockRows ? await siteQuery.for("update") : await siteQuery;
  return { sponsors, sites, databaseName };
}

async function applyPlan(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  plan: ImportPlan,
): Promise<{
  websiteApplied: number;
  careersApplied: number;
  auditRowsInserted: number;
  auditRowsAlreadyStored: number;
}> {
  const now = new Date();
  let websiteApplied = 0;
  let careersApplied = 0;
  for (const change of plan.websiteChanges) {
    const updated = await tx.update(sponsorLicencesTable)
      .set({ website: change.url })
      .where(and(
        eq(sponsorLicencesTable.id, change.sponsorId),
        eq(sponsorLicencesTable.industry, "Healthcare"),
        sql`(${sponsorLicencesTable.website} IS NULL OR btrim(${sponsorLicencesTable.website}) = '')`,
      ))
      .returning({ id: sponsorLicencesTable.id });
    if (updated.length !== 1) {
      throw new Error(`Sponsor ${change.sponsorId} changed during import; the transaction was stopped.`);
    }
    websiteApplied += 1;
  }

  for (const change of plan.careersChanges) {
    const inserted = await tx.insert(sponsorLicenceCompanySiteChecksTable)
      .values({
        organisationName: change.organisationName,
        careersUrl: change.url,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: sponsorLicenceCompanySiteChecksTable.organisationName })
      .returning({ id: sponsorLicenceCompanySiteChecksTable.id });
    if (inserted.length === 1) {
      careersApplied += 1;
      continue;
    }
    const updated = await tx.update(sponsorLicenceCompanySiteChecksTable)
      .set({ careersUrl: change.url, updatedAt: now })
      .where(and(
        eq(sponsorLicenceCompanySiteChecksTable.organisationName, change.organisationName),
        sql`(${sponsorLicenceCompanySiteChecksTable.careersUrl} IS NULL OR btrim(${sponsorLicenceCompanySiteChecksTable.careersUrl}) = '')`,
      ))
      .returning({ id: sponsorLicenceCompanySiteChecksTable.id });
    if (updated.length !== 1) {
      throw new Error(`Careers row for ${change.organisationName} changed during import; the transaction was stopped.`);
    }
    careersApplied += 1;
  }

  const insertedAuditRows = await tx.insert(sponsorLicenceWebsiteEnrichmentAuditsTable)
    .values(plan.auditRecords)
    .onConflictDoNothing({
      target: [
        sponsorLicenceWebsiteEnrichmentAuditsTable.runId,
        sponsorLicenceWebsiteEnrichmentAuditsTable.organisationKey,
      ],
    })
    .returning({ id: sponsorLicenceWebsiteEnrichmentAuditsTable.id });
  return {
    websiteApplied,
    careersApplied,
    auditRowsInserted: insertedAuditRows.length,
    auditRowsAlreadyStored: plan.auditRecords.length - insertedAuditRows.length,
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

function reportMarkdown(options: {
  mode: "dry-run" | "applied";
  inputPath: string;
  batchNumber: number;
  plan: ImportPlan;
  applied?: {
    websiteApplied: number;
    careersApplied: number;
    auditRowsInserted: number;
    auditRowsAlreadyStored: number;
  };
}): string {
  const { plan } = options;
  const lines = [
    `# Healthcare sponsor website import — batch ${options.batchNumber} (${options.mode})`,
    "",
    `- Input CSV: \`${options.inputPath}\``,
    `- Database: development only (\`${plan.databaseName}\`)`,
    `- Run ID: \`${plan.runId}\``,
    `- Plan SHA-256: \`${plan.planHash}\``,
    `- Source rows and audit records: **${plan.auditRecords.length}**`,
    `- High-confidence website updates with blank targets: **${plan.websiteChanges.length}**`,
    `- High-confidence careers updates with blank targets: **${plan.careersChanges.length}**`,
    `- Medium-confidence sponsor rows held for review: **${plan.mediumCount}**`,
    `- ATS candidates held in audit only: **${plan.atsHeldCount}**`,
    `- Website targets already populated before this batch: **${plan.sponsorsWithWebsiteBefore}**`,
    `- Distinct employer careers targets already populated before this batch: **${plan.organisationsWithCareersBefore}**`,
    "",
    "High-confidence fields are written only when the current target is blank. Existing values are never overwritten. Medium-confidence website/careers values are retained in the audit table and medium-review CSV, not promoted. ATS mappings are audit-only.",
    "",
    options.mode === "dry-run"
      ? "**Dry run only: no database changes were made.**"
      : `Applied website updates: **${options.applied?.websiteApplied ?? 0}**; careers employer rows: **${options.applied?.careersApplied ?? 0}**; audit rows inserted: **${options.applied?.auditRowsInserted ?? 0}**; already stored from this same run: **${options.applied?.auditRowsAlreadyStored ?? 0}**.`,
    "",
    "No production database was accessed and no deployment was performed.",
    "",
  ];
  return `${lines.join("\n")}`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  assertDevelopmentTarget();
  const csvText = await readFile(options.input, "utf8");
  const rows = parseHealthcareSponsorBatchCsv(csvText);
  const runId = batchRunId(options.batchNumber, csvText);
  let plan: ImportPlan | undefined;
  let applied: {
    websiteApplied: number;
    careersApplied: number;
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
      batchNumber: options.batchNumber,
      csvText,
      databaseName: snapshots.databaseName,
    });
    if (plan.runId !== runId) throw new Error("Internal batch run ID mismatch.");
    if (options.applyDevelopment) {
      if (plan.planHash !== options.expectedPlanHash) {
        throw new Error("The development data changed since dry run; refusing to apply this plan.");
      }
      applied = await applyPlan(tx, plan);
    }
  });

  if (!plan) throw new Error("Import plan was not created.");
  const mediumRows = rows
    .filter(isMediumReviewRow)
    .map((row) => ({ batch_number: options.batchNumber, review_status: "pending", ...row }));
  await writeNewOrIdentical(options.diffOutput, stringifyCsv(plan.diffRows, DIFF_COLUMNS));
  await writeNewOrIdentical(
    options.mediumOutput,
    stringifyCsv(mediumRows, MEDIUM_REVIEW_COLUMNS),
  );
  await writeNewOrIdentical(
    options.reportOutput,
    reportMarkdown({
      mode: options.applyDevelopment ? "applied" : "dry-run",
      inputPath: options.input,
      batchNumber: options.batchNumber,
      plan,
      applied,
    }),
  );
  process.stdout.write(`${JSON.stringify({
    mode: options.applyDevelopment ? "applied" : "dry-run",
    batchNumber: options.batchNumber,
    inputRows: rows.length,
    runId: plan.runId,
    planHash: plan.planHash,
    plannedWebsiteUpdates: plan.websiteChanges.length,
    plannedCareersEmployerRows: plan.careersChanges.length,
    mediumRowsHeldForReview: plan.mediumCount,
    auditRowsInserted: applied?.auditRowsInserted ?? 0,
    auditRowsAlreadyStored: applied?.auditRowsAlreadyStored ?? 0,
    websiteApplied: applied?.websiteApplied ?? 0,
    careersApplied: applied?.careersApplied ?? 0,
    diffOutput: options.diffOutput,
    mediumReviewOutput: options.mediumOutput,
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