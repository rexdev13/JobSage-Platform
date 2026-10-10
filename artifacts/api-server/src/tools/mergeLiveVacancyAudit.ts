import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { parse } from "csv-parse/sync";

type Row = Record<string, string>;
type SponsorTown = { town: string; normalizedTown: string };

type MergeOptions = {
  inputFiles: string[];
  inputDirectories: string[];
  sendCvFiles: string[];
  sendCvDirectories: string[];
  companiesFile: string;
  outputDir: string;
  help: boolean;
};

const EMPLOYER_ATS_SOURCES = new Set([
  "algolia", "ashby", "bamboohr", "greenhouse", "lever", "oracle-cloud",
  "pinpoint", "recruitee", "smartrecruiters", "successfactors", "taleo",
  "teamtailor", "tribepad", "workable", "workday",
]);

function applicationModeFor(row: Row): "company_website" | "job_board" {
  if (row.application_mode === "company_website") return "company_website";
  return EMPLOYER_ATS_SOURCES.has((row.source ?? "").trim().toLowerCase())
    ? "company_website"
    : "job_board";
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isIP(hostname) ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|source|ref|referrer|tracking|trk)$/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function normaliseSponsorName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normaliseTown(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UK_LOCATION = /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|great britain|gb|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|cardiff|belfast|newcastle|nottingham|leicester|southampton|oxford|cambridge|reading|coventry|aberdeen)\b/i;
const NON_UK_LOCATION = /\b(united states|u\.s\.a?\.?|usa|canada|australia|new zealand|ireland|india|singapore|united arab emirates|uae|south africa|germany|france|spain|portugal|netherlands|switzerland|belgium|italy|poland|sweden|norway|denmark|finland|austria|japan|china|hong kong|brazil|mexico|argentina|kenya|nigeria|ghana|pakistan|bangladesh|malaysia|philippines|indonesia|turkey|israel|ukraine|russia|egypt|saudi arabia|qatar|ontario|quebec|british columbia|california|texas|new york|new jersey|massachusetts|queensland|victoria|new south wales)\b/i;

function ukLocationBlockReason(location: string, sponsorTown: string): string {
  const value = location.trim();
  if (!value) return "Vacancy location is missing.";
  if (NON_UK_LOCATION.test(value)) return "Vacancy location indicates a non-UK country or region.";
  const locationKey = ` ${normaliseTown(value)} `;
  const townKey = normaliseTown(sponsorTown);
  const sponsorTownMatches = Boolean(townKey && locationKey.includes(` ${townKey} `));
  return UK_LOCATION.test(value) || sponsorTownMatches
    ? ""
    : "Vacancy location is not verified as UK.";
}

function parseOptions(argv: readonly string[]): MergeOptions {
  const options: MergeOptions = {
    inputFiles: [],
    inputDirectories: [],
    sendCvFiles: [],
    sendCvDirectories: [],
    companiesFile: "",
    outputDir: path.join(process.cwd(), "output", "live-coverage-audit", "combined"),
    help: false,
  };
  const valueOptions = new Set([
    "--input",
    "--input-dir",
    "--send-cv",
    "--send-cv-dir",
    "--companies-file",
    "--output-dir",
  ]);
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]!;
    if (option === "--help" || option === "-h") {
      options.help = true;
      continue;
    }
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown option "${option}". Use --help for usage.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    index++;
    if (option === "--input") options.inputFiles.push(value);
    else if (option === "--input-dir") options.inputDirectories.push(value);
    else if (option === "--send-cv") options.sendCvFiles.push(value);
    else if (option === "--send-cv-dir") options.sendCvDirectories.push(value);
    else if (option === "--companies-file") options.companiesFile = value;
    else options.outputDir = value;
  }
  return options;
}

function usage(): string {
  return [
    "Usage: mergeLiveVacancyAudit.ts --companies-file <fresh-companies.json> [inputs] [options]",
    "  --input <vacancies.csv>       Add a vacancy CSV; repeat for each source",
    "  --input-dir <directory>       Add directory/vacancies.csv; repeat as needed",
    "  --send-cv <routes.csv>        Add verified Send CV routes; repeat as needed",
    "  --send-cv-dir <directory>     Add directory/send-cv-routes.csv",
    "  --output-dir <directory>      Write reports here",
  ].join("\n");
}

