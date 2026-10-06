import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import {
  assertDatabaseMode,
  assertProductionProofReadOnly,
  safeToolErrorSummary,
  type DatabaseIdentity,
} from "./databaseSafety";
import {
  installDatabaseContext,
  parseDiscoveryExecutionOptions,
  prepareDatabaseContext,
  verifyProductionWriteGuards,
} from "./companySiteDiscoveryRuntime";
import {
  loadEmployerInput,
  type EmployerRow,
  type LoadedEmployerInput,
} from "./companySiteDiscoveryInput";
import {
  fetchCompanySiteEvidencePages,
  type CompanySiteEvidenceAttempt,
  type CompanySiteEvidencePage,
} from "../lib/companySiteAtsEvidence";
import {
  classifyOperatorEvidenceAttempt,
  classifyOperatorEvidenceOutcome,
  HEALTHCARE_SELECTOR,
  isFirstPartyEvidenceHost,
  matchesHealthcareSelector,
  savedCareersOnlyPageUrls,
} from "./companySiteAtsScope";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;
const MAX_PAGES_PER_EMPLOYER = 3;
const EMPLOYER_DEADLINE_MS = 20_000;
const DEFAULT_COOLDOWN_DAYS = 14;
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

type Candidate = {
  provider: string;
  boardId: string;
  careersUrl: string;
  evidenceUrl: string;
  discoveryRoute: "employer_site" | "operator_supplied_first_party_evidence";
};

type PublicSource = {
  url: URL;
  text: string;
  kind: "anchor" | "iframe" | "script";
};

function healthcareEmployerSql() {
  return sql`(
    sl.industry IN ('Healthcare', 'Social Care')
    OR (
      sl.industry = 'Public Services'
      AND sl.organisation_name ~* ${sql.param(
        String.raw`\mNHS\M|\mNational[[:space:]]+Health[[:space:]]+Service\M|public[[:space:]]+health|clinical[[:space:]]+commissioning[[:space:]]+group|\mCCG\M|\mICB\M`,
      )}
    )
  )`;
}

type DiscoveryHelpers = {
  discoverCompanySiteVacancies: typeof import("../lib/companySiteDiscovery").discoverCompanySiteVacancies;
  fetchCompanySitePage: typeof import("../lib/companySiteHttp").fetchCompanySitePage;
  parseDirectBoardMapping: typeof import("../lib/directEmployerBoardConnectors").parseDirectBoardMapping;
  hasPositiveAtsFeedEvidence: typeof import("../lib/directEmployerBoardConnectors").hasPositiveAtsFeedEvidence;
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

function publicSources(html: string, pageUrl: string): PublicSource[] {
  const links: PublicSource[] = [];
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
        kind: "anchor",
      });
    } catch {
      // Malformed links are rejected rather than guessed.
    }
  }
  for (const match of html.matchAll(/<(iframe|script)\b([^>]*)>/gi)) {
    const kind = match[1]?.toLowerCase() as "iframe" | "script" | undefined;
    const attributes = match[2] ?? "";
    const rawUrl = attributes.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!kind || !rawUrl || /^(?:mailto:|tel:|javascript:|#)/i.test(rawUrl)) continue;
    try {
      const url = new URL(decodeHref(rawUrl), pageUrl);
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
        text: attributes.match(/\b(?:title|aria-label)\s*=\s*["']([^"']+)["']/i)?.[1] ?? "",
        kind,
      });
    } catch {
      // Malformed or unsafe sources are ignored.
    }
  }
  return links;
}

