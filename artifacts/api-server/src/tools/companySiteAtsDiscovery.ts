import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { discoverCompanySiteVacancies } from "../lib/companySiteDiscovery";
import { fetchCompanySitePage } from "../lib/companySiteHttp";
import { parseDirectBoardMapping } from "../lib/directEmployerBoardConnectors";
import { assertDatabaseFingerprint, safeToolErrorSummary } from "./databaseSafety";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_PAGES_PER_EMPLOYER = 3;
const EMPLOYER_DEADLINE_MS = 20_000;
const OUTPUT_VERSION = 1;

const ATS_HOSTS: Array<{ provider: string; suffixes: string[] }> = [
  { provider: "Ashby", suffixes: ["ashbyhq.com"] },
  { provider: "Greenhouse", suffixes: ["greenhouse.io"] },
  { provider: "Lever", suffixes: ["lever.co"] },
  { provider: "SmartRecruiters", suffixes: ["smartrecruiters.com"] },
  { provider: "Recruitee", suffixes: ["recruitee.com"] },
  { provider: "Personio", suffixes: ["personio.com", "personio.de"] },
  { provider: "Pinpoint", suffixes: ["pinpointhq.com"] },
  { provider: "Workday", suffixes: ["myworkdayjobs.com", "myworkdaysite.com"] },
];

type EmployerRow = {
  organisation_name: string;
  website: string;
  careers_url: string | null;
  ats_provider: string | null;
  ats_board_id: string | null;
  ats_mapping_status: string | null;
  ats_mapping_evidence_url: string | null;
};

type Candidate = {
  provider: string;
  boardId: string;
  careersUrl: string;
  evidenceUrl: string;
};

function argsMap(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values.set(match[1]!, match[2]!);
    else if (arg.startsWith("--")) values.set(arg.slice(2), "true");
  }
  return values;
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function safeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safePathUrl(value: string | null | undefined): string | null {
  const url = value ? safeUrl(value) : null;
  return url ? `${url.origin}${url.pathname}` : null;
}

function providerForHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return ATS_HOSTS.find(({ suffixes }) =>
    suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)),
  )?.provider ?? null;
}

function decodeHref(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'");
}

function publicAnchors(html: string, pageUrl: string): Array<{ url: URL; text: string }> {
  const links: Array<{ url: URL; text: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const url = new URL(decodeHref(href), pageUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        seen.has(url.toString())
      ) continue;
      seen.add(url.toString());
      links.push({
        url,
        text: (match[2] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      });
    } catch {
      // Malformed links are rejected rather than guessed.
    }
  }
  return links;
}

function safeErrorCategory(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  if (/timeout|timed out|deadline|abort/i.test(message)) return "timeout";
  if (/robots|disallow/i.test(message)) return "robots";
  if (/oversize|too large|byte limit/i.test(message)) return "oversize";
  if (/unsafe|blocked|private|ssrf|forbidden/i.test(message)) return "blocked";
  if (/incomplete|partial|pagination|snapshot/i.test(message)) return "partial_feed";
  if (/HTTP\s+\d{3}/i.test(message)) return "http";
  if (/json|parse|malformed|feed/i.test(message)) return "invalid_feed";
  if (/network|ECONN|DNS|EAI_/i.test(message)) return "network";
  return "unknown";
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

async function selectEmployers(
  limit: number,
  organisationNames?: readonly string[],
): Promise<EmployerRow[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const names = organisationNames?.map((name) => name.trim().toLowerCase());
    const employerFilter = names === undefined
      ? sql`TRUE`
      : sql`lower(btrim(sl.organisation_name)) = ANY(${sql.param(names)}::text[])`;
    const result = await tx.execute<EmployerRow>(sql`
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.organisation_name,
        trim(sl.website) AS website,
        cs.careers_url,
        cs.ats_provider,
        cs.ats_board_id,
        cs.ats_mapping_status,
        cs.ats_mapping_evidence_url
      FROM sponsor_licences sl
      LEFT JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE sl.website IS NOT NULL
        AND trim(sl.website) <> ''
        AND ${employerFilter}
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
      LIMIT ${limit}
    `);
    return result.rows;
  });
}

