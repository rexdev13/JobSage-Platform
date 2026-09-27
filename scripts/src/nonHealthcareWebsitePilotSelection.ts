import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsvObjects, stringifyCsv } from "./sponsor-contact-discovery/csv";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_INPUT = "artifacts/non-healthcare-company-websites-all-sectors.csv";
const DEFAULT_JOURNAL =
  "artifacts/non-healthcare-company-websites-all-sectors-progress.jsonl";
const DEFAULT_OUTPUT =
  "artifacts/non-healthcare-company-websites-verification-pilot-100.csv";
const DEFAULT_REPORT =
  "artifacts/non-healthcare-company-websites-verification-pilot-100-report.md";
const DEFAULT_SIZE = 100;

const OUTPUT_COLUMNS = [
  "pilot_rank",
  "selection_group",
  "sponsor_licence_id",
  "organisation_name",
  "industry",
  "town_city",
  "county",
  "region",
  "current_confidence",
  "candidate_site_root",
  "candidate_domain",
  "evidence_url",
  "contact_email_domain",
  "contact_email_domain_match",
  "existing_website_careers_source_match",
  "source_provenance",
  "location_fields_present",
  "journal_history_found",
  "prior_blocking_failure_codes",
  "prior_failure_codes",
  "selection_reason",
  "verification_status",
] as const;

type SourceRow = Record<string, string>;
type FailureHistory = ReadonlyMap<string, readonly string[]>;
type SelectionGroup = "strong_medium" | "medium_fallback" | "low_fallback";

type Candidate = {
  source: SourceRow;
  sponsorId: string;
  confidence: "medium" | "low";
  candidateRoot: string;
  candidateDomain: string;
  evidenceUrl: string;
  emailDomain: string;
  emailDomainMatch: boolean;
  existingSourceMatch: boolean;
  locationFieldsPresent: number;
  journalHistoryFound: boolean;
  failureCodes: string[];
  blockingFailureCodes: string[];
  strongMedium: boolean;
};

type SelectedCandidate = Candidate & {
  selectionGroup: SelectionGroup;
};

type PilotCsvRow = Record<(typeof OUTPUT_COLUMNS)[number], string>;

export type WebsitePilotSelectionResult = {
  inputRowCount: number;
  mediumInputCount: number;
  lowInputCount: number;
  validMediumCandidateCount: number;
  validLowCandidateCount: number;
  strongMediumCount: number;
  strongMediumDomainCount: number;
  selectedStrongMediumCount: number;
  selectedMediumFallbackCount: number;
  selectedLowCount: number;
  targetSize: number;
  selected: PilotCsvRow[];
};

type CliOptions = {
  input: string;
  journal: string;
  output: string;
  report: string;
  size: number;
  overwrite: boolean;
};

const BLOCKING_FAILURE = /robots|block|timeout|access_denied|rate_limited/i;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedHost(value: string): string {
  const raw = text(value);
  if (!raw) return "";
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes(".") ||
      parsed.hostname.includes("%") ||
      parsed.hostname.toLowerCase() === "localhost"
    ) {
      return "";
    }
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function safeUrl(value: string, rootOnly = false): string {
  const raw = text(value);
  if (!raw) return "";
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes(".") ||
      parsed.hostname.includes("%") ||
      parsed.hostname.toLowerCase() === "localhost"
    ) {
      return "";
    }
    parsed.search = "";
    parsed.hash = "";
    if (rootOnly) parsed.pathname = "/";
    return parsed.toString();
  } catch {
    return "";
  }
}

function emailDomain(email: string): string {
  const match = text(email).match(/^[^@\s]+@([^@\s]+)$/);
  return match ? normalizedHost(match[1]!) : "";
}

function parseSourceKinds(source: string): Set<string> {
  return new Set(text(source).split("+").map((part) => part.trim()).filter(Boolean));
}

function sourceMatch(row: SourceRow, candidateDomain: string): boolean {
  if (!candidateDomain) return false;
  const sourceKinds = parseSourceKinds(row.source);
  const websiteMatch =
    sourceKinds.has("existing_website") &&
    normalizedHost(row.existing_website ?? "") === candidateDomain;
  const careersMatch =
    sourceKinds.has("existing_careers_url_domain") &&
    normalizedHost(row.existing_careers_url ?? "") === candidateDomain;
  return websiteMatch || careersMatch;
}

