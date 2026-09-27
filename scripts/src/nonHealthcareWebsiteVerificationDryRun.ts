import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsvObjects, stringifyCsv } from "./sponsor-contact-discovery/csv";
import { websiteCandidateFromValue } from "./nonHealthcareWebsiteIdentity";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_INPUT = "artifacts/non-healthcare-company-websites-all-sectors.csv";
const DEFAULT_OUTPUT =
  "artifacts/non-healthcare-company-websites-verification-dry-run.csv";
const DEFAULT_REPORT =
  "artifacts/non-healthcare-company-websites-verification-dry-run.md";

const REQUIRED_INPUT_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "industry",
  "website_confidence",
  "official_website_url",
  "website_evidence_url",
] as const;

const OUTPUT_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "industry",
  "town_city",
  "county",
  "region",
  "current_confidence",
  "current_official_website_url",
  "evidence_url",
  "candidate_site_root",
  "evidence_host",
  "evidence_path",
  "discovery_source",
  "dry_run_status",
  "verification_requirements",
  "planned_page_checks",
  "network_requests_made",
  "current_notes",
] as const;

type SourceRow = Record<string, string>;
type QueueRow = Record<(typeof OUTPUT_COLUMNS)[number], string>;

export type DryRunQueueResult = {
  inputRowCount: number;
  eligibleRowCount: number;
  queuedRowCount: number;
  limitApplied: number | null;
  rows: QueueRow[];
};

type CliOptions = {
  input: string;
  output: string;
  report: string;
  limit: number | null;
  overwrite: boolean;
};

type SanitizedUrl = {
  url: string;
  hostname: string;
  pathname: string;
  valid: boolean;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function sanitizeHttpUrl(value: string): SanitizedUrl {
  const raw = text(value);
  if (!raw) return { url: "", hostname: "", pathname: "", valid: false };

  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes(".") ||
      parsed.hostname.includes("%") ||
      parsed.hostname.toLowerCase() === "localhost"
    ) {
      return { url: "", hostname: "", pathname: "", valid: false };
    }

    parsed.search = "";
    parsed.hash = "";
    return {
      url: parsed.toString(),
      hostname: parsed.hostname.toLowerCase().replace(/\.$/, ""),
      pathname: parsed.pathname || "/",
      valid: true,
    };
  } catch {
    return { url: "", hostname: "", pathname: "", valid: false };
  }
}

function verificationRequirements(confidence: "medium" | "low"): string {
  if (confidence === "medium") {
    return "Reconfirm the employer identity and require corroboration beyond the original token check: distinctive legal or trading name plus matching geography or a reliable official-register/cross-link signal; reject conflicting identity.";
  }
  return "The original evidence was a single name-token match without a hostname match. Require stronger distinctive-name and domain alignment plus matching geography or a reliable official-register/cross-link signal; otherwise retain low confidence.";
}

const PLANNED_PAGE_CHECKS =
  "In a later approved live pass: check the homepage, then same-origin About/Contact/Careers pages discoverable from its links; compare visible legal/brand name, address/location, and structured Organization data; reject conflicting identity and cross-host redirects.";