function recruitmentSignal(source: PublicSource): boolean {
  return /\b(?:career|jobs?|vacanc(?:y|ies)|recruit(?:ing|ment)?|hiring|application|apply|talent|workable|bamboohr|icims|jobvite|workday|oracle)\b/i
    .test(`${source.url.hostname} ${source.url.pathname} ${source.text}`);
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

type SourceOutcome =
  | "verified_ats_feed"
  | "structured_job_postings"
  | "sitemap_job_listings"
  | "unresolved";

function summarizeRecords(records: Record<string, unknown>[]) {
  const outcomes: SourceOutcome[] = [
    "verified_ats_feed",
    "structured_job_postings",
    "sitemap_job_listings",
    "unresolved",
  ];
  const counts = Object.fromEntries(outcomes.map((outcome) => [outcome, 0])) as Record<SourceOutcome, number>;
  const samplesByOutcome = Object.fromEntries(
    outcomes.map((outcome) => [outcome, [] as Record<string, unknown>[]]),
  ) as Record<SourceOutcome, Record<string, unknown>[]>;
  const operatorEvidenceOutcomes: Record<string, number> = {};
  const operatorEvidenceAttemptOutcomes: Record<string, number> = {};
  const unknownDomains = new Map<string, { count: number; employers: Set<string> }>();

  for (const record of records) {
    const outcome = outcomes.includes(record.outcome as SourceOutcome)
      ? record.outcome as SourceOutcome
      : "unresolved";
    counts[outcome] += 1;
    const evidenceOutcome = typeof record.operatorEvidenceOutcome === "string"
      ? record.operatorEvidenceOutcome
      : "not_provided";
    operatorEvidenceOutcomes[evidenceOutcome] =
      (operatorEvidenceOutcomes[evidenceOutcome] ?? 0) + 1;
    if (Array.isArray(record.operatorEvidenceAttempts)) {
      for (const attempt of record.operatorEvidenceAttempts) {
        if (!attempt || typeof attempt !== "object") continue;
        const attemptOutcome = classifyOperatorEvidenceAttempt(
          attempt as Parameters<typeof classifyOperatorEvidenceAttempt>[0],
        );
        operatorEvidenceAttemptOutcomes[attemptOutcome] =
          (operatorEvidenceAttemptOutcomes[attemptOutcome] ?? 0) + 1;
      }
    }
    if (samplesByOutcome[outcome].length < 10) {
      samplesByOutcome[outcome].push({
        organisationName: record.organisationName,
        websiteOrigin: record.websiteOrigin,
        provider: record.provider ?? null,
        boardId: record.boardId ?? null,
        careersUrl: record.careersUrl ?? null,
        outcome,
        discoveryRoute: record.discoveryRoute ?? null,
        operatorEvidenceOutcome: evidenceOutcome,
        operatorEvidenceAttempts: Array.isArray(record.operatorEvidenceAttempts)
          ? record.operatorEvidenceAttempts.slice(0, 5)
          : [],
        rejectionReason: record.rejectionReason ?? null,
        feedIdentityStatus: record.feedIdentityStatus ?? null,
        identityClaims: Array.isArray(record.identityClaims)
          ? record.identityClaims.slice(0, 3)
          : [],
        advertsExtracted: record.advertsExtracted ?? 0,
        advertsAccepted: record.advertsAccepted ?? 0,
      });
    }
    if (outcome !== "unresolved" || !Array.isArray(record.unknownDomains)) continue;
    const employer = typeof record.organisationName === "string" ? record.organisationName : "unknown";
    for (const rawDomain of new Set(record.unknownDomains)) {
      if (typeof rawDomain !== "string" || !rawDomain.trim()) continue;
      const domain = rawDomain.toLowerCase();
      const current = unknownDomains.get(domain) ?? { count: 0, employers: new Set<string>() };
      current.count += 1;
      if (current.employers.size < 10) current.employers.add(employer);
      unknownDomains.set(domain, current);
    }
  }

  const topUnknownDomains = [...unknownDomains.entries()]
    .map(([domain, value]) => ({
      domain,
      unresolvedEmployerCount: value.count,
      sampleEmployers: [...value.employers].slice(0, 3),
    }))
    .sort((a, b) =>
      b.unresolvedEmployerCount - a.unresolvedEmployerCount || a.domain.localeCompare(b.domain),
    )
    .slice(0, 20);

  return {
    employersByOutcome: counts,
    samplesByOutcome,
    operatorEvidenceOutcomes,
    operatorEvidenceAttemptOutcomes,
    unresolvedUnknownDomainCount: unknownDomains.size,
    topUnknownDomains,
  };
}

async function selectEmployers(
  database: Pick<typeof import("@workspace/db").db, "transaction">,
  limit: number,
  organisationNames?: readonly string[],
  healthcareOnly = false,
  savedCareersOnly = false,
  cooldownDays = DEFAULT_COOLDOWN_DAYS,
): Promise<EmployerRow[]> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return selectEmployersFromTransaction(
      tx,
      limit,
      organisationNames,
      healthcareOnly,
      savedCareersOnly,
      cooldownDays,
    );
  });
}

async function selectEmployersFromTransaction(
  database: Pick<typeof import("@workspace/db").db, "execute">,
  limit: number,
  organisationNames?: readonly string[],
  healthcareOnly = false,
  savedCareersOnly = false,
  cooldownDays = DEFAULT_COOLDOWN_DAYS,
): Promise<EmployerRow[]> {
  const names = organisationNames?.map((name) => name.trim().toLowerCase());
  const employerFilter = names === undefined
    ? sql`TRUE`
    : sql`lower(btrim(sl.organisation_name)) = ANY(${sql.param(names)}::text[])`;
  const scopeFilter = sql`
    ${healthcareOnly ? healthcareEmployerSql() : sql`TRUE`}
    AND ${savedCareersOnly ? sql`cs.careers_url IS NOT NULL AND btrim(cs.careers_url) <> ''` : sql`TRUE`}
    AND COALESCE(
      GREATEST(cs.ats_checked_at, cs.generic_checked_at, cs.last_attempted_at),
      'epoch'::timestamptz
    ) <= NOW() - (${cooldownDays} * INTERVAL '1 day')
    AND (cs.retry_after IS NULL OR cs.retry_after <= NOW())
  `;
  const result = await database.execute<EmployerRow>(sql`
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.organisation_name,
        trim(sl.website) AS website,
         sl.industry,
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
         AND ${scopeFilter}
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
      LIMIT ${limit}
    `);
  return result.rows;
}