export function parseWebsiteFailureHistory(journalText: string): Map<string, string[]> {
  const history = new Map<string, Set<string>>();
  const lines = journalText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    let entry: { sponsorKey?: unknown; failureCodes?: unknown };
    try {
      entry = JSON.parse(line) as { sponsorKey?: unknown; failureCodes?: unknown };
    } catch {
      throw new Error(`Invalid JSON in discovery journal at line ${index + 1}`);
    }
    const sponsorKey = text(entry.sponsorKey);
    const match = sponsorKey.match(/^id:(.+)$/);
    if (!match) continue;
    const codes = Array.isArray(entry.failureCodes)
      ? entry.failureCodes.filter((code): code is string => typeof code === "string")
      : [];
    const merged = history.get(match[1]!) ?? new Set<string>();
    for (const code of codes) merged.add(code);
    history.set(match[1]!, merged);
  }
  return new Map(
    [...history.entries()].map(([sponsorId, codes]) => [
      sponsorId,
      [...codes].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function buildCandidate(row: SourceRow, failureHistory: FailureHistory): Candidate | null {
  const confidence = text(row.website_confidence).toLowerCase();
  if (confidence !== "medium" && confidence !== "low") return null;

  const candidateRaw =
    confidence === "medium"
      ? text(row.official_website_url)
      : text(row.website_evidence_url);
  const candidateRoot = safeUrl(candidateRaw, true);
  const candidateDomain = normalizedHost(candidateRaw);
  if (!candidateRoot || !candidateDomain) return null;

  const sponsorId = text(row.sponsor_licence_id);
  const journalHistoryFound = failureHistory.has(sponsorId);
  const failureCodes = [...(failureHistory.get(sponsorId) ?? [])];
  const blockingFailureCodes = failureCodes.filter((code) => BLOCKING_FAILURE.test(code));
  const contactDomain = emailDomain(row.existing_contact_email ?? "");
  const emailDomainMatch = Boolean(contactDomain && contactDomain === candidateDomain);
  const hasExistingSourceMatch = sourceMatch(row, candidateDomain);
  const locationFieldsPresent = [
    row.town_city,
    row.county,
    row.region,
  ].filter((value) => Boolean(text(value))).length;
  const noPriorBlockingError =
    journalHistoryFound && blockingFailureCodes.length === 0;
  const strongMedium =
    confidence === "medium" &&
    emailDomainMatch &&
    hasExistingSourceMatch &&
    locationFieldsPresent > 0 &&
    noPriorBlockingError;

  return {
    source: row,
    sponsorId,
    confidence,
    candidateRoot,
    candidateDomain,
    evidenceUrl: safeUrl(row.website_evidence_url ?? ""),
    emailDomain: contactDomain,
    emailDomainMatch,
    existingSourceMatch: hasExistingSourceMatch,
    locationFieldsPresent,
    journalHistoryFound,
    failureCodes,
    blockingFailureCodes,
    strongMedium,
  };
}

function comparePriority(left: Candidate, right: Candidate): number {
  const confidenceOrder = (left.confidence === "medium" ? 0 : 1) -
    (right.confidence === "medium" ? 0 : 1);
  if (confidenceOrder !== 0) return confidenceOrder;

  return (
    Number(right.emailDomainMatch) - Number(left.emailDomainMatch) ||
    Number(right.existingSourceMatch) - Number(left.existingSourceMatch) ||
    right.locationFieldsPresent - left.locationFieldsPresent ||
    Number(right.blockingFailureCodes.length === 0 && right.journalHistoryFound) -
      Number(left.blockingFailureCodes.length === 0 && left.journalHistoryFound) ||
    left.candidateDomain.localeCompare(right.candidateDomain) ||
    left.sponsorId.localeCompare(right.sponsorId)
  );
}

function selectWithDomainDiversity(
  candidates: readonly Candidate[],
  limit: number,
  selectedDomains: Set<string>,
): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.candidateDomain) ?? [];
    group.push(candidate);
    groups.set(candidate.candidateDomain, group);
  }
  for (const group of groups.values()) group.sort(comparePriority);

  const orderedGroups = [...groups.entries()].sort(([leftDomain, left], [rightDomain, right]) => {
    const priority = comparePriority(left[0]!, right[0]!);
    return priority || leftDomain.localeCompare(rightDomain);
  });
  const selected: Candidate[] = [];
  const selectedIds = new Set<string>();
  const cursors = new Map<string, number>();

  const novelDomainRound = orderedGroups
    .filter(([domain]) => !selectedDomains.has(domain))
    .map(([domain, group]) => ({ domain, candidate: group[0]! }))
    .sort((left, right) => {
      const priority = comparePriority(left.candidate, right.candidate);
      return priority || left.domain.localeCompare(right.domain);
    });

  for (const item of novelDomainRound) {
    if (selected.length >= limit) break;
    selected.push(item.candidate);
    selectedIds.add(item.candidate.sponsorId);
    selectedDomains.add(item.domain);
    cursors.set(item.domain, 1);
  }

  while (selected.length < limit) {
    const nextRound = orderedGroups
      .map(([domain, group]) => ({
        domain,
        candidate: group[cursors.get(domain) ?? 0],
      }))
      .filter(
        (item): item is { domain: string; candidate: Candidate } =>
          Boolean(item.candidate) && !selectedIds.has(item.candidate.sponsorId),
      )
      .sort((left, right) => {
        const priority = comparePriority(left.candidate, right.candidate);
        return priority || left.domain.localeCompare(right.domain);
      });
    if (nextRound.length === 0) break;
    for (const item of nextRound) {
      if (selected.length >= limit) break;
      selected.push(item.candidate);
      selectedIds.add(item.candidate.sponsorId);
      selectedDomains.add(item.domain);
      cursors.set(item.domain, (cursors.get(item.domain) ?? 0) + 1);
    }
  }
  return selected;
}