function loadSponsorTowns(file: string): Map<string, SponsorTown[]> {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("--companies-file must contain a JSON array of current sponsor records.");
  }
  const byName = new Map<string, Map<string, SponsorTown>>();
  for (const value of parsed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const company = value as Record<string, unknown>;
    const name = typeof company.name === "string" ? company.name.trim() : "";
    const town = typeof company.town === "string" ? company.town.trim() : "";
    const nameKey = normaliseSponsorName(name);
    if (!nameKey) continue;
    const townKey = normaliseTown(town);
    const towns = byName.get(nameKey) ?? new Map<string, SponsorTown>();
    if (!towns.has(townKey)) towns.set(townKey, { town, normalizedTown: townKey });
    byName.set(nameKey, towns);
  }
  return new Map([...byName].map(([name, towns]) => [name, [...towns.values()]]));
}

function resolveSponsorTown(
  row: Row,
  sponsorTownsByName: ReadonlyMap<string, readonly SponsorTown[]>,
): { eligible: boolean; town: string; reason: string } {
  const sponsorName = (row.sponsor_name ?? "").trim();
  const nameKey = normaliseSponsorName(sponsorName);
  const candidates = nameKey ? sponsorTownsByName.get(nameKey) ?? [] : [];
  if (candidates.length === 0) {
    return {
      eligible: false,
      town: "",
      reason: "Sponsor name does not resolve to the current register.",
    };
  }

  const status = (row.sponsor_match_status ?? "").trim();
  const reviewedTown = normaliseTown(row.sponsor_town ?? "");
  if (status === "exact-name-town-website-confirmed") {
    const reviewed = candidates.find((candidate) => candidate.normalizedTown === reviewedTown);
    return reviewed
      ? { eligible: true, town: reviewed.town, reason: "" }
      : {
          eligible: false,
          town: "",
          reason: "Reviewed website identity does not resolve to the recorded register town.",
        };
  }

  if (candidates.length === 1) {
    return { eligible: true, town: candidates[0]!.town, reason: "" };
  }

  const locationKey = normaliseTown(row.location ?? "");
  const locationMatches = candidates.filter((candidate) => candidate.normalizedTown
    && ` ${locationKey} `.includes(` ${candidate.normalizedTown} `));
  if (locationMatches.length === 1) {
    return { eligible: true, town: locationMatches[0]!.town, reason: "" };
  }
  return {
    eligible: false,
    town: "",
    reason: "Sponsor name maps to multiple register towns and the vacancy location does not resolve one.",
  };
}

function observationTimeForFile(file: string): string {
  const metricsFile = path.join(path.dirname(file), "metrics.json");
  if (!fs.existsSync(metricsFile)) return "";
  try {
    const metrics = JSON.parse(fs.readFileSync(metricsFile, "utf8")) as { generatedAt?: unknown };
    return typeof metrics.generatedAt === "string" ? metrics.generatedAt : "";
  } catch {
    return "";
  }
}

function freshnessBlockReason(row: Row, fallbackObservedAt: string, now: number): string {
  const status = (row.freshness_status ?? "").trim();
  if (status === "deep_link_dead") return "Role link was confirmed dead.";
  if (status === "deep_link_inconclusive") return "Role link liveness is inconclusive.";
  if (status !== "current_source_observation" && status !== "deep_link_live") {
    return `Unsupported freshness status: ${status || "missing"}.`;
  }
  const observedAt = row.observed_at || row.checked_at || row.checked_at_utc || fallbackObservedAt;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return "No source-observation timestamp was recorded.";
  if (observedMs > now + 5 * 60_000) return "Source-observation timestamp is in the future.";
  if (now - observedMs > 48 * 60 * 60_000) return "Source observation is older than 48 hours.";
  return "";
}