async function pagesForEmployer(
  employer: EmployerRow,
  deadlineMs: number,
  helpers: DiscoveryHelpers,
  noHostState: boolean,
  savedCareersOnly: boolean,
): Promise<{ pages: Array<{
  url: string;
  body: string;
  source: "employer_site" | "operator_supplied_first_party_evidence";
}>; attempts: CompanySiteEvidenceAttempt[] }> {
  const root = safeUrl(employer.website);
  if (!root) return { pages: [], attempts: [] };
  const careers = employer.careers_url ? safeUrl(employer.careers_url) : null;
  const preferredCareers = careers && isFirstPartyEvidenceHost(careers.hostname, root.hostname)
    ? careers.toString()
    : null;
  const employerUrls: string[] = savedCareersOnly
    ? savedCareersOnlyPageUrls(employer)
    : [preferredCareers ?? root.toString()];
  for (const saved of savedCareersOnly ? [] : [employer.careers_url, employer.ats_mapping_evidence_url]) {
    if (!saved) continue;
    const parsed = safeUrl(saved);
    if (parsed && isFirstPartyEvidenceHost(parsed.hostname, root.hostname)) {
      employerUrls.push(parsed.toString());
    }
  }
  if (!savedCareersOnly && preferredCareers) employerUrls.push(root.toString());
  const operatorUrls = (employer.operator_evidence_urls ?? [])
    .map((value) => safeUrl(value))
    .filter((value): value is URL => value !== null);
  const validOperatorUrls = operatorUrls.filter((url) => isFirstPartyEvidenceHost(url.hostname, root.hostname));
  const invalidOperatorUrls = operatorUrls.filter((url) => !isFirstPartyEvidenceHost(url.hostname, root.hostname));
  const operatorUrlSet = new Set(validOperatorUrls.map((url) => url.toString()));
  const uniqueEmployerUrls = [...new Set(employerUrls)]
    .filter((url) => !operatorUrlSet.has(url));
  const alternativeSlots = Math.min(validOperatorUrls.length, MAX_PAGES_PER_EMPLOYER - 1);
  const pageLimitForEmployerUrls = validOperatorUrls.length > 0
    ? Math.max(1, MAX_PAGES_PER_EMPLOYER - alternativeSlots)
    : MAX_PAGES_PER_EMPLOYER;
  const scheduled: Array<{
    url: string;
    source: CompanySiteEvidencePage["source"];
  }> = [
    ...uniqueEmployerUrls.slice(0, pageLimitForEmployerUrls).map((url) => ({
      url,
      source: "employer_site" as const,
    })),
    ...validOperatorUrls.map((url) => ({
      url: url.toString(),
      source: "operator_supplied_first_party_evidence" as const,
    })),
  ].slice(0, MAX_PAGES_PER_EMPLOYER);
  const invalidAttempts: CompanySiteEvidenceAttempt[] = invalidOperatorUrls.map((url) => ({
    url: `${url.origin}${url.pathname}`,
    source: "operator_supplied_first_party_evidence",
    fetched: false,
    failureKind: "unsafe",
    reason: "operator evidence URL is not on the employer website or its subdomain",
    invalidFirstParty: true,
  }));
  const scheduledOperatorUrlSet = new Set(
    scheduled
      .filter((item) => item.source === "operator_supplied_first_party_evidence")
      .map((item) => item.url),
  );
  const pageLimitAttempts: CompanySiteEvidenceAttempt[] = validOperatorUrls
    .filter((url) => !scheduledOperatorUrlSet.has(url.toString()))
    .map((url) => ({
      url: safePathUrl(url.toString()) ?? url.toString(),
      source: "operator_supplied_first_party_evidence",
      fetched: false,
      failureKind: "not_attempted_page_limit",
      reason: "not attempted because the per-employer page limit was reached",
      notAttemptedReason: "page_limit",
    }));
  const fetched = await fetchCompanySiteEvidencePages({
    scheduled,
    originHostname: root.hostname,
    deadlineMs,
    noHostState,
    fetchPage: helpers.fetchCompanySitePage,
  });
  const safeAttempts = fetched.attempts.map((attempt) => ({
    ...attempt,
    url: safePathUrl(attempt.url) ?? attempt.url,
  }));
  return {
    pages: fetched.pages,
    attempts: [...invalidAttempts, ...safeAttempts, ...pageLimitAttempts],
  };
}

