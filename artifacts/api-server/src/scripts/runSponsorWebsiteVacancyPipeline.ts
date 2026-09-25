/**
 * Development-only CSV runner for reviewed sponsor websites and company-site vacancies.
 * It reuses runCompanySiteCheck, never sends applications, and never overwrites websites.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isIP } from "node:net";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runCompanySiteCheck, type CompanySiteCheckOutcome } from "../lib/companySiteScheduler";
import { parseDirectBoardMapping } from "../lib/directEmployerBoardConnectors";
import { verifyCompanySiteStoredLink } from "../lib/companySiteVerification";

type CsvRow = Record<string, string>;
type Candidate = {
  id: number;
  name: string;
  website: string;
  sector: string | null;
  careersUrl: string | null;
  decision: "approved" | "review_required" | "rejected";
  reason: string;
};
type SponsorState = {
  id: number | string;
  organisation_name: string;
  website: string | null;
  industry: string | null;
  careers_url: string | null;
  ats_provider: string | null;
  ats_board_id: string | null;
  ats_mapping_status: "verified" | "unverified" | "invalid" | null;
  ats_mapping_evidence_url: string | null;
  generic_checked_at: Date | string | null;
  ats_checked_at: Date | string | null;
  crawl_state: {
    queue: string[];
    visited: string[];
    sitemapQueued?: boolean;
    observedAdvertUrls?: string[];
    hadFailure?: boolean;
    directOffset?: number;
    careersUrl?: string | null;
    atsProvider?: string | null;
  } | null;
};

const BLOCKED_HOST_PARTS = [
  "indeed.", "reed.", "totaljobs.", "cv-library.", "linkedin.", "glassdoor.",
  "jooble.", "adzuna.", "findajob.dwp.gov.uk", "nhsjobs.", "jobs.nhs.uk",
];
const ALLOWED_LIMITS = new Set([12, 29, 100, 500, 1000]);

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    input: "",
    out: "sponsor-website-vacancy-pipeline",
    limit: 12,
    offset: 0,
    apply: false,
    acceptMedium: false,
    skipWebsiteFill: false,
    skipDiscovery: false,
    directFeedsOnly: false,
    expectedDbFingerprint: "",
    expectRepeat: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--input") config.input = args[++i] ?? "";
    else if (arg === "--out") config.out = args[++i] ?? config.out;
    else if (arg === "--limit") {
      const value = args[++i] ?? "";
      if (!/^\d+$/.test(value)) throw new Error("--limit must be one of 12, 29, 100, 500, or 1000.");
      config.limit = Number(value);
    } else if (arg === "--offset") {
      const value = args[++i] ?? "";
      if (!/^\d+$/.test(value)) throw new Error("--offset must be a non-negative integer.");
      config.offset = Number(value);
    } else if (arg === "--apply") config.apply = true;
    else if (arg === "--expected-db-fingerprint") config.expectedDbFingerprint = args[++i] ?? "";
    else if (arg === "--expect-repeat") config.expectRepeat = true;
    else if (arg === "--accept-medium") config.acceptMedium = true;
    else if (arg === "--skip-website-fill") config.skipWebsiteFill = true;
    else if (arg === "--skip-discovery") config.skipDiscovery = true;
    else if (arg === "--direct-feeds-only") config.directFeedsOnly = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!config.input) config.input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!config.input) throw new Error("Supply --input reviewed-website-candidates.csv.");
  if (!ALLOWED_LIMITS.has(config.limit)) {
    throw new Error("--limit must be exactly 12, 29, 100, 500, or 1000.");
  }
  if (!Number.isSafeInteger(config.offset) || config.offset < 0 || config.offset > 1000) {
    throw new Error("--offset must be an integer between 0 and 1000.");
  }
  if (config.skipWebsiteFill && config.skipDiscovery) {
    throw new Error("At least one stage must run; remove one of --skip-website-fill or --skip-discovery.");
  }
  if (config.directFeedsOnly && config.skipDiscovery) {
    throw new Error("--direct-feeds-only requires discovery to run.");
  }
  if (config.expectRepeat && (!config.apply || !config.directFeedsOnly)) {
    throw new Error("--expect-repeat requires --apply and --direct-feeds-only.");
  }
  if (config.apply && !/^[a-f0-9]{32}$/i.test(config.expectedDbFingerprint)) {
    throw new Error("--apply requires a development-only --expected-db-fingerprint.");
  }
  config.out = resolve(config.out);
  return config;
}

function parseCsv(text: string): CsvRow[] {
  const values: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((part) => part.trim())) values.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("CSV has an unclosed quote.");
  if (field || row.length) {
    row.push(field);
    if (row.some((part) => part.trim())) values.push(row);
  }
  const headers = (values.shift() ?? []).map((value) => value.trim());
  if (!headers.length) throw new Error("CSV has no header row.");
  return values.map((cells) => Object.fromEntries(headers.map((key, index) => [key, cells[index] ?? ""])));
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(rows: readonly Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n");
}

function validHttpsUrl(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.port || isIP(host) !== 0 ||
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    ) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function blocked(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return BLOCKED_HOST_PARTS.some((part) => host.includes(part));
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

function candidateFromRow(row: CsvRow, acceptMedium: boolean): Candidate | null {
  const idValue = (row.sponsor_licence_id ?? row.id ?? "").trim();
  const id = /^\d+$/.test(idValue) ? Number(idValue) : NaN;
  const name = (row.organisation_name ?? row.company_name ?? row.companyName ?? "").trim();
  if (!Number.isSafeInteger(id) || id <= 0 || !name) return null;

  const website = validHttpsUrl(row.website_url ?? row.candidate_website ?? row.website ?? row.existing_website);
  const explicit = (row.decision ?? row.promotion_decision ?? row.approved ?? "").trim().toLowerCase();
  const confidence = (row.website_confidence ?? row.original_confidence ?? row.confidence ?? "").trim().toLowerCase();
  let decision: Candidate["decision"] = "review_required";
  let reason = "website candidate is not approved";
  if (!website) {
    decision = "rejected";
    reason = "missing or invalid HTTPS website";
  } else if (blocked(website)) {
    decision = "rejected";
    reason = "blocked job-board or aggregator website";
  } else if (["reject", "rejected"].includes(explicit)) {
    decision = "rejected";
    reason = "explicitly rejected in CSV";
  } else if (["review_required", "review"].includes(explicit)) {
    reason = "CSV row requires review";
  } else if (["approve", "approved", "yes", "true", "auto_promote"].includes(explicit)) {
    decision = "approved";
    reason = "explicitly approved CSV row";
  } else if (confidence === "high") {
    decision = "approved";
    reason = "high-confidence website";
  } else if (acceptMedium && confidence === "medium") {
    decision = "approved";
    reason = "medium-confidence accepted by operator flag";
  } else {
    reason = confidence ? `${confidence}-confidence requires review` : "no approval or confidence supplied";
  }
  return {
    id,
    name,
    website: website ?? "",
    sector: (row.sector ?? row.industry ?? "").trim() || null,
    careersUrl: validHttpsUrl(row.careers_url ?? row.existing_careers_url),
    decision,
    reason,
  };
}

function duplicateRejected(candidates: Candidate[]): { safe: Candidate[]; rejected: Record<string, unknown>[] } {
  const ids = new Map<number, Candidate[]>();
  const names = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    ids.set(candidate.id, [...(ids.get(candidate.id) ?? []), candidate]);
    names.set(normalizedName(candidate.name), [...(names.get(normalizedName(candidate.name)) ?? []), candidate]);
  }
  const rejected: Record<string, unknown>[] = [];
  const safe: Candidate[] = [];
  for (const candidate of candidates) {
    const sameId = ids.get(candidate.id) ?? [];
    const sameName = names.get(normalizedName(candidate.name)) ?? [];
    const conflicting = sameId.length > 1 || sameName.length > 1;
    if (conflicting) rejected.push({ ...candidate, decision: "rejected", reason: "duplicate sponsor ID or organisation-name conflict in CSV" });
    else if (candidate.decision === "approved") safe.push(candidate);
  }
  return { safe, rejected };
}

async function getSponsor(candidate: Candidate): Promise<SponsorState[]> {
  const result = await db.execute<SponsorState>(sql`
    SELECT sl.id, sl.organisation_name, sl.website, sl.industry,
           cs.careers_url, cs.ats_provider, cs.ats_board_id,
           cs.ats_mapping_status, cs.ats_mapping_evidence_url,
           cs.generic_checked_at, cs.ats_checked_at, cs.crawl_state
    FROM sponsor_licences sl
    LEFT JOIN sponsor_licence_company_site_checks cs
      ON cs.organisation_name = sl.organisation_name
    WHERE sl.id = ${candidate.id}
       OR lower(btrim(sl.organisation_name)) = lower(btrim(${candidate.name}))
  `);
  return result.rows;
}

async function fillWebsite(candidate: Candidate): Promise<"filled" | "existing" | "conflict" | "missing"> {
  const result = await db.execute<{ website: string | null }>(sql`
    UPDATE sponsor_licences
    SET website = ${candidate.website}
    WHERE id = ${candidate.id}
      AND lower(btrim(organisation_name)) = lower(btrim(${candidate.name}))
      AND NULLIF(btrim(website), '') IS NULL
    RETURNING website
  `);
  if (result.rows.length > 1) throw new Error(`Fatal DB write: multiple sponsor rows updated for ${candidate.id}.`);
  if (result.rows.length === 1) return "filled";
  const current = await getSponsor(candidate);
  if (current.length !== 1) return "missing";
  const existing = current[0].website?.trim();
  return existing ? (sameSite(existing, candidate.website) ? "existing" : "conflict") : "missing";
}

function siteKey(raw: string): string {
  const url = new URL(raw);
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function sameSite(left: string, right: string): boolean {
  try {
    return siteKey(left) === siteKey(right);
  } catch {
    return false;
  }
}

function hasApprovedDirectSource(sponsor: SponsorState): boolean {
  if (sponsor.ats_mapping_status !== "verified" || !sponsor.careers_url?.trim()) return false;
  if (!sponsor.ats_provider?.trim()) return true;
  const mapping = parseDirectBoardMapping(sponsor.ats_provider, sponsor.careers_url);
  return Boolean(
    mapping &&
    (!sponsor.ats_board_id || mapping.boardId.toLowerCase() === sponsor.ats_board_id.trim().toLowerCase()),
  );
}

async function getAdvertLinks(candidate: Candidate) {
  const result = await db.execute<{
    id: number | string;
    title: string;
    url: string;
    application_url: string | null;
    liveness: string;
  }>(sql`
    SELECT id, title, url, application_url, liveness
    FROM sponsor_licence_vacancies
    WHERE source_type = 'company_site'
      AND lower(btrim(organisation_name)) = lower(btrim(${candidate.name}))
    ORDER BY id
  `);
  return result.rows;
}

async function getRecentlyDiscovered(candidate: Candidate, since: Date) {
  const result = await db.execute<{
    id: number | string;
    title: string;
    url: string;
    application_url: string | null;
  }>(sql`
    SELECT id, title, url, application_url
    FROM sponsor_licence_vacancies
    WHERE source_type = 'company_site'
      AND lower(btrim(organisation_name)) = lower(btrim(${candidate.name}))
      AND last_discovered_at >= ${since}
    ORDER BY id
  `);
  return result.rows;
}

type CandidateVisibleVacancyRow = {
  organisation_name: string;
  id: number | string;
  title: string;
  url: string;
  application_url: string | null;
  source_type: string;
  evidence_kind: string | null;
  last_verified_at: Date | string | null;
  visible_count: number | string;
  sample_rank: number | string;
};

async function getCandidateVisibility(candidates: Candidate[]) {
  const names = [...new Set(candidates.map((candidate) => normalizedName(candidate.name)))];
  const result = await db.execute<CandidateVisibleVacancyRow>(sql`
    WITH candidate_visible AS (
      SELECT
        lower(btrim(v.organisation_name)) AS organisation_name,
        v.id,
        v.title,
        v.url,
        v.application_url,
        v.source_type,
        v.company_vacancy_evidence->>'kind' AS evidence_kind,
        v.last_verified_at,
        count(*) OVER (PARTITION BY lower(btrim(v.organisation_name))) AS visible_count,
        row_number() OVER (
          PARTITION BY lower(btrim(v.organisation_name))
          ORDER BY v.last_verified_at DESC, v.id DESC
        ) AS sample_rank
      FROM sponsor_licence_vacancies v
      WHERE lower(btrim(v.organisation_name)) = ANY(${sql.param(names)}::text[])
        AND v.liveness = 'live'
        AND v.last_verified_at >= now() - interval '48 hours'
        AND v.source_type IS NOT NULL
        AND v.url IS NOT NULL
        AND (v.closes_at IS NULL OR v.closes_at >= now())
        AND (v.expires_at IS NULL OR v.expires_at >= now())
        AND v.source_missing_since IS NULL
        AND (
          v.closed_reason IS NULL
          OR v.closed_reason !~* '(closed|filled|no longer accepting|closing date has passed)'
        )
        AND (
          v.source_type <> 'company_site'
          OR v.company_vacancy_evidence IS NOT NULL
          OR v.company_evidence_legacy_until >= now()
        )
    )
    SELECT *
    FROM candidate_visible
    WHERE sample_rank <= 3
    ORDER BY organisation_name, sample_rank
  `);
  const byName = new Map<string, CandidateVisibleVacancyRow[]>();
  for (const row of result.rows) {
    const key = normalizedName(row.organisation_name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  return candidates.map((candidate) => {
    const visibleRows = byName.get(normalizedName(candidate.name)) ?? [];
    const first = visibleRows[0];
    return {
      sponsorLicenceId: candidate.id,
      organisationName: candidate.name,
      visibleVacancyCount: Number(first?.visible_count ?? 0),
      samples: visibleRows.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        applicationUrl: row.application_url,
        sourceType: row.source_type,
        evidenceKind: row.evidence_kind,
        lastVerifiedAt: row.last_verified_at,
      })),
    };
  });
}

function blankCounts() {
  return {
    selected: 0, inserted: 0, updated: 0, revived: 0, completed: 0, failed: 0,
    no_jobs: 0, skipped: 0, skipped_no_direct_feed_source: 0,
    websitesFilled: 0, advertsFound: 0, advertsRejected: 0,
    ukLocationKnown: 0, ukLocationUnknown: 0, runtimeMs: 0,
  };
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.SPONSOR_WEBSITE_VACANCY_PIPELINE_DEV_DB !== "confirmed" ||
    !process.env.DATABASE_URL
  ) {
    throw new Error("Development DB guard failed: require NODE_ENV=development and SPONSOR_WEBSITE_VACANCY_PIPELINE_DEV_DB=confirmed.");
  }
  const args = parseArgs();
  if (args.apply) {
    // This expectation must be obtained independently from the development
    // database. A manually set NODE_ENV cannot prove DATABASE_URL is safe.
    const identity = await db.execute<{ fingerprint: string }>(sql`
      SELECT md5(
        current_database() || ':' ||
        coalesce(inet_server_addr()::text, '') || ':' ||
        pg_postmaster_start_time()::text
      ) AS fingerprint
    `);
    if (identity.rows.length !== 1 ||
        identity.rows[0].fingerprint !== args.expectedDbFingerprint.toLowerCase()) {
      throw new Error("Connected database does not match the independently confirmed development database.");
    }
  }
  const startedAt = new Date().toISOString();
  const runStartedMs = Date.now();
  await mkdir(args.out, { recursive: true });
  const parsed = parseCsv(await readFile(resolve(args.input), "utf8"));
  const candidates = parsed.map((row) => candidateFromRow(row, args.acceptMedium)).filter((item): item is Candidate => item !== null);
  const dupeResult = duplicateRejected(candidates);
  const availableAtOffset = dupeResult.safe.slice(args.offset);
  const selected = availableAtOffset.slice(0, args.limit);
  const isFinalOffsetWindow =
    args.offset > 0 && selected.length > 0 && selected.length === availableAtOffset.length;
  if (
    args.offset > dupeResult.safe.length ||
    (selected.length < args.limit && !isFinalOffsetWindow)
  ) {
    throw new Error(
      `Insufficient approved, conflict-free rows: requested ${args.limit}, found ${selected.length} at offset ${args.offset}.`,
    );
  }

  const candidateVisibilityBefore = args.directFeedsOnly
    ? await getCandidateVisibility(selected)
    : null;
  const rows: Array<Record<string, unknown>> = [];
  const perSector: Record<string, {
    employers: number;
    runtimeMs: number;
    inserted: number;
    updated: number;
    revived: number;
    completed: number;
    failed: number;
    no_jobs: number;
    skipped_no_direct_feed_source: number;
    websitesFilled: number;
    advertsFound: number;
    advertsRejected: number;
    ukLocationKnown: number;
    ukLocationUnknown: number;
  }> = {};
  const totals = blankCounts();
  totals.selected = selected.length;
  const providersUsed = new Set<string>();
  const visibilityBeforeById = new Map(
    (candidateVisibilityBefore ?? []).map((item) => [item.sponsorLicenceId, item]),
  );
  const rejectedRows = [
    ...candidates.filter((candidate) => candidate.decision === "rejected").map((candidate) => ({ ...candidate })),
    ...dupeResult.rejected,
  ];
  const reviewRows = candidates.filter((candidate) => candidate.decision === "review_required");
  const report: Record<string, unknown> = {
    createdAt: startedAt,
    developmentOnly: true,
    apply: args.apply,
    sourceMode: args.directFeedsOnly ? "direct_feeds_only" : "company_site_pipeline",
    input: resolve(args.input),
    stages: {
      websiteFill: !args.skipWebsiteFill && !args.directFeedsOnly,
      discovery: !args.skipDiscovery,
    },
    requestedLimit: args.limit,
    requestedOffset: args.offset,
    totals,
    perSector,
    providersUsed: [],
    candidateVisibilityBefore,
    rows,
    metricNotes: {
      completed: "runCompanySiteCheck completion=complete",
      no_jobs: "completed checks with zero accepted adverts",
      skipped_no_direct_feed_source: "approved employer mapping is absent or no approved direct ATS/feed/schema.org source is supported",
      applicationUrls: "values are included only when present in persisted company-site vacancy rows",
      liveness: "newly discovered stored links are checked with verifyCompanySiteStoredLink; persisted statuses are reported as-is",
      candidateVisibility: "samples use the same live, recently verified, date, source-missing, closure, and company-site evidence gates as the candidate sponsor-vacancy list",
    },
  };
  const checkpoint = async () => {
    report.runtimeMs = Date.now() - runStartedMs;
    totals.runtimeMs = report.runtimeMs as number;
    report.providersUsed = [...providersUsed].sort();
    await writeFile(resolve(args.out, "report.json"), JSON.stringify(report, null, 2));
  };
  await writeFile(resolve(args.out, "review-required.csv"), writeCsv(reviewRows));
  await writeFile(resolve(args.out, "rejected.csv"), writeCsv(rejectedRows));
  await checkpoint();

  try {
    for (const candidate of selected) {
      const started = Date.now();
      const sector = candidate.sector ?? "unknown";
      const sectorMetrics = perSector[sector] ??= {
        employers: 0, runtimeMs: 0, inserted: 0, updated: 0, revived: 0,
        completed: 0, failed: 0, no_jobs: 0, skipped_no_direct_feed_source: 0,
        websitesFilled: 0, advertsFound: 0,
        advertsRejected: 0, ukLocationKnown: 0, ukLocationUnknown: 0,
      };
      const row: Record<string, unknown> = {
        sponsorLicenceId: candidate.id,
        organisationName: candidate.name,
        candidateWebsite: candidate.website,
        decisionReason: candidate.reason,
        sector,
        ...(visibilityBeforeById.has(candidate.id)
          ? { candidateVisibilityBefore: visibilityBeforeById.get(candidate.id) }
          : {}),
      };
      try {
        const matches = await getSponsor(candidate);
        const sameName = matches.filter((item) => normalizedName(item.organisation_name) === normalizedName(candidate.name));
        const exactMatches = sameName.filter((item) => Number(item.id) === candidate.id);
        const exactSponsor = exactMatches.length === 1 ? exactMatches[0] : null;
        const sameNameRowsShareSource =
          exactSponsor !== null &&
          sameName.every((item) =>
            sameSite(item.website ?? "", exactSponsor.website ?? "") &&
            (item.careers_url ?? null) === (exactSponsor.careers_url ?? null) &&
            (item.ats_provider ?? null) === (exactSponsor.ats_provider ?? null) &&
            (item.ats_board_id ?? null) === (exactSponsor.ats_board_id ?? null) &&
            (item.ats_mapping_status ?? null) === (exactSponsor.ats_mapping_status ?? null) &&
            (item.ats_mapping_evidence_url ?? null) === (exactSponsor.ats_mapping_evidence_url ?? null),
          );
        const duplicateRowsConflict =
          sameName.length !== 1 &&
          !(args.directFeedsOnly && sameNameRowsShareSource);
        if (exactMatches.length !== 1 || sameName.length === 0 || duplicateRowsConflict) {
          row.status = exactMatches.length === 0 ? "missing_sponsor" : "sponsor_identity_conflict";
          row.reason = exactMatches.length === 0
            ? "no exact sponsor ID and organisation-name match in development DB"
            : "duplicate sponsor rows share the name but disagree on website or approved careers-source identity";
          totals.failed += 1;
          sectorMetrics.failed += 1;
        } else {
          const sponsor = exactSponsor!;
          if (sameName.length > 1) {
            row.sameNameSponsorIds = sameName.map((item) => Number(item.id));
            row.identicalSourceDuplicateRowsAccepted = args.directFeedsOnly;
          }
          const dbWebsite = sponsor.website?.trim() ?? "";
          if (dbWebsite && !sameSite(dbWebsite, candidate.website)) {
            row.status = "website_conflict";
            row.reason = "DB already has a different website; existing website was not overwritten";
            totals.failed += 1;
            sectorMetrics.failed += 1;
          } else {
            let websiteStatus: string = dbWebsite ? "existing" : "not_filled";
            if (args.apply && !args.skipWebsiteFill && !args.directFeedsOnly && !dbWebsite) {
              websiteStatus = await fillWebsite(candidate);
              if (websiteStatus === "filled") {
                totals.websitesFilled += 1;
                sectorMetrics.websitesFilled += 1;
              }
              if (websiteStatus === "conflict" || websiteStatus === "missing") {
                row.status = websiteStatus === "conflict" ? "website_conflict" : "missing_sponsor";
                row.reason = "sponsor website changed or sponsor identity disappeared during update";
                totals.failed += 1;
                sectorMetrics.failed += 1;
              }
            }
            row.websitePromotion = websiteStatus;
            row.previousWebsite = dbWebsite || null;
            if (!args.apply) {
              row.status = "dry_run";
            } else if (!row.status && args.directFeedsOnly && !hasApprovedDirectSource(sponsor)) {
              row.status = "skipped_no_direct_feed_source";
              row.reason = "no_direct_feed_source";
              totals.skipped += 1;
              totals.skipped_no_direct_feed_source += 1;
              sectorMetrics.skipped_no_direct_feed_source += 1;
            } else if (!row.status && !args.skipDiscovery) {
              // Never trust ATS mapping data from the CSV. Pass only current DB state;
              // runCompanySiteCheck preserves a verified DB mapping and rejects unverified elevation.
              const discoveryStartedAt = new Date();
              const outcome: CompanySiteCheckOutcome = await runCompanySiteCheck({
                organisationName: sponsor.organisation_name,
                website: dbWebsite || candidate.website,
                genericCheckedAt: null,
                atsCheckedAt: null,
                careersUrl: sponsor.careers_url ?? null,
                atsProvider: sponsor.ats_provider ?? null,
                atsBoardId: sponsor.ats_board_id ?? null,
                atsMappingStatus: sponsor.ats_mapping_status ?? "unverified",
                crawlState: sponsor.crawl_state ?? null,
              }, {
                deadlineMs: Date.now() + 60_000,
                acquireLease: true,
                preserveExistingSiteMetadata: true,
                queueVerifications: false,
                verifyImportIdempotency: false,
                directFeedsOnly: args.directFeedsOnly,
                expectNoInserts: args.expectRepeat,
              });
              row.collection = outcome;
              if (outcome.status === "skipped") {
                row.status = outcome.reason === "no_direct_feed_source"
                  ? "skipped_no_direct_feed_source"
                  : "skipped";
                row.reason = outcome.reason;
                totals.skipped += 1;
                if (outcome.reason === "no_direct_feed_source") {
                  totals.skipped_no_direct_feed_source += 1;
                  sectorMetrics.skipped_no_direct_feed_source += 1;
                }
              } else {
                row.status = outcome.completion === "failed" ? "failed" : outcome.completion === "complete" ? "completed" : outcome.completion;
                row.completion = outcome.completion;
                row.advertsFound = outcome.adverts;
                row.rawAdvertsFound = outcome.rawAdvertsFound;
                row.advertsRejected = outcome.advertsRejected;
                row.ukLocationKnown = outcome.ukLocationKnown;
                row.ukLocationUnknown = outcome.ukLocationUnknown;
                row.inserted = outcome.inserted;
                row.updated = outcome.updated;
                row.revived = outcome.revived;
                row.providerUsed = outcome.atsProvider;
                row.directSourceKind = outcome.diagnostics?.directSourceKind ?? null;
                if (outcome.atsProvider) providersUsed.add(outcome.atsProvider);
                const newAdverts = await getRecentlyDiscovered(candidate, discoveryStartedAt);
                const verificationOutcomes: Array<{ id: number; outcome: string }> = [];
                for (const advert of newAdverts) {
                  const effectiveUrl = advert.application_url?.trim() || advert.url;
                  const verification = await verifyCompanySiteStoredLink(
                    Number(advert.id),
                    effectiveUrl,
                    Date.now() + 20_000,
                  );
                  verificationOutcomes.push({ id: Number(advert.id), outcome: verification });
                }
                row.verification = verificationOutcomes;
                row.applicationUrls = (await getAdvertLinks(candidate))
                  .filter((advert) => advert.application_url)
                  .map((advert) => ({ id: advert.id, title: advert.title, url: advert.url, applicationUrl: advert.application_url, liveness: advert.liveness }));
                totals.advertsFound += outcome.adverts;
                totals.advertsRejected += outcome.advertsRejected;
                totals.ukLocationKnown += outcome.ukLocationKnown;
                totals.ukLocationUnknown += outcome.ukLocationUnknown;
                totals.inserted += outcome.inserted;
                totals.updated += outcome.updated;
                totals.revived += outcome.revived;
                sectorMetrics.advertsFound += outcome.adverts;
                sectorMetrics.advertsRejected += outcome.advertsRejected;
                sectorMetrics.ukLocationKnown += outcome.ukLocationKnown;
                sectorMetrics.ukLocationUnknown += outcome.ukLocationUnknown;
                sectorMetrics.inserted += outcome.inserted;
                sectorMetrics.updated += outcome.updated;
                sectorMetrics.revived += outcome.revived;
                if (outcome.completion === "complete") {
                  totals.completed += 1;
                  sectorMetrics.completed += 1;
                  if (outcome.adverts === 0) {
                    totals.no_jobs += 1;
                    sectorMetrics.no_jobs += 1;
                  }
                } else {
                  totals.failed += 1;
                  sectorMetrics.failed += 1;
                }
              }
            } else if (!row.status) {
              row.status = args.skipDiscovery ? "website_stage_only" : "discovery_stage_only";
            }
          }
        }
      } catch (error) {
        // runCompanySiteCheck handles network failures itself; an escaping failure is
        // treated as fatal because it may represent an uncommitted DB write.
        row.status = "fatal_error";
        row.error = error instanceof Error ? error.message : String(error);
        totals.failed += 1;
        sectorMetrics.failed += 1;
        row.elapsedMs = Date.now() - started;
        rows.push(row);
        sectorMetrics.employers += 1;
        sectorMetrics.runtimeMs += row.elapsedMs as number;
        await checkpoint();
        throw error;
      }
      row.elapsedMs = Date.now() - started;
      totals.selected = selected.length;
      sectorMetrics.employers += 1;
      sectorMetrics.runtimeMs += row.elapsedMs as number;
      rows.push(row);
      await checkpoint();
      console.log(JSON.stringify(row));
      if (args.expectRepeat && Number(row.inserted ?? 0) > 0) {
        throw new Error("Repeat run inserted a vacancy; stopped before checking further employers.");
      }
    }
    if (args.directFeedsOnly) {
      const candidateVisibilityAfter = await getCandidateVisibility(selected);
      const visibilityAfterById = new Map(
        candidateVisibilityAfter.map((item) => [item.sponsorLicenceId, item]),
      );
      for (const row of rows) {
        const visibility = visibilityAfterById.get(Number(row.sponsorLicenceId));
        if (visibility) row.candidateVisibilityAfter = visibility;
      }
      report.candidateVisibilityAfter = candidateVisibilityAfter;
      await writeFile(
        resolve(args.out, "candidate-visibility.json"),
        JSON.stringify({
          before: candidateVisibilityBefore,
          after: candidateVisibilityAfter,
        }, null, 2),
      );
    }
    await writeFile(resolve(args.out, "auto-approved-selected.csv"), writeCsv(selected));
    report.finishedAt = new Date().toISOString();
    report.runtimeMs = Date.now() - runStartedMs;
    totals.runtimeMs = report.runtimeMs as number;
    report.providersUsed = [...providersUsed].sort();
    await checkpoint();
  } finally {
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  // A rejected DB-identity guard runs before the normal per-batch finally.
  await pool.end().catch(() => {});
});