function isExpired(closesAt: string, now: number): boolean {
  const value = closesAt.trim();
  if (!value) return false;
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T23:59:59.999Z`)
    : Date.parse(value);
  return Number.isFinite(expiry) && expiry < now;
}

async function main(): Promise<void> {
  process.env.DATABASE_URL ||= "postgresql://no-write-audit:invalid@127.0.0.1:1/no-write-audit";
  process.env.DATABASE_READ_ONLY = "true";
  const { classifyVacancyCategoryWithEvidence } = await import("../lib/sponsorVacancyRoles");
  const { isLikelyEditorialTitle, isManualLabourTitle } = await import("../lib/vacancyTitlePolicy");
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.companiesFile) {
    throw new Error("--companies-file is required so ambiguous sponsor identities can be held safely.");
  }
  const inputFiles = [
    ...options.inputFiles.map((file) => path.resolve(file)),
    ...options.inputDirectories.map((directory) => path.join(path.resolve(directory), "vacancies.csv")),
  ];
  const sendCvFiles = [
    ...options.sendCvFiles.map((file) => path.resolve(file)),
    ...options.sendCvDirectories.map((directory) => path.join(path.resolve(directory), "send-cv-routes.csv")),
  ];
  if (inputFiles.length === 0) {
    throw new Error("Provide at least one --input or --input-dir; historical audit folders are never added implicitly.");
  }
  const companiesFile = path.resolve(options.companiesFile);
  const missingInputs = [...inputFiles, ...sendCvFiles, companiesFile].filter((file) => !fs.existsSync(file));
  if (missingInputs.length > 0) {
    throw new Error(`Missing audit input(s): ${missingInputs.join(", ")}`);
  }
  const sponsorTownsByName = loadSponsorTowns(companiesFile);
  const outputDir = path.resolve(options.outputDir);
  const rows: Row[] = [];
  const inputMetrics: Array<{ file: string; rows: number; generatedAt: string }> = [];
  for (const file of inputFiles) {
    const parsedRows = parse(fs.readFileSync(file, "utf8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as Row[];
    const fallbackObservedAt = observationTimeForFile(file);
    inputMetrics.push({ file, rows: parsedRows.length, generatedAt: fallbackObservedAt });
    rows.push(...parsedRows.map((row) => ({ ...row, __auditObservedAt: fallbackObservedAt })));
  }

  const acceptedIdentity = new Set([
    "exact-register-name",
    "exact-name-town-website-confirmed",
    "unique-normalised-register-name",
  ]);
  const merged = new Map<string, Row>();
  const canonicalKeys = new Map<string, string>();
  const externalIdKeys = new Map<string, string>();
  let canonicalUrlDuplicates = 0;
  let externalIdDuplicates = 0;
  const now = Date.now();
  for (const [index, raw] of rows.entries()) {
    const applyUrl = canonicalUrl(raw.apply_url ?? "");
    const title = (raw.title ?? "").trim();
    const source = (raw.source ?? "").trim();
    const classification = classifyVacancyCategoryWithEvidence(title, raw.description ?? null);
    const category = classification.category ?? "";
    const applicationMode = applicationModeFor(raw);
    const sponsorStatus = raw.sponsor_match_status ?? "";
    const sponsorTown = resolveSponsorTown(raw, sponsorTownsByName);
    const identityEligible = acceptedIdentity.has(sponsorStatus) && sponsorTown.eligible;
    const identityBlockReason = !acceptedIdentity.has(sponsorStatus)
      ? "Source sponsor-match status is not approved for automatic import."
      : sponsorTown.reason;
    const titlePolicyEligible = Boolean(title)
      && !isManualLabourTitle(title)
      && !isLikelyEditorialTitle(title);
    const location = (raw.location ?? "").trim();
    const locationBlockReason = ukLocationBlockReason(location, sponsorTown.town);
    const closesAt = (raw.closes_at ?? raw.closing_date ?? "").trim();
    const expired = isExpired(closesAt, now);
    const freshnessReason = freshnessBlockReason(raw, raw.__auditObservedAt ?? "", now);
    const roleLinkReason = applicationMode === "company_website" && (raw.freshness_status ?? "").trim() !== "deep_link_live"
      ? "Company-site role link was not independently confirmed live."
      : "";
    const sourceImportEligibilityPresent = Object.prototype.hasOwnProperty.call(raw, "import_eligible");
    const sourceImportEligibilityReason = sourceImportEligibilityPresent && (raw.import_eligible ?? "").trim() !== "true"
      ? "Source-specific employer or ATS validation did not pass."
      : "";
    const blockingReasons = [
      !applyUrl ? "Application URL is missing or not safe HTTPS." : "",
      !title ? "Vacancy title is missing." : "",
      !(raw.sponsor_name ?? "").trim() ? "Sponsor name is missing." : "",
      !source ? "Vacancy source is missing." : "",
      identityEligible ? "" : identityBlockReason,
      locationBlockReason,
      category ? "" : "Profession is unclassified.",
      titlePolicyEligible ? "" : "Title failed the vacancy title policy.",
      expired ? "Vacancy closing date has passed." : "",
      freshnessReason,
      roleLinkReason,
      sourceImportEligibilityReason,
    ].filter(Boolean);
    const guardedImportEligible = blockingReasons.length === 0;
    const outputApplyUrl = applyUrl ?? (raw.apply_url ?? "").trim();
    const externalId = (raw.external_id ?? "").trim();
    const externalKey = externalId
      ? [
          source.toLowerCase(),
          externalId,
          normaliseSponsorName(raw.sponsor_name ?? ""),
          normaliseTown(title),
        ].join("|")
      : "";
    const fallbackKey = [
      source.toLowerCase(),
      externalId,
      title.toLowerCase(),
      (raw.location ?? "").trim().toLowerCase(),
      String(index),
    ].join(":");
    const row: Row = {
      sponsor_name: raw.sponsor_name ?? "",
      sponsor_town: sponsorTown.town,
      sponsor_sector: raw.sponsor_sector || raw.sector || "",
      sponsor_industry: raw.sponsor_industry || raw.industry || "",
      vacancy_category: category,
      classification_confidence: classification.confidence,
      classification_reason: classification.reason,
      title,
      employer: raw.employer || raw.sponsor_name,
      location,
      apply_url: outputApplyUrl,
      canonical_url_valid: String(Boolean(applyUrl)),
      application_mode: applicationMode,
      source,
      external_id: externalId,
      observed_at: raw.observed_at || raw.checked_at || raw.checked_at_utc || raw.__auditObservedAt || "",
      closes_at: closesAt,
      sponsor_match_status: sponsorStatus,
      source_import_eligible: sourceImportEligibilityPresent ? raw.import_eligible : "",
      identity_import_eligible: String(identityEligible),
      identity_block_reason: identityBlockReason,
      title_policy_eligible: String(titlePolicyEligible),
      guarded_import_eligible: String(guardedImportEligible),
      sponsorship_status: raw.sponsorship_status || "unknown",
      freshness_status: raw.freshness_status ?? "",
      contact_email: raw.contact_email || raw.public_role_emails || "",
      contact_evidence_url: raw.contact_evidence_url || raw.contact_evidence_urls || "",
      send_cv_status: "not_verified",
      candidate_visibility_status: !identityEligible
        ? "blocked_identity_review"
        : !category
          ? "blocked_unclassified"
          : !titlePolicyEligible
            ? "blocked_title_policy"
            : expired || freshnessReason
              ? "blocked_stale_or_expired"
              : roleLinkReason
                ? "blocked_unverified_role_link"
              : sourceImportEligibilityReason
                ? "blocked_source_validation"
                : locationBlockReason
                  ? "blocked_non_uk_or_missing_location"
                  : !applyUrl
                    ? "blocked_invalid_application_url"
                    : guardedImportEligible
                      ? "eligible_after_import_and_persisted_liveness"
                      : "blocked_required_field",
      blocking_reason: blockingReasons.join("; "),
    };
    const canonicalDuplicateKey = applyUrl ? canonicalKeys.get(applyUrl) : undefined;
    const externalDuplicateKey = externalKey ? externalIdKeys.get(externalKey) : undefined;
    if (canonicalDuplicateKey) canonicalUrlDuplicates++;
    else if (externalDuplicateKey) externalIdDuplicates++;
    const dedupeKey = canonicalDuplicateKey
      ?? externalDuplicateKey
      ?? (applyUrl ? `url:${applyUrl}` : externalKey ? `id:${externalKey}` : `invalid:${fallbackKey}`);
    const previous = merged.get(dedupeKey);
    if (!previous || previous.guarded_import_eligible !== "true" && guardedImportEligible) {
      merged.set(dedupeKey, row);
    }
    if (applyUrl) canonicalKeys.set(applyUrl, dedupeKey);
    if (externalKey) externalIdKeys.set(externalKey, dedupeKey);
  }

  const output = [...merged.values()].sort((a, b) =>
    a.vacancy_category.localeCompare(b.vacancy_category) || a.sponsor_name.localeCompare(b.sponsor_name) || a.title.localeCompare(b.title),
  );
  const headers = [
    "sponsor_name", "sponsor_town", "sponsor_sector", "sponsor_industry", "vacancy_category",
    "classification_confidence", "classification_reason", "title",
    "employer", "location", "apply_url", "canonical_url_valid", "application_mode", "source", "external_id", "observed_at",
    "closes_at", "sponsor_match_status", "source_import_eligible", "identity_import_eligible", "identity_block_reason", "title_policy_eligible", "guarded_import_eligible",
    "sponsorship_status", "freshness_status", "contact_email", "contact_evidence_url", "send_cv_status",
    "candidate_visibility_status", "blocking_reason",
  ];
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "vacancies.csv"),
    [headers.join(","), ...output.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  const guardedOutput = output.filter((row) => row.guarded_import_eligible === "true");
  const reviewBlockedOutput = output.filter((row) => row.guarded_import_eligible !== "true");
  fs.writeFileSync(
    path.join(outputDir, "guarded-vacancies.csv"),
    [headers.join(","), ...guardedOutput.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(outputDir, "review-blocked-vacancies.csv"),
    [headers.join(","), ...reviewBlockedOutput.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  const sendCvRoutes = new Map<string, Row>();
  for (const file of sendCvFiles) {
    if (!fs.existsSync(file)) continue;
    for (const route of parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[]) {
      if (route.send_cv_status !== "verified_recruitment_route") continue;
      const key = `${route.sponsor_name.trim().toLowerCase()}|${route.recruitment_email.trim().toLowerCase()}`;
      sendCvRoutes.set(key, route);
    }
  }
  const sendCvOutput = [...sendCvRoutes.values()];
  const sendCvHeaders = [
    "sponsor_name", "sector", "industry", "town", "recruitment_email",
    "evidence_url", "verification_method", "send_cv_status", "checked_at",
  ];
  fs.writeFileSync(
    path.join(outputDir, "send-cv-routes.csv"),
    [sendCvHeaders.join(","), ...sendCvOutput.map((row) => sendCvHeaders.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  const countBy = (key: string, filter?: (row: Row) => boolean) => Object.fromEntries(
    [...new Set(output.filter(filter ?? (() => true)).map((row) => row[key] || "unknown"))]
      .sort()
      .map((value) => [value, output.filter((row) => (filter?.(row) ?? true) && (row[key] || "unknown") === value).length]),
  );
  const categories = [...new Set(output.map((row) => row.vacancy_category).filter(Boolean))].sort();
  const professionCoverage = Object.fromEntries(categories.map((category) => {
    const categoryRows = output.filter((row) => row.vacancy_category === category);
    const guarded = categoryRows.filter((row) => row.guarded_import_eligible === "true");
    const modes = Object.fromEntries([...new Set(guarded.map((row) => row.application_mode))]
      .sort().map((mode) => [mode, guarded.filter((row) => row.application_mode === mode).length]));
    const sources = Object.fromEntries([...new Set(guarded.map((row) => row.source || "unknown"))]
      .sort().map((source) => [source, guarded.filter((row) => (row.source || "unknown") === source).length]));
    return [category, {
      collected: categoryRows.length,
      guarded: guarded.length,
      blocked: categoryRows.length - guarded.length,
      coverageLevel: guarded.length >= 1_000 ? "strong" : guarded.length >= 100 ? "moderate" : guarded.length > 0 ? "thin" : "empty",
      modes,
      sources,
    }];
  }));
  const metrics = {
    generatedAt: new Date().toISOString(),
    mode: "local-no-write",
    companiesFile,
    inputFiles: inputMetrics,
    inputRows: rows.length,
    uniqueVacancies: output.length,
    duplicatesRemoved: rows.length - output.length,
    duplicateCanonicalUrlsRemoved: canonicalUrlDuplicates,
    duplicateSourceExternalIdsRemoved: externalIdDuplicates,
    identityImportEligible: output.filter((row) => row.identity_import_eligible === "true").length,
    guardedImportEligible: output.filter((row) => row.guarded_import_eligible === "true").length,
    blockedUnclassified: output.filter((row) => row.candidate_visibility_status === "blocked_unclassified").length,
    blockedIdentityReview: output.filter((row) => row.candidate_visibility_status === "blocked_identity_review").length,
    blockedTitlePolicy: output.filter((row) => row.candidate_visibility_status === "blocked_title_policy").length,
    blockedExpired: output.filter((row) => row.blocking_reason.includes("closing date")).length,
    blockedStaleOrUnverified: output.filter((row) =>
      row.blocking_reason.toLowerCase().includes("source-observation") ||
      row.blocking_reason.toLowerCase().includes("freshness status") ||
      row.blocking_reason.toLowerCase().includes("role link") ||
      row.blocking_reason.toLowerCase().includes("older than 48 hours"),
    ).length,
    blockedUnverifiedRoleLink: output.filter((row) =>
      row.blocking_reason.toLowerCase().includes("role link"),
    ).length,
    blockedSourceValidation: output.filter((row) =>
      row.blocking_reason.includes("Source-specific employer or ATS validation"),
    ).length,
    blockedInvalidApplicationUrl: output.filter((row) => row.canonical_url_valid !== "true").length,
    blockedNonUkOrMissingLocation: output.filter((row) =>
      row.blocking_reason.includes("Vacancy location"),
    ).length,
    blockedAmbiguousSponsorIdentity: output.filter((row) =>
      row.identity_block_reason.includes("multiple register towns"),
    ).length,
    blockedReasonCounts: Object.fromEntries(
      [...new Set(output.flatMap((row) => row.blocking_reason.split("; ").filter(Boolean)))]
        .sort()
        .map((reason) => [
          reason,
          output.filter((row) => row.blocking_reason.split("; ").includes(reason)).length,
        ]),
    ),
    currentlyCandidateVisible: 0,
    verifiedSendCv: sendCvOutput.length,
    byMode: countBy("application_mode"),
    bySource: countBy("source"),
    bySector: countBy("sponsor_sector"),
    guardedByMode: countBy("application_mode", (row) => row.guarded_import_eligible === "true"),
    guardedBySource: countBy("source", (row) => row.guarded_import_eligible === "true"),
    guardedBySector: countBy("sponsor_sector", (row) => row.guarded_import_eligible === "true"),
    guardedByCategory: countBy("vacancy_category", (row) => row.guarded_import_eligible === "true"),
    guardedByClassificationConfidence: countBy(
      "classification_confidence",
      (row) => row.guarded_import_eligible === "true",
    ),
    acceptedIdentityByStatus: countBy(
      "sponsor_match_status",
      (row) => row.identity_import_eligible === "true",
    ),
    blockedIdentityByStatus: countBy(
      "sponsor_match_status",
      (row) => row.identity_import_eligible !== "true",
    ),
    professionCoverage,
  };
  fs.writeFileSync(path.join(outputDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  const summary = [
    "# Fresh sponsor-vacancy audit merge",
    "",
    `Generated: ${metrics.generatedAt}`,
    `Mode: ${metrics.mode} (no production writes)`,
    `Current register: ${companiesFile}`,
    "",
    "## Counts",
    `- Input rows: ${metrics.inputRows}`,
    `- Unique vacancies retained: ${metrics.uniqueVacancies}`,
    `- Duplicates removed: ${metrics.duplicatesRemoved} (${metrics.duplicateCanonicalUrlsRemoved} canonical-URL; ${metrics.duplicateSourceExternalIdsRemoved} source external-ID)`,
    `- Guarded/import-eligible: ${metrics.guardedImportEligible}`,
    `- Review-blocked: ${reviewBlockedOutput.length}`,
    `- Verified Send CV routes: ${metrics.verifiedSendCv}`,
    `- Candidate-visible before production import: ${metrics.currentlyCandidateVisible}`,
    "",
    "## Source inputs",
    ...inputMetrics.map((input) => `- ${input.file}: ${input.rows} rows; observation run ${input.generatedAt || "not recorded"}`),
    "",
    "## Blocking reasons",
    ...Object.entries(metrics.blockedReasonCounts).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "See metrics.json, vacancies.csv, guarded-vacancies.csv, review-blocked-vacancies.csv, and send-cv-routes.csv for full details.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outputDir, "summary.md"), summary);
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