async function discoverEmployer(
  employer: EmployerRow,
  helpers: DiscoveryHelpers,
  noHostState: boolean,
  savedCareersOnly = false,
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
      outcome: "unresolved",
      provider: null,
      confidence: "none",
      rejectionReason: "invalid_or_non_https_employer_website",
      feedComplete: false,
      snapshotAuthority: false,
      unknownDomains: [],
    }];
  }

  const employerDeadline = Date.now() + EMPLOYER_DEADLINE_MS;
  const { pages, attempts: pageAttempts } = await pagesForEmployer(
    employer,
    employerDeadline,
    helpers,
    noHostState,
    savedCareersOnly,
  );
  const operatorEvidenceAttempts = pageAttempts.filter(
    (attempt) => attempt.source === "operator_supplied_first_party_evidence",
  );
  const baseOperatorEvidenceOutcome = classifyOperatorEvidenceOutcome({
    provided: (employer.operator_evidence_urls ?? []).length > 0,
    verified: false,
    attempts: operatorEvidenceAttempts,
  });
  const candidates = new Map<string, Candidate>();
  const rejections: string[] = [];
  const unknownDomains = new Set<string>();
  for (const page of pages) {
    for (const source of publicSources(page.body, page.url)) {
      const provider = providerForHost(source.url.hostname);
      if (!provider) {
        if (!isFirstPartyEvidenceHost(source.url.hostname, root.hostname) && recruitmentSignal(source)) {
          unknownDomains.add(source.url.hostname.toLowerCase());
        }
        continue;
      }
      const candidateUrl = new URL(source.url);
      candidateUrl.search = "";
      candidateUrl.hash = "";
      const mapping = helpers.parseDirectBoardMapping(provider, candidateUrl.toString(), {
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
        discoveryRoute: page.source,
      };
      candidates.set(`${candidate.provider}:${candidate.boardId.toLowerCase()}`, candidate);
    }
  }

  const candidateAttempts: Array<Record<string, unknown>> = [];
  for (const candidate of candidates.values()) {
    if (Date.now() >= employerDeadline) break;
    const feed = await helpers.discoverCompanySiteVacancies(
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
        noHostState,
        deadlineMs: employerDeadline,
      },
    );
    const identity = feed.directFeedIdentity;
    const identityEvidence = {
      status: "verified_feed",
      feedComplete: feed.completion === "complete" && feed.atsCompleted,
      identityVerified: identity?.status === "matched",
      feedIdentityStatus: identity?.status ?? "unproven",
      identityClaims: identity?.claims ?? [],
      advertsExtracted: feed.advertsExtracted,
      advertsAccepted: feed.adverts.length,
    };
    const verified = helpers.hasPositiveAtsFeedEvidence(identityEvidence, employer.organisation_name);
    const attempt = {
      provider: candidate.provider,
      discoveryRoute: candidate.discoveryRoute,
      boardId: candidate.boardId,
      careersUrl: safePathUrl(candidate.careersUrl),
      evidenceUrl: safePathUrl(candidate.evidenceUrl),
      feedComplete: identityEvidence.feedComplete,
      feedIdentityStatus: identityEvidence.feedIdentityStatus,
      identityVerified: identityEvidence.identityVerified,
      identityClaims: identityEvidence.identityClaims,
      advertsExtracted: feed.advertsExtracted,
      advertsAccepted: feed.adverts.length,
      feedErrorCategory: feed.error ? safeErrorCategory(feed.error) : null,
      rejectionReason: verified
        ? null
        : identity?.reason ??
          (feed.adverts.length === 0
            ? "empty_feed_no_valid_listings"
            : feed.completion !== "complete" || !feed.atsCompleted
              ? "feed_not_complete"
              : "feed_identity_not_proven"),
    };
    candidateAttempts.push(attempt);
    if (!verified) continue;

    const operatorEvidenceOutcome = classifyOperatorEvidenceOutcome({
      provided: (employer.operator_evidence_urls ?? []).length > 0,
      verified: candidate.discoveryRoute === "operator_supplied_first_party_evidence",
      attempts: operatorEvidenceAttempts,
    });
    return [{
      ...common,
      status: "verified_feed",
      outcome: "verified_ats_feed",
      discoveryRoute: candidate.discoveryRoute,
      operatorEvidenceOutcome,
      operatorEvidenceAttempts,
      pageAttempts,
      provider: candidate.provider,
      boardId: candidate.boardId,
      careersUrl: safePathUrl(candidate.careersUrl),
      evidenceUrl: safePathUrl(candidate.evidenceUrl),
      confidence: "high",
      rejectionReason: null,
      feedComplete: identityEvidence.feedComplete,
      identityVerified: true,
      feedIdentityStatus: identityEvidence.feedIdentityStatus,
      identityClaims: identityEvidence.identityClaims,
      snapshotAuthority: Boolean(feed.snapshotScope),
      snapshotScope: feed.snapshotScope ?? null,
      pagesFetched: feed.pagesFetched,
      advertsExtracted: feed.advertsExtracted,
      advertsAccepted: feed.adverts.length,
      advertsRejected: feed.advertsRejected,
      feedErrorCategory: feed.error ? safeErrorCategory(feed.error) : null,
      feedOrigin: feed.discoveredUrls[0] ? safeOrigin(feed.discoveredUrls[0]) : null,
      candidateAttempts,
      unknownDomains: [...unknownDomains].sort(),
    }];
  }

  const fallbackSourceUrl = pages.find(
    (page) => page.source === "operator_supplied_first_party_evidence",
  )?.url ?? pages[0]?.url ?? null;
  let generic: Awaited<ReturnType<DiscoveryHelpers["discoverCompanySiteVacancies"]>> | null = null;
  if (fallbackSourceUrl && Date.now() < employerDeadline) {
    generic = await helpers.discoverCompanySiteVacancies(
      employer.organisation_name,
      fallbackSourceUrl,
      {
        checkGeneric: true,
        checkAts: false,
        readOnly: true,
        noHostState,
        noProcessCache: true,
        deadlineMs: employerDeadline,
      },
    );
    for (const link of generic.diagnostics.linksConsidered) {
      if (!["ats", "careers", "vacancy"].includes(link.category)) continue;
      try {
        const url = new URL(link.url);
        if (providerForHost(url.hostname) ||
            isFirstPartyEvidenceHost(url.hostname, root.hostname) ||
            !recruitmentSignal({ url, text: link.text, kind: "anchor" })) continue;
        unknownDomains.add(url.hostname.toLowerCase());
      } catch {
        // Diagnostics have already passed the crawler's URL validation.
      }
    }
  }

  const fallbackDiagnostics = generic?.diagnostics;
  const structuredSignal = Boolean(
    fallbackDiagnostics?.jsonLdJobPostingFound ||
    fallbackDiagnostics?.microdataJobPostingFound,
  );
  const observedUrls = new Set(
    (generic?.observedAdvertUrls ?? []).map((url) => url.replace(/\/$/, "")),
  );
  const sitemapVerifiedUrls = (fallbackDiagnostics?.sitemapCandidateUrls ?? [])
    .filter((url) => observedUrls.has(url.replace(/\/$/, "")));
  const structuredVerified = Boolean(structuredSignal && generic && generic.adverts.length > 0);
  const sitemapVerified = Boolean(!structuredVerified && sitemapVerifiedUrls.length > 0);
  const firstAttempt = candidateAttempts[0];
  const storedWasVerified = employer.ats_mapping_status === "verified";
  const mismatchReason = candidateAttempts.some(
    (attempt) => attempt.rejectionReason === "feed_identity_mismatch",
  ) ? "feed_identity_mismatch" : null;
  const missingReason = candidateAttempts.some(
    (attempt) => attempt.rejectionReason === "feed_identity_missing",
  ) ? "feed_identity_missing" : null;
  const firstAttemptReason = candidateAttempts
    .map((attempt) => attempt.rejectionReason)
    .find((reason): reason is string => typeof reason === "string" && reason.length > 0);
  let rejectionReason: string | null = mismatchReason ??
    missingReason ??
    firstAttemptReason ??
    (storedWasVerified
      ? "stored_mapping_not_confirmed_by_first_party_link"
      : rejections[0] ?? (unknownDomains.size > 0
        ? "unsupported_ats_domains_found"
        : "no_supported_ats_feed_link_on_saved_employer_pages"));
  if (structuredVerified) rejectionReason = null;
  else if (sitemapVerified) rejectionReason = null;
  else if (structuredSignal && (generic?.adverts.length ?? 0) === 0) {
    rejectionReason = "structured_jobposting_without_usable_listings";
  } else if (
    (fallbackDiagnostics?.sitemapCandidateUrls.length ?? 0) > 0 &&
    sitemapVerifiedUrls.length === 0
  ) {
    rejectionReason = "sitemap_job_urls_not_verified";
  } else if (!generic && Date.now() >= employerDeadline) {
    rejectionReason = "employer_deadline_reached_before_generic_fallback";
  } else if (savedCareersOnly && !fallbackSourceUrl) {
    rejectionReason = "saved_careers_page_unavailable";
  } else if (pages.length === 0 && operatorEvidenceAttempts.some(
    (attempt) => attempt.failureKind === "rate_limited",
  )) {
    rejectionReason = "operator_evidence_rate_limited";
  } else if (pages.length === 0 && operatorEvidenceAttempts.some(
    (attempt) => attempt.failureKind === "robots",
  )) {
    rejectionReason = "operator_evidence_robots_blocked";
  } else if (candidateAttempts.length === 0 && !rejections.length && unknownDomains.size === 0) {
    rejectionReason = fallbackDiagnostics?.pageFetches.find((fetch) => !fetch.fetched)?.failureKind
      ? `site_fetch_${fallbackDiagnostics.pageFetches.find((fetch) => !fetch.fetched)?.failureKind}`
      : baseOperatorEvidenceOutcome === "rate_limited"
        ? "operator_evidence_rate_limited"
        : baseOperatorEvidenceOutcome === "robots_blocked"
          ? "operator_evidence_robots_blocked"
          : "no_ats_structured_jobposting_or_sitemap_listings";
  }

  const outcome = structuredVerified
    ? "structured_job_postings"
    : sitemapVerified
      ? "sitemap_job_listings"
      : "unresolved";
  return [{
    ...common,
    status: structuredVerified
      ? "structured_job_postings"
      : sitemapVerified
        ? "sitemap_job_listings"
        : "no_verified_direct_feed",
    outcome,
    discoveryRoute: pages.find(
      (page) => page.source === "operator_supplied_first_party_evidence",
    ) ? "operator_supplied_first_party_evidence" : "employer_site",
    operatorEvidenceOutcome: baseOperatorEvidenceOutcome,
    operatorEvidenceAttempts,
    pageAttempts,
    provider: typeof firstAttempt?.provider === "string"
      ? firstAttempt.provider
      : employer.ats_provider,
    boardId: typeof firstAttempt?.boardId === "string"
      ? firstAttempt.boardId
      : employer.ats_board_id,
    careersUrl: typeof firstAttempt?.careersUrl === "string"
      ? firstAttempt.careersUrl
      : safeOrigin(employer.careers_url),
    evidenceUrl: typeof firstAttempt?.evidenceUrl === "string"
      ? firstAttempt.evidenceUrl
      : safeOrigin(employer.ats_mapping_evidence_url),
    confidence: structuredVerified || sitemapVerified ? "medium" : "none",
    rejectionReason,
    feedComplete: false,
    identityVerified: false,
    feedIdentityStatus: firstAttempt?.feedIdentityStatus ?? "unproven",
    identityClaims: firstAttempt?.identityClaims ?? [],
    snapshotAuthority: false,
    pagesFetched: generic?.pagesFetched ?? pages.length,
    advertsExtracted: generic?.advertsExtracted ?? 0,
    advertsAccepted: generic?.adverts.length ?? 0,
    genericSignals: {
      jsonLdJobPostingFound: fallbackDiagnostics?.jsonLdJobPostingFound ?? false,
      microdataJobPostingFound: fallbackDiagnostics?.microdataJobPostingFound ?? false,
      sitemapChecked: fallbackDiagnostics?.sitemapChecked ?? false,
      sitemapDocuments: fallbackDiagnostics?.sitemapDocuments ?? [],
      sitemapCandidateUrls: fallbackDiagnostics?.sitemapCandidateUrls ?? [],
      sitemapVerifiedUrls,
      pagesFetched: generic?.pagesFetched ?? 0,
    },
    candidateAttempts,
    unknownDomains: [...unknownDomains].sort(),
  }];
}