function toQueueRow(source: SourceRow): QueueRow {
  const confidence = text(source.website_confidence).toLowerCase();
  const currentOfficial = sanitizeHttpUrl(source.official_website_url ?? "");
  const evidence = sanitizeHttpUrl(source.website_evidence_url ?? "");
  const candidateValue =
    confidence === "medium"
      ? currentOfficial.url
      : evidence.url;
  const candidate = websiteCandidateFromValue(
    candidateValue,
    text(source.source) || "existing_evidence",
    evidence.url,
  );
  const evidenceCandidate = evidence.valid
    ? websiteCandidateFromValue(
        evidence.url,
        text(source.source) || "existing_evidence",
        evidence.url,
      )
    : null;

  let dryRunStatus = "ready_for_independent_check";
  if (!text(source.sponsor_licence_id)) {
    dryRunStatus = "manual_review_missing_sponsor_id";
  } else if (!evidence.valid) {
    dryRunStatus = "manual_review_missing_or_invalid_evidence_url";
  } else if (!candidate || !evidenceCandidate) {
    dryRunStatus = "manual_review_candidate_host_not_eligible";
  } else if (
    normalizeHostname(candidate.domain) !==
    normalizeHostname(evidenceCandidate.domain)
  ) {
    dryRunStatus = "manual_review_evidence_domain_mismatch";
  }

  const safeOfficial = currentOfficial.valid
    ? websiteCandidateFromValue(
        currentOfficial.url,
        text(source.source) || "existing_evidence",
        evidence.url,
      )?.url ?? ""
    : "";

  return {
    sponsor_licence_id: text(source.sponsor_licence_id),
    organisation_name: text(source.organisation_name),
    industry: text(source.industry),
    town_city: text(source.town_city),
    county: text(source.county),
    region: text(source.region),
    current_confidence: confidence,
    current_official_website_url: safeOfficial,
    evidence_url: evidence.url,
    candidate_site_root: candidate?.url ?? "",
    evidence_host: evidence.hostname,
    evidence_path: evidence.pathname,
    discovery_source: text(source.source),
    dry_run_status: dryRunStatus,
    verification_requirements: verificationRequirements(
      confidence as "medium" | "low",
    ),
    planned_page_checks: PLANNED_PAGE_CHECKS,
    network_requests_made: "0",
    current_notes: text(source.notes).slice(0, 500),
  };
}

export function buildWebsiteVerificationQueue(
  sourceRows: readonly SourceRow[],
  limit: number | null = null,
): DryRunQueueResult {
  const eligible = sourceRows.filter((row) => {
    const confidence = text(row.website_confidence).toLowerCase();
    return confidence === "medium" || confidence === "low";
  });
  const seenSponsorIds = new Set<string>();
  for (const row of eligible) {
    const sponsorId = text(row.sponsor_licence_id);
    if (!sponsorId) continue;
    if (seenSponsorIds.has(sponsorId)) {
      throw new Error(`Duplicate sponsor_licence_id in verification input: ${sponsorId}`);
    }
    seenSponsorIds.add(sponsorId);
  }

  const selected = limit === null ? eligible : eligible.slice(0, limit);
  return {
    inputRowCount: sourceRows.length,
    eligibleRowCount: eligible.length,
    queuedRowCount: selected.length,
    limitApplied: limit,
    rows: selected.map(toQueueRow),
  };
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function displayIndustry(industry: string): string {
  return industry || "(blank industry)";
}

function buildReport(
  result: DryRunQueueResult,
  inputPath: string,
  outputPath: string,
): string {
  const counts = new Map<
    string,
    { medium: number; low: number; ready: number; manual: number }
  >();
  for (const row of result.rows) {
    const industry = displayIndustry(row.industry);
    const count = counts.get(industry) ?? {
      medium: 0,
      low: 0,
      ready: 0,
      manual: 0,
    };
    if (row.current_confidence === "medium") count.medium += 1;
    else count.low += 1;
    if (row.dry_run_status === "ready_for_independent_check") count.ready += 1;
    else count.manual += 1;
    counts.set(industry, count);
  }

  const statusCounts = new Map<string, number>();
  for (const row of result.rows) {
    statusCounts.set(
      row.dry_run_status,
      (statusCounts.get(row.dry_run_status) ?? 0) + 1,
    );
  }
  const mediumCount = result.rows.filter(
    (row) => row.current_confidence === "medium",
  ).length;
  const lowCount = result.rows.length - mediumCount;
  const statusLines = [...statusCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join("\n");
  const sectorLines = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([industry, count]) =>
        `| ${markdownCell(industry)} | ${count.medium} | ${count.low} | ${count.ready} | ${count.manual} |`,
    )
    .join("\n");

  return `# Non-Healthcare website verification — dry run

**Status:** Queue prepared; no websites fetched  
**Generated:** ${new Date().toISOString()}

## Scope

- Input: \`${relative(REPO_ROOT, inputPath)}\`
- Input rows: **${result.inputRowCount}**
- Medium rows selected: **${mediumCount}**
- Low rows selected: **${lowCount}**
- Queue rows written: **${result.queuedRowCount}**
- Limit applied: **${result.limitApplied === null ? "none" : result.limitApplied}**
- HTTP requests: **0**
- Database reads or writes: **0**
- Existing results were not changed or promoted.

## Queue status

| Status | Rows |
|---|---:|
${statusLines}

## Queue by industry

| Industry | Medium | Low | Ready for independent check | Manual review required |
|---|---:|---:|---:|---:|
${sectorLines}

## Verification policy for a later approved live pass

- Reuse only the evidence URL already present in the discovery CSV; low-confidence rows use that evidence host as a candidate, not as an accepted official website.
- Check the homepage and only same-origin About, Contact, or Careers pages discoverable from it. Do not follow cross-host redirects or crawl unrelated paths.
- Require independent identity corroboration: distinctive legal/trading name plus matching geography or a reliable official-register/cross-link signal. A repeated generic token alone cannot promote a result.
- Keep uncertain, blocked, or conflicting cases at their current confidence for review.
- Use the controlled public-site fetcher and its robots, DNS/SSRF, redirect, host-pacing, retry, and size limits if a live pass is approved.

Queue CSV: \`${relative(REPO_ROOT, outputPath)}\`
`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    limit: null,
    overwrite: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    if (
      argument === "--input" ||
      argument === "--output" ||
      argument === "--report" ||
      argument === "--limit"
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      index += 1;
      if (argument === "--input") options.input = value;
      else if (argument === "--output") options.output = value;
      else if (argument === "--report") options.report = value;
      else {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("--limit must be a positive integer");
        }
        options.limit = limit;
      }
      continue;
    }
    throw new Error(
      `Unknown argument: ${argument}. This dry-run command does not support website fetching.`,
    );
  }
  return options;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeOutputs(
  outputPath: string,
  reportPath: string,
  csv: string,
  report: string,
  overwrite: boolean,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });

  if (!overwrite) {
    const existing = [];
    if (await fileExists(outputPath)) existing.push(outputPath);
    if (await fileExists(reportPath)) existing.push(reportPath);
    if (existing.length > 0) {
      throw new Error(
        `Refusing to overwrite existing output: ${existing.join(", ")}. Use --overwrite to replace it.`,
      );
    }
  }

  await writeFile(outputPath, csv, {
    encoding: "utf8",
    flag: overwrite ? "w" : "wx",
  });
  await writeFile(reportPath, report, {
    encoding: "utf8",
    flag: overwrite ? "w" : "wx",
  });
}