async function pagesForEmployer(
  employer: EmployerRow,
  deadlineMs: number,
): Promise<Array<{ url: string; body: string }>> {
  const root = safeUrl(employer.website);
  if (!root) return [];
  const urls: string[] = [root.toString()];
  for (const saved of [employer.careers_url, employer.ats_mapping_evidence_url]) {
    if (!saved) continue;
    const parsed = safeUrl(saved);
    if (parsed && parsed.hostname.toLowerCase() === root.hostname.toLowerCase()) {
      urls.push(parsed.toString());
    }
  }
  const pages: Array<{ url: string; body: string }> = [];
  for (const url of [...new Set(urls)].slice(0, MAX_PAGES_PER_EMPLOYER)) {
    if (Date.now() >= deadlineMs) break;
    const response = await fetchCompanySitePage(
      url,
      root.hostname,
      deadlineMs,
      1_000_000,
      { readOnly: true },
    );
    if (response.ok) pages.push({ url: response.url, body: response.body });
  }
  return pages;
}

async function discoverEmployer(
  employer: EmployerRow,
): Promise<Record<string, unknown>[]> {
  const root = safeUrl(employer.website);
  const employerKey = `${employer.organisation_name.trim().toLowerCase()}@${root?.hostname.toLowerCase() ?? "invalid"}`;
  const common = {
    employerKey,
    organisationName: employer.organisation_name,
    websiteOrigin: root?.origin ?? null,
  };
  if (!root) {
    return [{
      ...common,
      status: "rejected",
      provider: null,
      confidence: "none",
      rejectionReason: "invalid_or_non_https_employer_website",
      feedComplete: false,
      snapshotAuthority: false,
    }];
  }

  const pages = await pagesForEmployer(employer, Date.now() + EMPLOYER_DEADLINE_MS);
  const candidates = new Map<string, Candidate>();
  const rejections: string[] = [];
  for (const page of pages) {
    for (const anchor of publicAnchors(page.body, page.url)) {
      const provider = providerForHost(anchor.url.hostname);
      if (!provider) continue;
      const candidateUrl = new URL(anchor.url);
      candidateUrl.search = "";
      candidateUrl.hash = "";
      const mapping = parseDirectBoardMapping(provider, candidateUrl.toString(), {
        firstPartyEvidenceUrl: page.url,
      });
      if (!mapping) {
        rejections.push(`unsupported_or_unverified_${provider.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_mapping`);
        continue;
      }
      const candidate: Candidate = {
        provider: mapping.provider,
        boardId: mapping.boardId,
        careersUrl: mapping.evidenceUrl,
        evidenceUrl: page.url,
      };
      candidates.set(`${candidate.provider}:${candidate.boardId.toLowerCase()}`, candidate);
    }
  }

  if (candidates.size === 0) {
    const storedWasVerified = employer.ats_mapping_status === "verified";
    return [{
      ...common,
      status: "no_verified_direct_feed",
      provider: employer.ats_provider,
      boardId: employer.ats_board_id,
      careersUrl: safeOrigin(employer.careers_url),
      evidenceUrl: safeOrigin(employer.ats_mapping_evidence_url),
      confidence: "none",
      rejectionReason: storedWasVerified
        ? "stored_mapping_not_confirmed_by_first_party_link"
        : rejections[0] ?? "no_supported_ats_feed_link_on_saved_employer_pages",
      feedComplete: false,
      snapshotAuthority: false,
      feedErrorCategory: null,
      advertsExtracted: 0,
    }];
  }

  const records: Record<string, unknown>[] = [];
  for (const candidate of candidates.values()) {
    const feed = await discoverCompanySiteVacancies(
      employer.organisation_name,
      employer.website,
      {
        knownCareersUrl: candidate.careersUrl,
        knownAtsBoardId: candidate.boardId,
        knownCareersMappingVerified: true,
        knownCareersEvidenceUrl: candidate.evidenceUrl,
        checkGeneric: false,
        checkAts: true,
        directFeedsOnly: true,
        readOnly: true,
        deadlineMs: Date.now() + EMPLOYER_DEADLINE_MS,
      },
    );
    records.push({
      ...common,
      status: feed.completion === "complete" && feed.diagnostics.directSourceKind === "ats_feed"
        ? "verified_feed"
        : "feed_failed",
      provider: candidate.provider,
      boardId: candidate.boardId,
      careersUrl: safePathUrl(candidate.careersUrl),
      evidenceUrl: safePathUrl(candidate.evidenceUrl),
      confidence: "high",
      rejectionReason: feed.diagnostics.directFeedSkipDetail ?? null,
      feedComplete: feed.completion === "complete" && feed.atsCompleted,
      snapshotAuthority: Boolean(feed.snapshotScope),
      snapshotScope: feed.snapshotScope ?? null,
      pagesFetched: feed.pagesFetched,
      advertsExtracted: feed.advertsExtracted,
      advertsAccepted: feed.adverts.length,
      advertsRejected: feed.advertsRejected,
      feedErrorCategory: feed.error ? safeErrorCategory(feed.error) : null,
      feedOrigin: feed.discoveredUrls[0] ? safeOrigin(feed.discoveredUrls[0]) : null,
    });
  }
  return records;
}