type ProofRowCounts = {
  companySiteCheckRows: string;
  verifiedMappingRows: string;
  sponsorVacancyRows: string;
  companySiteVacancyRows: string;
};

type ProofSnapshot = {
  identity: DatabaseIdentity;
  countsBefore: ProofRowCounts;
  countsAfterInTransaction: ProofRowCounts;
  employers: EmployerRow[];
};

async function readProofRowCounts(
  database: Pick<typeof import("@workspace/db").db, "execute">,
): Promise<ProofRowCounts> {
  const result = await database.execute<{
    company_site_check_rows: string;
    verified_mapping_rows: string;
    sponsor_vacancy_rows: string;
    company_site_vacancy_rows: string;
  }>(sql`
    SELECT
      (SELECT count(*) FROM sponsor_licence_company_site_checks)::text
        AS company_site_check_rows,
      (SELECT count(*)
       FROM sponsor_licence_company_site_checks
       WHERE ats_mapping_status = 'verified')::text AS verified_mapping_rows,
      (SELECT count(*) FROM sponsor_licence_vacancies)::text AS sponsor_vacancy_rows,
      (SELECT count(*)
       FROM sponsor_licence_vacancies
       WHERE source_type = 'company_site')::text AS company_site_vacancy_rows
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Unable to read production proof row counts.");
  return {
    companySiteCheckRows: String(row.company_site_check_rows),
    verifiedMappingRows: String(row.verified_mapping_rows),
    sponsorVacancyRows: String(row.sponsor_vacancy_rows),
    companySiteVacancyRows: String(row.company_site_vacancy_rows),
  };
}

function proofCountsMatch(left: ProofRowCounts, right: ProofRowCounts): boolean {
  return left.companySiteCheckRows === right.companySiteCheckRows &&
    left.verifiedMappingRows === right.verifiedMappingRows &&
    left.sponsorVacancyRows === right.sponsorVacancyRows &&
    left.companySiteVacancyRows === right.companySiteVacancyRows;
}

async function runProductionProofTransaction(
  database: Pick<typeof import("@workspace/db").db, "transaction">,
  scope: {
    limit: number;
    healthcareOnly: boolean;
    savedCareersOnly: boolean;
    cooldownDays: number;
  },
  expectedFingerprint?: string,
): Promise<ProofSnapshot> {
  return database.transaction(async (tx) => {
    // The transaction is short: it only selects the employer batch and counts.
    // External HTTP checks run after it closes, so a 200-employer batch does not
    // hold a production snapshot open while waiting on employer websites.
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const identity = await assertProductionProofReadOnly(tx);
    if (expectedFingerprint && identity.fingerprint !== expectedFingerprint.toLowerCase()) {
      throw new Error("Connected database does not match the independently confirmed fingerprint.");
    }
    const writeGuards = verifyProductionWriteGuards("production-proof-readonly");
    if (!writeGuards.mappingWritesBlocked || !writeGuards.vacancyWritesBlocked) {
      throw new Error("Production proof could not verify application write guards.");
    }
    const countsBefore = await readProofRowCounts(tx);
    const employers = await selectEmployersFromTransaction(
      tx,
      scope.limit,
      undefined,
      scope.healthcareOnly,
      scope.savedCareersOnly,
      scope.cooldownDays,
    );
    const countsAfterInTransaction = await readProofRowCounts(tx);
    if (!proofCountsMatch(countsBefore, countsAfterInTransaction)) {
      throw new Error("Read-only employer selection changed production row counts.");
    }
    return { identity, countsBefore, countsAfterInTransaction, employers };
  });
}

async function main(): Promise<void> {
  const args = argsMap(process.argv.slice(2));
  const proofOutput = args.get("proof-output");
  let loadedInput: LoadedEmployerInput | undefined;
  let databasePool: { end: () => Promise<void> } | undefined;
  let context: ReturnType<typeof prepareDatabaseContext> | undefined;
  let identity: DatabaseIdentity | undefined;
  let developmentStateAccessed = false;
  let preflightOnly = false;
  let discoveryStarted = false;
  try {
    const runOptions = parseDiscoveryExecutionOptions(args, {
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
      defaultCooldownDays: DEFAULT_COOLDOWN_DAYS,
    });
    const {
      preflightOnly: isPreflightOnly,
      format,
      limit,
      cooldownDays,
      organisationNames,
      noHostState,
      healthcareOnly = runOptions.healthcareOnly ?? true,
      savedCareersOnly = runOptions.savedCareersOnly ?? false,
    } = runOptions;
    if (!healthcareOnly) {
      throw new Error("The healthcare employer source detector cannot run outside healthcare scope.");
    }
    preflightOnly = isPreflightOnly;
    loadedInput = !isPreflightOnly && args.get("input-file")
      ? await loadEmployerInput(args.get("input-file")!)
      : undefined;
    developmentStateAccessed = loadedInput?.sourceEnvironment === "development";
    context = prepareDatabaseContext(args, process.env, loadedInput?.sourceEnvironment);
    developmentStateAccessed ||= context.mode === "development";
    installDatabaseContext(context);

    // Import the singleton only after the selected connection URL and read-only
    // pool mode have been installed. All later DB imports resolve to this context.
    const databaseModule = await import("@workspace/db");
    databasePool = databaseModule.pool;

    if (context.mode === "production-proof-readonly") {
      discoveryStarted = true;
      const proof = await runProductionProofTransaction(
        databaseModule.db,
        { limit, healthcareOnly, savedCareersOnly, cooldownDays },
        context.expectedFingerprint,
      );
      identity = proof.identity;
      const rowCountsUnchanged = proofCountsMatch(
        proof.countsBefore,
        proof.countsAfterInTransaction,
      );
      const http = await import("../lib/companySiteHttp");
      const discovery = await import("../lib/companySiteDiscovery");
      const connectors = await import("../lib/directEmployerBoardConnectors");
      http.resetCompanySiteEphemeralState();
      const helpers: DiscoveryHelpers = {
        discoverCompanySiteVacancies: discovery.discoverCompanySiteVacancies,
        fetchCompanySitePage: http.fetchCompanySitePage,
        parseDirectBoardMapping: connectors.parseDirectBoardMapping,
        hasPositiveAtsFeedEvidence: connectors.hasPositiveAtsFeedEvidence,
      };
      const records: Record<string, unknown>[] = [];
      for (const employer of proof.employers) {
        records.push(...await discoverEmployer(
          employer,
          helpers,
          noHostState,
          savedCareersOnly,
        ));
      }
      const summary = summarizeRecords(records);
      const mappingsFound = summary.employersByOutcome.verified_ats_feed;
      const mappingsRejected = summary.employersByOutcome.unresolved;
      const report = {
        version: OUTPUT_VERSION,
        status: rowCountsUnchanged ? "proof_passed" : "count_drift",
        environment: "production",
        dbMode: context.mode,
        mode: "production_readonly_ats_discovery_proof",
        generatedAt: new Date().toISOString(),
        limit,
        cooldownDays,
        scope: {
          healthcareOnly,
          savedCareersOnly,
          selector: HEALTHCARE_SELECTOR,
          careersUrlOnly: savedCareersOnly,
        },
        selectedEmployers: proof.employers.length,
        employersChecked: proof.employers.length,
        mappingsFound,
        mappingsRejected,
        sourceDetectionSummary: summary,
        writesAttempted: 0,
        writePathCalled: false,
        writePathCalls: 0,
        mappingPromotions: 0,
        vacancyImports: 0,
        selectionTransactionReadOnly: true,
        rowCounts: {
          before: proof.countsBefore,
          afterInSelectionTransaction: proof.countsAfterInTransaction,
          unchanged: rowCountsUnchanged,
        },
        safety: {
          dbMode: context.mode,
          nodeEnvironment: context.nodeEnvironment,
          database: {
            host: identity.databaseHost,
            name: identity.databaseName,
            role: identity.roleName,
            fingerprint: identity.fingerprint,
          },
          expectedFingerprintMatched: context.expectedFingerprint
            ? identity.fingerprint === context.expectedFingerprint.toLowerCase()
            : null,
          transactionReadOnly: identity.transactionReadOnly,
          defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
          rolePrivileges: {
            isSuperuser: identity.roleIsSuperuser,
            canAdminister: identity.roleCanAdminister,
            hasDmlPrivileges: identity.roleHasWritePrivileges,
            canCreateSchema: identity.roleCanCreateSchema,
            canCreateDatabaseObjects: identity.roleCanCreateDatabaseObjects,
            canCreateTemporaryObjects: identity.roleCanCreateTemporaryObjects,
            ownsDatabase: identity.roleOwnsDatabase,
            ownsApplicationObjects: identity.roleOwnsApplicationObjects,
            hasWriteAllDataRole: identity.roleHasWriteAllData,
          },
          writeModeDisabled: true,
          productionWritesDisabled: true,
          employerInputSource: "production database query",
          mappingCheckStateSource: "same production database; company-site check fields",
          hostStateSource: "disabled; no host-state database reads or writes",
          cacheStateSource: "no disk/persistent cache writes; process-local pacing and robots cache only",
          developmentStateAccessed: false,
          assertions: {
            expectedFingerprintMatched: context.expectedFingerprint
              ? identity.fingerprint === context.expectedFingerprint.toLowerCase()
              : null,
            productionConnectionProvidedThroughProofSecret: true,
            transactionReadOnlyVerified: identity.transactionReadOnly === "on",
            defaultTransactionReadOnlyVerified:
              identity.defaultTransactionReadOnly === "on",
            selectionTransactionReadOnly: true,
            noProductionReportSaverCalled: true,
            noPersistentHostStateWrites: true,
            noPersistentCacheWrites: true,
            noDevelopmentStateAccess: true,
            noMappingPromotionPathCalled: true,
            noVacancyPersistencePathCalled: true,
          },
        },
        records,
      };
      if (proofOutput) {
        const outputPath = resolve(proofOutput);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    if (!context.expectedFingerprint) {
      throw new Error("This database mode requires an expected database fingerprint.");
    }
    identity = await assertDatabaseMode(
      databaseModule.db,
      context.mode,
      context.expectedFingerprint,
    );

    if (isPreflightOnly) {
      const writeGuards = verifyProductionWriteGuards(context.mode);
      if (!writeGuards.mappingWritesBlocked || !writeGuards.vacancyWritesBlocked) {
        throw new Error("Production preflight could not verify all application write guards.");
      }
      const report = {
        version: OUTPUT_VERSION,
        status: "preflight_passed",
        environment: context.sourceEnvironment,
        dbMode: context.mode,
        mode: "production_readonly_preflight",
        generatedAt: new Date().toISOString(),
        limit: 0,
        selectedEmployers: 0,
        employersChecked: 0,
        networkRequests: 0,
        writesAttempted: 0,
        mappingPromotions: 0,
        vacancyImports: 0,
        safety: {
          dbMode: context.mode,
          nodeEnvironment: context.nodeEnvironment,
          database: {
            host: identity.databaseHost,
            name: identity.databaseName,
            role: identity.roleName,
            fingerprint: identity.fingerprint,
          },
          expectedFingerprintMatched: true,
          transactionReadOnly: identity.transactionReadOnly,
          defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
          readOnlyRoleVerified: true,
          roleNonWritableVerified: true,
          rolePrivileges: {
            isSuperuser: identity.roleIsSuperuser,
            canAdminister: identity.roleCanAdminister,
            hasDmlPrivileges: identity.roleHasWritePrivileges,
            canCreateSchema: identity.roleCanCreateSchema,
            canCreateDatabaseObjects: identity.roleCanCreateDatabaseObjects,
            canCreateTemporaryObjects: identity.roleCanCreateTemporaryObjects,
            ownsDatabase: identity.roleOwnsDatabase,
            ownsApplicationObjects: identity.roleOwnsApplicationObjects,
            hasWriteAllDataRole: identity.roleHasWriteAllData,
          },
          writeModeDisabled: true,
          productionWritesDisabled: true,
          employerInputSource: "not accessed (preflight-only)",
          mappingCheckStateSource: "not accessed",
          hostStateSource: "not accessed (preflight-only)",
          cacheStateSource: "not loaded (preflight-only)",
          developmentStateAccessed: false,
          assertions: {
            databaseFingerprintMatchesMode: true,
            productionReadOnlyRoleAndSessionVerified: true,
            zeroEmployersSelected: true,
            noEmployerInputLoaded: true,
            noDiscoveryNetworkAccess: true,
            noHostStateAccess: true,
            noDevelopmentStateAccess: true,
            mappingWriteGuardBlocks: writeGuards.mappingWritesBlocked,
            vacancyWriteGuardBlocks: writeGuards.vacancyWritesBlocked,
          },
        },
      };
      if (proofOutput) {
        const outputPath = resolve(proofOutput);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    discoveryStarted = true;
    const http = await import("../lib/companySiteHttp");
    const discovery = await import("../lib/companySiteDiscovery");
    const connectors = await import("../lib/directEmployerBoardConnectors");
    http.resetCompanySiteEphemeralState();
    const helpers: DiscoveryHelpers = {
      discoverCompanySiteVacancies: discovery.discoverCompanySiteVacancies,
      fetchCompanySitePage: http.fetchCompanySitePage,
      parseDirectBoardMapping: connectors.parseDirectBoardMapping,
      hasPositiveAtsFeedEvidence: connectors.hasPositiveAtsFeedEvidence,
    };

    let employers = loadedInput
      ? loadedInput.employers
      : await selectEmployers(
          databaseModule.db,
          limit,
          organisationNames,
          healthcareOnly,
          savedCareersOnly,
          cooldownDays,
        );
    if (loadedInput) {
      employers = employers.filter((employer) =>
        matchesHealthcareSelector(employer.industry, employer.organisation_name),
      );
      if (savedCareersOnly) {
        employers = employers.filter((employer) => Boolean(employer.careers_url?.trim()));
      }
    }
    if (loadedInput && organisationNames) {
      const names = new Set(organisationNames.map((name) => name.trim().toLowerCase()));
      employers = employers.filter((employer) =>
        names.has(employer.organisation_name.trim().toLowerCase()),
      );
    }
    employers = employers.slice(0, limit);

    const records: Record<string, unknown>[] = [];
    for (const employer of employers) {
      records.push(...await discoverEmployer(
        employer,
        helpers,
        noHostState,
        savedCareersOnly,
      ));
    }
    const summary = summarizeRecords(records);
    const employerInputSource = loadedInput
      ? {
          type: "input-file",
          path: loadedInput.path,
          sha256: loadedInput.sha256,
          declaredEnvironment: loadedInput.sourceEnvironment,
          declaredSource: loadedInput.sourceDescription,
        }
      : {
          type: "database-query",
          declaredEnvironment: context.sourceEnvironment,
          declaredSource: "sponsor_licences joined to company_site_checks",
        };
    const safety = {
      dbMode: context.mode,
      nodeEnvironment: context.nodeEnvironment,
      database: {
        host: identity.databaseHost,
        name: identity.databaseName,
        role: identity.roleName,
        fingerprint: identity.fingerprint,
      },
      expectedFingerprintMatched: true,
      transactionReadOnly: identity.transactionReadOnly,
      defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
      readOnlyRoleVerified: context.mode === "production-readonly",
      roleNonWritableVerified: context.mode === "production-readonly",
      rolePrivileges: {
        isSuperuser: identity.roleIsSuperuser,
        canAdminister: identity.roleCanAdminister,
        hasDmlPrivileges: identity.roleHasWritePrivileges,
        canCreateSchema: identity.roleCanCreateSchema,
        canCreateDatabaseObjects: identity.roleCanCreateDatabaseObjects,
        canCreateTemporaryObjects: identity.roleCanCreateTemporaryObjects,
        ownsDatabase: identity.roleOwnsDatabase,
        ownsApplicationObjects: identity.roleOwnsApplicationObjects,
        hasWriteAllDataRole: identity.roleHasWriteAllData,
      },
      writeModeDisabled: true,
      productionWritesDisabled: context.mode !== "development",
      employerInputSource,
      mappingCheckStateSource: loadedInput
        ? `declared input-file rows (${loadedInput.sourceEnvironment})`
        : `same ${context.mode} database; company-site check fields`,
      hostStateSource: noHostState
        ? "disabled; no host-state database reads or writes; per-process state only"
        : `same ${context.mode} database for read-only host state`,
      cacheStateSource: "no disk cache/state files; per-process caches cleared at run start",
      developmentStateAccessed,
      assertions: {
        databaseFingerprintMatchesMode: true,
        inputSourceMatchesDatabaseMode: true,
        noDiscoveryPersistence: true,
        noProductionReportSaverCalled: true,
        noPersistentHostStateWrites: noHostState,
        noPersistentCacheWrites: true,
        productionReadOnlyRoleAndSessionVerified: context.mode === "production-readonly",
        hostStateDisabled: noHostState,
        developmentStateNotAccessed: !developmentStateAccessed,
      },
    };
    const report = {
      version: OUTPUT_VERSION,
      status: "complete",
      environment: context.sourceEnvironment,
      dbMode: context.mode,
      mode: "read_only_ats_discovery",
      generatedAt: new Date().toISOString(),
      limit,
      cooldownDays,
      scope: {
        healthcareOnly,
        savedCareersOnly,
        selector: HEALTHCARE_SELECTOR,
        careersUrlOnly: savedCareersOnly,
      },
      selectedEmployers: employers.length,
      employersChecked: employers.length,
      sourceDetectionSummary: summary,
      writesAttempted: 0,
      mappingPromotions: 0,
      vacancyImports: 0,
      safety,
      records,
    };
    if (proofOutput) {
      const outputPath = resolve(proofOutput);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    if (format === "json") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    const headers = [
      "dbMode", "databaseHost", "databaseName", "databaseFingerprint",
      "writeModeDisabled", "employerInputSource", "mappingCheckStateSource",
      "hostStateSource", "employerKey", "organisationName", "websiteOrigin",
      "outcome", "status", "provider", "boardId", "careersUrl", "evidenceUrl", "confidence",
      "rejectionReason", "feedComplete", "identityVerified", "feedIdentityStatus",
      "identityClaims", "snapshotAuthority", "pagesFetched",
      "advertsExtracted", "advertsAccepted", "advertsRejected", "feedErrorCategory",
      "feedOrigin", "unknownDomains",
    ];
    const safetyColumns = {
      dbMode: safety.dbMode,
      databaseHost: identity.databaseHost,
      databaseName: identity.databaseName,
      databaseFingerprint: identity.fingerprint,
      writeModeDisabled: safety.writeModeDisabled,
      employerInputSource,
      mappingCheckStateSource: safety.mappingCheckStateSource,
      hostStateSource: safety.hostStateSource,
    };
    process.stdout.write(`${headers.map(csvCell).join(",")}\n`);
    for (const record of records) {
      process.stdout.write(`${headers.map((key) => csvCell(
        Object.hasOwn(safetyColumns, key)
          ? safetyColumns[key as keyof typeof safetyColumns]
          : record[key],
      )).join(",")}\n`);
    }
  } catch (error) {
    if (proofOutput) {
      try {
        const blockedReport = {
          version: OUTPUT_VERSION,
          status: "blocked",
          ...(preflightOnly
            ? {
                mode: "production_readonly_preflight",
                limit: 0,
                selectedEmployers: 0,
                networkRequests: 0,
              }
            : {}),
          dbMode: args.get("db-mode") ?? null,
          employersChecked: 0,
          writesAttempted: 0,
          mappingPromotions: 0,
          vacancyImports: 0,
          safety: {
            nodeEnvironment: process.env.NODE_ENV ?? null,
            database: identity
              ? {
                  host: identity.databaseHost,
                  name: identity.databaseName,
                  role: identity.roleName,
                  fingerprint: identity.fingerprint,
                }
              : null,
            writeModeDisabled: true,
            productionWritesDisabled: args.get("db-mode") !== "development",
            employerInputSource: loadedInput
              ? {
                  type: "input-file",
                  path: loadedInput.path,
                  sha256: loadedInput.sha256,
                  declaredEnvironment: loadedInput.sourceEnvironment,
                  declaredSource: loadedInput.sourceDescription,
                }
              : args.get("input-file")
                ? { type: "input-file", path: resolve(args.get("input-file")!) }
                : "not accessed",
            mappingCheckStateSource: "not accessed",
            hostStateSource: "not accessed",
            cacheStateSource: "not accessed",
            developmentStateAccessed,
            failedBeforeDiscovery: !discoveryStarted,
          },
          blockedReason: safeToolErrorSummary(error),
        };
        const outputPath = resolve(proofOutput);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(blockedReport, null, 2)}\n`, "utf8");
      } catch {
        // Preserve the original fail-closed error if a local proof file cannot be written.
      }
    }
    throw error;
  } finally {
    await databasePool?.end();
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