function selectionReason(candidate: Candidate, group: SelectionGroup): string {
  const reasons = [
    candidate.confidence,
    candidate.emailDomainMatch ? "candidate domain matches contact-email domain" : "",
    candidate.existingSourceMatch ? "existing website/careers provenance" : "",
    candidate.locationFieldsPresent
      ? `${candidate.locationFieldsPresent} location field(s) available`
      : "no location fields available",
    candidate.journalHistoryFound
      ? candidate.blockingFailureCodes.length === 0
        ? "no prior robots/block/timeout errors"
        : `prior blocking errors: ${candidate.blockingFailureCodes.join(";")}`
      : "prior failure history unavailable",
    `selection group: ${group}`,
  ];
  return reasons.filter(Boolean).join("; ");
}

function toPilotRow(
  candidate: Candidate,
  rank: number,
  selectionGroup: SelectionGroup,
): PilotCsvRow {
  const row = candidate.source;
  return {
    pilot_rank: String(rank),
    selection_group: selectionGroup,
    sponsor_licence_id: candidate.sponsorId,
    organisation_name: text(row.organisation_name),
    industry: text(row.industry),
    town_city: text(row.town_city),
    county: text(row.county),
    region: text(row.region),
    current_confidence: candidate.confidence,
    candidate_site_root: candidate.candidateRoot,
    candidate_domain: candidate.candidateDomain,
    evidence_url: candidate.evidenceUrl,
    contact_email_domain: candidate.emailDomain,
    contact_email_domain_match: String(candidate.emailDomainMatch),
    existing_website_careers_source_match: String(candidate.existingSourceMatch),
    source_provenance: text(row.source),
    location_fields_present: String(candidate.locationFieldsPresent),
    journal_history_found: String(candidate.journalHistoryFound),
    prior_blocking_failure_codes: candidate.blockingFailureCodes.join(";"),
    prior_failure_codes: candidate.failureCodes.join(";"),
    selection_reason: selectionReason(candidate, selectionGroup),
    verification_status: "selected_for_pilot_not_yet_rechecked",
  };
}