function validateInputColumns(rows: readonly SourceRow[]): void {
  if (rows.length === 0) throw new Error("Verification input CSV is empty");
  for (const column of REQUIRED_INPUT_COLUMNS) {
    if (!Object.hasOwn(rows[0]!, column)) {
      throw new Error(`Verification input CSV is missing required column: ${column}`);
    }
  }
}

export async function runWebsiteVerificationDryRun(
  args = process.argv.slice(2),
): Promise<DryRunQueueResult> {
  const options = parseArgs(args);
  const inputPath = resolve(REPO_ROOT, options.input);
  const outputPath = resolve(REPO_ROOT, options.output);
  const reportPath = resolve(REPO_ROOT, options.report);
  const sourceRows = parseCsvObjects(await readFile(inputPath, "utf8"));
  validateInputColumns(sourceRows);

  const result = buildWebsiteVerificationQueue(sourceRows, options.limit);
  const csv = stringifyCsv(result.rows, OUTPUT_COLUMNS);
  const report = buildReport(result, inputPath, outputPath);
  await writeOutputs(
    outputPath,
    reportPath,
    csv,
    report,
    options.overwrite,
  );

  const readyCount = result.rows.filter(
    (row) => row.dry_run_status === "ready_for_independent_check",
  ).length;
  console.log(
    `Dry run complete: ${result.queuedRowCount} medium/low rows queued (${readyCount} ready for independent checks); 0 HTTP requests; 0 database reads/writes. Files: ${options.output}, ${options.report}.`,
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runWebsiteVerificationDryRun().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}