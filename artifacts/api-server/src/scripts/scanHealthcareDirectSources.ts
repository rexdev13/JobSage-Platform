/**
 * Development-only source-mapping audit for a reviewed healthcare cohort.
 *
 * This reads sponsor websites and careers pages through the existing safe
 * company-site fetcher. It records possible ATS mappings for review only:
 * it does not persist vacancies or modify sponsor mapping fields.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  discoverCompanySiteVacancies,
  type CompanySiteDiscoveryResult,
} from "../lib/companySiteDiscovery";
import { parseDirectBoardMapping } from "../lib/directEmployerBoardConnectors";

type CsvRow = Record<string, string>;
type Candidate = {
  sponsor_licence_id: string;
  organisation_name: string;
  sector: string;
  website: string;
  careers_url: string;
  ats_provider: string;
  ats_board_id: string;
  ats_mapping_status: string;
  ats_mapping_evidence_url: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    input: "../../.agents/outputs/healthcare-direct-source-test-2026-09-26/cohort.csv",
    out: "../../.agents/outputs/healthcare-direct-source-test-2026-09-26/source-scan.json",
    expectedDbFingerprint: "",
    concurrency: 4,
    deadlineMs: 12_000,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--input") config.input = args[++i] ?? "";
    else if (arg === "--out") config.out = args[++i] ?? config.out;
    else if (arg === "--expected-db-fingerprint") config.expectedDbFingerprint = args[++i] ?? "";
    else if (arg === "--concurrency") config.concurrency = Number(args[++i]);
    else if (arg === "--deadline-ms") config.deadlineMs = Number(args[++i]);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!config.input) throw new Error("--input is required.");
  if (!/^[a-f0-9]{32}$/i.test(config.expectedDbFingerprint)) {
    throw new Error("--expected-db-fingerprint must match the development database.");
  }
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8.");
  }
  if (!Number.isInteger(config.deadlineMs) || config.deadlineMs < 2_000 || config.deadlineMs > 25_000) {
    throw new Error("--deadline-ms must be between 2000 and 25000.");
  }
  config.input = resolve(config.input);
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
    } else {
      field += ch;
    }
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

function parseCandidate(row: CsvRow): Candidate {
  const id = row.sponsor_licence_id?.trim() ?? "";
  const name = row.organisation_name?.trim() ?? "";
  const website = row.website?.trim() ?? "";
  let parsed: URL;
  try {
    parsed = new URL(website);
  } catch {
    throw new Error(`Invalid website for sponsor ${id || "(missing ID)"}.`);
  }
  if (!/^\d+$/.test(id) || !name || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new Error(`Invalid development cohort row for ${name || id || "(unknown sponsor)"}.`);
  }
  return {
    sponsor_licence_id: id,
    organisation_name: name,
    sector: row.sector?.trim() ?? "",
    website,
    careers_url: row.careers_url?.trim() ?? "",
    ats_provider: row.ats_provider?.trim() ?? "",
    ats_board_id: row.ats_board_id?.trim() ?? "",
    ats_mapping_status: row.ats_mapping_status?.trim() ?? "",
    ats_mapping_evidence_url: row.ats_mapping_evidence_url?.trim() ?? "",
  };
}

async function scanCandidate(candidate: Candidate, deadlineMs: number) {
  const startedAt = Date.now();
  try {
    const result: CompanySiteDiscoveryResult = await discoverCompanySiteVacancies(
      candidate.organisation_name,
      candidate.website,
      {
        knownCareersUrl: candidate.careers_url || undefined,
        knownAtsBoardId: candidate.ats_board_id || undefined,
        knownCareersMappingVerified: candidate.ats_mapping_status === "verified",
        knownCareersEvidenceUrl: candidate.ats_mapping_evidence_url || undefined,
        checkGeneric: false,
        checkAts: true,
        deadlineMs: Date.now() + deadlineMs,
      },
    );
    const provider = result.atsProvider ?? null;
    const careersUrl = result.careersUrl ?? null;
    const directMapping = provider && careersUrl
      ? parseDirectBoardMapping(provider, careersUrl)
      : null;
    return {
      sponsorLicenceId: Number(candidate.sponsor_licence_id),
      organisationName: candidate.organisation_name,
      sector: candidate.sector,
      website: candidate.website,
      savedCareersUrl: candidate.careers_url || null,
      savedMappingStatus: candidate.ats_mapping_status || null,
      sourceCareersUrl: careersUrl,
      sourceProvider: provider,
      sourceBoardId: directMapping?.boardId ?? null,
      sourceFeedUrl: directMapping?.feedUrl ?? null,
      supportedByDirectFeedAdapter: Boolean(directMapping),
      mappingVerifiedByFirstPartyLink: result.atsMappingVerified === true,
      mappingEvidenceUrl: result.atsMappingEvidenceUrl ?? null,
      sourceLinks: result.diagnostics.atsLinksSeen,
      pagesAttempted: result.pagesAttempted,
      completion: result.completion,
      scanError: result.error ?? null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      sponsorLicenceId: Number(candidate.sponsor_licence_id),
      organisationName: candidate.organisation_name,
      sector: candidate.sector,
      website: candidate.website,
      savedCareersUrl: candidate.careers_url || null,
      savedMappingStatus: candidate.ats_mapping_status || null,
      sourceCareersUrl: null,
      sourceProvider: null,
      sourceBoardId: null,
      sourceFeedUrl: null,
      supportedByDirectFeedAdapter: false,
      mappingVerifiedByFirstPartyLink: false,
      mappingEvidenceUrl: null,
      sourceLinks: [],
      pagesAttempted: 0,
      completion: "failed",
      scanError: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.SPONSOR_WEBSITE_VACANCY_PIPELINE_DEV_DB !== "confirmed" ||
    !process.env.DATABASE_URL
  ) {
    throw new Error("Development DB guard failed; require development mode and the sponsor pipeline confirmation flag.");
  }
  const config = parseArgs();
  const identity = await db.execute<{ fingerprint: string }>(sql`
    SELECT md5(
      current_database() || ':' ||
      coalesce(inet_server_addr()::text, '') || ':' ||
      pg_postmaster_start_time()::text
    ) AS fingerprint
  `);
  if (
    identity.rows.length !== 1 ||
    identity.rows[0].fingerprint !== config.expectedDbFingerprint.toLowerCase()
  ) {
    throw new Error("Connected database does not match the independently confirmed development database.");
  }
  const rows = parseCsv(await readFile(config.input, "utf8"));
  const candidates = rows.map(parseCandidate);
  if (
    candidates.length < 1 ||
    candidates.length > 100 ||
    new Set(candidates.map((candidate) => candidate.sponsor_licence_id)).size !== candidates.length ||
    new Set(candidates.map((candidate) => candidate.organisation_name.toLocaleLowerCase("en-GB").trim())).size !== candidates.length
  ) {
    throw new Error("Source scan requires 1–100 unique sponsor IDs and organisation names.");
  }

  const startedAt = new Date().toISOString();
  const results: Array<Awaited<ReturnType<typeof scanCandidate>> | undefined> =
    new Array(candidates.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= candidates.length) return;
      results[index] = await scanCandidate(candidates[index], config.deadlineMs);
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));
  const completeResults = results.filter((item): item is Awaited<ReturnType<typeof scanCandidate>> => Boolean(item));
  const providers: Record<string, number> = {};
  for (const row of completeResults) {
    if (row.sourceProvider) providers[row.sourceProvider] = (providers[row.sourceProvider] ?? 0) + 1;
  }
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    developmentOnly: true,
    sourceMode: "mapping_discovery_only_no_vacancy_persistence",
    candidates: candidates.length,
    scanned: completeResults.length,
    directFeedMappings: completeResults.filter((row) => row.supportedByDirectFeedAdapter).length,
    firstPartyMapped: completeResults.filter((row) => row.mappingVerifiedByFirstPartyLink).length,
    providers,
    failures: completeResults.filter((row) => row.completion === "failed").length,
    rows: completeResults,
  };
  await mkdir(dirname(config.out), { recursive: true });
  await writeFile(config.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    sourceMode: report.sourceMode,
    candidates: report.candidates,
    scanned: report.scanned,
    directFeedMappings: report.directFeedMappings,
    firstPartyMapped: report.firstPartyMapped,
    providers: report.providers,
    failures: report.failures,
    output: config.out,
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