export function buildWebsiteVerificationPilot(
  sourceRows: readonly SourceRow[],
  failureHistory: FailureHistory,
  targetSize = DEFAULT_SIZE,
): WebsitePilotSelectionResult {
  if (!Number.isInteger(targetSize) || targetSize < 1) {
    throw new Error("Pilot size must be a positive integer");
  }
  const mediumInputCount = sourceRows.filter(
    (row) => text(row.website_confidence).toLowerCase() === "medium",
  ).length;
  const lowInputCount = sourceRows.filter(
    (row) => text(row.website_confidence).toLowerCase() === "low",
  ).length;
  const candidates = sourceRows
    .map((row) => buildCandidate(row, failureHistory))
    .filter((candidate): candidate is Candidate => candidate !== null);
  const medium = candidates.filter((candidate) => candidate.confidence === "medium");
  const low = candidates.filter((candidate) => candidate.confidence === "low");
  const strongMedium = medium.filter((candidate) => candidate.strongMedium);
  const mediumFallback = medium.filter((candidate) => !candidate.strongMedium);
  const strongMediumDomainCount = new Set(
    strongMedium.map((candidate) => candidate.candidateDomain),
  ).size;

  const selectedDomains = new Set<string>();
  const selected: SelectedCandidate[] = [];
  const addSelected = (items: Candidate[], group: SelectionGroup) => {
    const remaining = targetSize - selected.length;
    if (remaining <= 0) return;
    for (const candidate of selectWithDomainDiversity(
      items,
      remaining,
      selectedDomains,
    )) {
      selected.push({ ...candidate, selectionGroup: group });
    }
  };

  addSelected(strongMedium, "strong_medium");
  addSelected(mediumFallback, "medium_fallback");
  if (strongMedium.length < targetSize && selected.length < targetSize) {
    addSelected(low, "low_fallback");
  }

  const selectedStrongMediumCount = selected.filter(
    (candidate) => candidate.selectionGroup === "strong_medium",
  ).length;
  const selectedMediumFallbackCount = selected.filter(
    (candidate) => candidate.selectionGroup === "medium_fallback",
  ).length;
  const selectedLowCount = selected.filter(
    (candidate) => candidate.selectionGroup === "low_fallback",
  ).length;

  return {
    inputRowCount: sourceRows.length,
    mediumInputCount,
    lowInputCount,
    validMediumCandidateCount: medium.length,
    validLowCandidateCount: low.length,
    strongMediumCount: strongMedium.length,
    strongMediumDomainCount,
    selectedStrongMediumCount,
    selectedMediumFallbackCount,
    selectedLowCount,
    targetSize,
    selected: selected.map((candidate, index) =>
      toPilotRow(candidate, index + 1, candidate.selectionGroup),
    ),
  };
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function displayIndustry(value: string): string {
  return value || "(blank industry)";
}

function buildReport(
  result: WebsitePilotSelectionResult,
  inputPath: string,
  journalPath: string,
  outputPath: string,
): string {
  const byIndustry = new Map<
    string,
    { medium: number; low: number; strong: number; fallback: number }
  >();
  const uniqueDomains = new Set<string>();
  const domainCounts = new Map<string, number>();
  const locationCounts = new Map<number, number>();
  for (const row of result.selected) {
    const industry = displayIndustry(row.industry);
    const count = byIndustry.get(industry) ?? {
      medium: 0,
      low: 0,
      strong: 0,
      fallback: 0,
    };
    if (row.current_confidence === "medium") count.medium += 1;
    else count.low += 1;
    if (row.selection_group === "strong_medium") count.strong += 1;
    else count.fallback += 1;
    byIndustry.set(industry, count);
    uniqueDomains.add(row.candidate_domain);
    domainCounts.set(
      row.candidate_domain,
      (domainCounts.get(row.candidate_domain) ?? 0) + 1,
    );
    const locationCount = Number(row.location_fields_present);
    locationCounts.set(locationCount, (locationCounts.get(locationCount) ?? 0) + 1);
  }

  const sectorLines = [...byIndustry.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([industry, count]) =>
        `| ${markdownCell(industry)} | ${count.medium} | ${count.low} | ${count.strong} | ${count.fallback} |`,
    )
    .join("\n");
  const locationLines = [...locationCounts.entries()]
    .sort(([left], [right]) => right - left)
    .map(([fields, count]) => `| ${fields} | ${count} |`)
    .join("\n");
  const maxRowsPerDomain = Math.max(0, ...domainCounts.values());
  const lowHandling =
    result.selectedLowCount > 0
      ? `Included **${result.selectedLowCount} low-confidence** fallback candidates, reported separately in the CSV and sector table, because only ${result.strongMediumCount} strong medium candidates were available.`
      : `Included **0 low-confidence candidates** because ${result.strongMediumCount} strong medium candidates were available.`;

  return `# Website verification pilot selection — local only

**Status:** Selection complete; no websites fetched  
**Generated:** ${new Date().toISOString()}

## Selection summary

- Input rows: **${result.inputRowCount}**
- Medium-confidence rows in input: **${result.mediumInputCount}**
- Low-confidence rows in input: **${result.lowInputCount}**
- Strong medium candidates: **${result.strongMediumCount}** across **${result.strongMediumDomainCount}** unique domains
- Pilot target: **${result.targetSize}**
- Selected: **${result.selected.length}** (${result.selectedStrongMediumCount} strong medium, ${result.selectedMediumFallbackCount} other medium, ${result.selectedLowCount} low)
- Selected unique domains: **${uniqueDomains.size}**
- Maximum selected rows per domain: **${maxRowsPerDomain}**
- HTTP/AI/search requests: **0**
- Database reads/writes: **0**

${lowHandling}

## Strong medium definition

A strong medium must satisfy all of the following:

1. Current confidence is medium.
2. Candidate website domain exactly matches the existing contact-email domain (ignoring leading \`www\`).
3. The discovery provenance identifies \`existing_website\` or \`existing_careers_url_domain\`, and that source URL's domain matches the candidate.
4. At least one of town/city, county, or region is present.
5. The discovery journal exists for the sponsor and contains no prior robots, blocking, timeout, access-denied, or rate-limited failure code.

## Deterministic ranking and domain diversity

- Strong medium candidates are selected before any other candidates.
- Within the priority order, more populated location fields rank first.
- The selection takes one candidate per normalized domain before taking a second from any domain; ties use domain and sponsor ID for stable ordering.
- If fewer than the target number of strong mediums exist, other medium candidates fill remaining places before low-confidence candidates. Low-confidence rows are only eligible when the strong-medium pool is below the target, and are reported separately.

## Selected rows by industry

| Industry | Medium | Low | Strong medium | Fallback |
|---|---:|---:|---:|---:|
${sectorLines}

## Location completeness in selected pilot

| Populated location fields | Candidates |
|---:|---:|
${locationLines}

## Inputs and output

- Discovery CSV: \`${relative(REPO_ROOT, inputPath)}\`
- Discovery journal: \`${relative(REPO_ROOT, journalPath)}\`
- Pilot CSV: \`${relative(REPO_ROOT, outputPath)}\`

This is a selection list only. \`selected_for_pilot_not_yet_rechecked\` does not mean a candidate has been verified again or promoted.
`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    input: DEFAULT_INPUT,
    journal: DEFAULT_JOURNAL,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    size: DEFAULT_SIZE,
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
      argument === "--journal" ||
      argument === "--output" ||
      argument === "--report" ||
      argument === "--size"
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      index += 1;
      if (argument === "--input") options.input = value;
      else if (argument === "--journal") options.journal = value;
      else if (argument === "--output") options.output = value;
      else if (argument === "--report") options.report = value;
      else {
        const size = Number(value);
        if (!Number.isInteger(size) || size < 1) {
          throw new Error("--size must be a positive integer");
        }
        options.size = size;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
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

export async function runWebsitePilotSelection(
  args = process.argv.slice(2),
): Promise<WebsitePilotSelectionResult> {
  const options = parseArgs(args);
  const inputPath = resolve(REPO_ROOT, options.input);
  const journalPath = resolve(REPO_ROOT, options.journal);
  const outputPath = resolve(REPO_ROOT, options.output);
  const reportPath = resolve(REPO_ROOT, options.report);
  const [inputCsv, journalText] = await Promise.all([
    readFile(inputPath, "utf8"),
    readFile(journalPath, "utf8"),
  ]);
  const rows = parseCsvObjects(inputCsv);
  if (rows.length === 0) throw new Error("Pilot input CSV is empty");
  const failureHistory = parseWebsiteFailureHistory(journalText);
  const result = buildWebsiteVerificationPilot(rows, failureHistory, options.size);
  await writeOutputs(
    outputPath,
    reportPath,
    stringifyCsv(result.selected, OUTPUT_COLUMNS),
    buildReport(result, inputPath, journalPath, outputPath),
    options.overwrite,
  );

  console.log(
    `Pilot selection complete: ${result.selected.length}/${result.targetSize} selected; ${result.strongMediumCount} strong medium candidates across ${result.strongMediumDomainCount} domains; ${result.selectedLowCount} low-confidence candidates; 0 network/database requests. Files: ${options.output}, ${options.report}.`,
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runWebsitePilotSelection().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}