async function main(): Promise<void> {
  const args = argsMap(process.argv.slice(2));
  const environment = args.get("environment") ?? "development";
  const format = args.get("format") ?? "json";
  const limit = Number(args.get("limit") ?? DEFAULT_LIMIT);
  const organisationNames = args.get("organisations")
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (environment !== "development" && environment !== "production") {
    throw new Error("--environment must be development or production");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  if (organisationNames && (organisationNames.length > 10 || new Set(organisationNames.map((name) => name.toLowerCase())).size !== organisationNames.length)) {
    throw new Error("--organisations accepts up to 10 distinct, comma-separated exact employer names.");
  }
  if (format !== "json" && format !== "csv") {
    throw new Error("--format must be json or csv");
  }
  if (environment === "production") {
    if (process.env.NODE_ENV !== "production" || args.get("confirm-production-read-only") !== "true") {
      throw new Error("Production discovery requires NODE_ENV=production and --confirm-production-read-only=true.");
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing a development label while NODE_ENV=production.");
  } else {
    const expectedFingerprint = args.get("expected-db-fingerprint");
    if (!expectedFingerprint) {
      throw new Error("Development discovery requires --expected-db-fingerprint from the confirmed development database.");
    }
    await assertDatabaseFingerprint(expectedFingerprint);
  }

  const employers = await selectEmployers(limit, organisationNames);
  const records: Record<string, unknown>[] = [];
  for (const employer of employers) {
    records.push(...await discoverEmployer(employer));
  }
  const report = {
    version: OUTPUT_VERSION,
    environment,
    mode: "read_only_ats_discovery",
    generatedAt: new Date().toISOString(),
    selectedEmployers: employers.length,
    records,
  };

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const headers = [
    "employerKey", "organisationName", "websiteOrigin", "status", "provider",
    "boardId", "careersUrl", "evidenceUrl", "confidence", "rejectionReason",
    "feedComplete", "snapshotAuthority", "pagesFetched", "advertsExtracted",
    "advertsAccepted", "advertsRejected", "feedErrorCategory", "feedOrigin",
  ];
  process.stdout.write(`${headers.map(csvCell).join(",")}\n`);
  for (const record of records) {
    process.stdout.write(`${headers.map((key) => csvCell(record[key])).join(",")}\n`);
  }
}

main().catch((error) => {
  console.error(
    "Company-site ATS discovery failed:",
    safeErrorCategory(error),
    safeToolErrorSummary(error),
  );
  process.exitCode = 1;
});