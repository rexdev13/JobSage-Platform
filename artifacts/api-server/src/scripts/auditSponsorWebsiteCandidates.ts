import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  InsertSponsorLicenceWebsiteEnrichmentAudit,
  SponsorWebsiteAuditCandidate,
  SponsorWebsiteConfidence,
} from "@workspace/db";
import {
  fetchCompanySitePage,
  isAllowedCompanyDestination,
  knownAtsProvider,
} from "../lib/companySiteHttp";
import { inspectCompanySiteProbePage } from "../lib/companySiteDiscovery";
import { parseDirectBoardMapping } from "../lib/directEmployerBoardConnectors";
import { corroboratesEmployer } from "../lib/contactEnrichmentRunner";
import {
  persistSponsorWebsiteAuditRun,
  sponsorOrganisationKey,
} from "../lib/sponsorWebsiteEnrichmentAudit";

type AuditRow = {
  organisation_name: string;
  sample_group: string;
  industry: string | null;
  sector: string;
  town_city: string | null;
  website: string | null;
  careers_url: string | null;
};

type EmployerInput = {
  row: AuditRow;
  queries: string[];
  candidates: SponsorWebsiteAuditCandidate[];
};

type TargetInput = {
  url: string;
  organisationName: string;
  sampleGroup: string;
  sector: string;
  townCity: string | null;
  storedWebsiteUrl: string | null;
  storedCareersUrl: string | null;
  candidateTitle: string;
  searchScore: number;
  searchConfidence: SponsorWebsiteConfidence;
  sourceType: "stored_website" | "official_site";
  reasons: string[];
};

type AuditInput = {
  runId: string;
  employers: EmployerInput[];
  targets: TargetInput[];
};

type AtsEvidence = {
  provider: string;
  boardId: string | null;
  url: string;
  status: "verified" | "unverified";
  evidenceUrl: string | null;
  supported: boolean;
};

type TargetOutcome = {
  target: TargetInput;
  fetched: boolean;
  pageUrl: string | null;
  pageTitle: string | null;
  identityVerified: boolean;
  geographyMismatch: boolean;
  websiteConfidence: SponsorWebsiteConfidence;
  careersUrl: string | null;
  careersConfidence: SponsorWebsiteConfidence;
  careersEvidenceUrl: string | null;
  ats: AtsEvidence | null;
  error: string | null;
  excerpt: string;
};

const ROOT = resolve(process.cwd(), "../..");
const AUDIT_DIR = resolve(ROOT, ".agents/outputs/sponsor-website-sample");
const INPUT_PATH = resolve(AUDIT_DIR, "audit-input.json");
const OUTPUT_PATH = resolve(AUDIT_DIR, "safe-page-results.json");
const CAREER_SIGNAL = /\b(careers?|jobs?|vacancies|recruit(?:ment|ing)?|join|work with us|opportunities|positions)\b/i;
const SUPPORTED_ATS = new Set(["Ashby", "Greenhouse", "Lever"]);
const OTHER_ATS: Array<{ provider: string; suffix: string }> = [
  { provider: "iCIMS", suffix: "icims.com" },
  { provider: "Teamtailor", suffix: "teamtailor.com" },
  { provider: "Personio", suffix: "personio.com" },
  { provider: "Workable", suffix: "workable.com" },
  { provider: "Jobvite", suffix: "jobvite.com" },
  { provider: "Recruitee", suffix: "recruitee.com" },
  { provider: "Breezy HR", suffix: "breezy.hr" },
  { provider: "SmartRecruiters", suffix: "smartrecruiters.com" },
  { provider: "Workday", suffix: "myworkdayjobs.com" },
  { provider: "Oracle Recruiting", suffix: "oraclecloud.com" },
  { provider: "Taleo", suffix: "taleo.net" },
  { provider: "SAP SuccessFactors", suffix: "successfactors.com" },
  { provider: "BambooHR", suffix: "bamboohr.com" },
  { provider: "Pinpoint", suffix: "pinpointhq.com" },
];
const US_LOCATION_MARKERS = /\b(?:united states|u\.s\.a\.|usa|massachusetts|california|texas|florida|illinois|pennsylvania|ohio|georgia|north carolina|south carolina|washington state|colorado|arizona|new jersey|minnesota|michigan|wisconsin)\b/i;
const UK_LOCATION_MARKERS = /\b(?:united kingdom|uk|england|scotland|wales|northern ireland)\b/i;

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html: string): string | null {
  const value = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return value ? stripHtml(value).slice(0, 240) : null;
}

function tradingName(name: string): string | null {
  return name.match(/\b(?:t\/a|trading\s+as)\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function matchesEmployer(html: string, organisationName: string): boolean {
  return corroboratesEmployer(html, organisationName) ||
    (!!tradingName(organisationName) && corroboratesEmployer(html, tradingName(organisationName)!));
}

function hasGeographyMismatch(html: string, townCity: string | null): boolean {
  const text = stripHtml(html);
  const city = townCity?.trim();
  const cityMentioned = !!city && new RegExp(
    `\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  ).test(text);
  return US_LOCATION_MARKERS.test(text) && !UK_LOCATION_MARKERS.test(text) && !cityMentioned;
}

function atsProviderForUrl(url: string): string | null {
  const known = knownAtsProvider(url);
  if (known) return known;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return OTHER_ATS.find(({ suffix }) => host === suffix || host.endsWith(`.${suffix}`))?.provider ?? null;
  } catch {
    return null;
  }
}

function boardIdFor(provider: string, url: string): string | null {
  const direct = parseDirectBoardMapping(provider, url);
  if (direct) return direct.boardId;
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean)
      .find((part) => !/^(?:jobs?|careers?|en-[a-z]{2}|candidateexperience|hcmui|apply)$/i.test(part));
    return segment ? decodeURIComponent(segment).slice(0, 180) : null;
  } catch {
    return null;
  }
}

function extractAtsLinks(html: string, baseUrl: string): Array<{ provider: string; url: string }> {
  const found: Array<{ provider: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const label = stripHtml(match[2] ?? "");
    let url: string;
    try {
      url = new URL(href.replace(/&amp;/gi, "&"), baseUrl).toString();
    } catch {
      continue;
    }
    const provider = atsProviderForUrl(url);
    if (!provider || !CAREER_SIGNAL.test(`${label} ${url}`)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ provider, url });
  }
  return found;
}

function makeAtsEvidence(
  provider: string,
  url: string,
  evidenceUrl: string | null,
  status: "verified" | "unverified",
): AtsEvidence {
  return {
    provider,
    boardId: boardIdFor(provider, url),
    url,
    status,
    evidenceUrl,
    supported: SUPPORTED_ATS.has(provider),
  };
}

function normaliseHttpsUrl(raw: string): string {
  const candidate = raw.trim().replace(/^http:/i, "https:");
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("candidate URL must be HTTPS and contain no credentials");
  }
  parsed.hash = "";
  return parsed.toString();
}

async function inspectTarget(target: TargetInput): Promise<TargetOutcome> {
  let url: string;
  let originHostname: string;
  try {
    url = normaliseHttpsUrl(target.url);
    originHostname = new URL(url).hostname;
    if (!isAllowedCompanyDestination(originHostname, url)) {
      throw new Error("candidate URL is outside the safe company-site destination policy");
    }
  } catch (error) {
    return {
      target,
      fetched: false,
      pageUrl: null,
      pageTitle: null,
      identityVerified: false,
      geographyMismatch: false,
      websiteConfidence: "low",
      careersUrl: null,
      careersConfidence: "none",
      careersEvidenceUrl: null,
      ats: null,
      error: error instanceof Error ? error.message : String(error),
      excerpt: "",
    };
  }

  const deadlineMs = Date.now() + 20_000;
  const page = await fetchCompanySitePage(url, originHostname, deadlineMs);
  if (!page.ok) {
    return {
      target,
      fetched: false,
      pageUrl: null,
      pageTitle: null,
      identityVerified: false,
      geographyMismatch: false,
      websiteConfidence: "low",
      careersUrl: null,
      careersConfidence: "none",
      careersEvidenceUrl: null,
      ats: null,
      error: `${page.kind}: ${page.reason}`,
      excerpt: "",
    };
  }

  const identityVerified = matchesEmployer(page.body, target.organisationName);
  const geographyMismatch = hasGeographyMismatch(page.body, target.townCity);
  const websiteConfidence: SponsorWebsiteConfidence = identityVerified && !geographyMismatch
    ? target.searchScore >= 5 ? "high" : "medium"
    : identityVerified ? "low" : "low";
  const outcome: TargetOutcome = {
    target,
    fetched: true,
    pageUrl: page.url,
    pageTitle: pageTitle(page.body),
    identityVerified,
    geographyMismatch,
    websiteConfidence,
    careersUrl: null,
    careersConfidence: "none",
    careersEvidenceUrl: null,
    ats: null,
    error: geographyMismatch
      ? "page contains strong non-UK location evidence inconsistent with the stored employer location"
      : identityVerified ? null : "official-page identity was not corroborated",
    excerpt: stripHtml(page.body).slice(0, 700),
  };

  if (!identityVerified || geographyMismatch) return outcome;

  const initialInspection = inspectCompanySiteProbePage(page.url, page.body);
  const linkedAts = extractAtsLinks(page.body, page.url);
  const directAts = linkedAts[0];
  if (directAts) {
    outcome.ats = makeAtsEvidence(directAts.provider, directAts.url, page.url, "verified");
    outcome.careersUrl = directAts.url;
    outcome.careersConfidence = "high";
    outcome.careersEvidenceUrl = page.url;
    return outcome;
  }

  const careersUrl = initialInspection.careersUrl;
  if (!initialInspection.hasCareersSignal || !careersUrl) return outcome;
  outcome.careersUrl = careersUrl;
  outcome.careersConfidence = "medium";
  outcome.careersEvidenceUrl = page.url;

  const providerFromUrl = atsProviderForUrl(careersUrl);
  if (providerFromUrl && initialInspection.atsMappingVerified) {
    outcome.ats = makeAtsEvidence(providerFromUrl, careersUrl, page.url, "verified");
    outcome.careersConfidence = "high";
    return outcome;
  }
  if (careersUrl === page.url) {
    outcome.careersConfidence = "high";
    outcome.careersEvidenceUrl = page.url;
    return outcome;
  }

  let careerPageUrl: string;
  try {
    careerPageUrl = normaliseHttpsUrl(careersUrl);
  } catch {
    return outcome;
  }
  if (atsProviderForUrl(careerPageUrl)) return outcome;
  if (!isAllowedCompanyDestination(originHostname, careerPageUrl)) return outcome;

  const careerPage = await fetchCompanySitePage(careerPageUrl, originHostname, deadlineMs);
  if (!careerPage.ok) {
    outcome.error = [outcome.error, `careers page ${careerPage.kind}: ${careerPage.reason}`]
      .filter(Boolean).join("; ");
    return outcome;
  }
  const careerInspection = inspectCompanySiteProbePage(careerPage.url, careerPage.body);
  const careerAts = extractAtsLinks(careerPage.body, careerPage.url)[0];
  outcome.careersUrl = careerPage.url;
  outcome.careersConfidence = "high";
  outcome.careersEvidenceUrl = careerPage.url;
  if (careerAts) {
    outcome.ats = makeAtsEvidence(careerAts.provider, careerAts.url, careerPage.url, "verified");
    outcome.careersUrl = careerAts.url;
    return outcome;
  }
  if (careerInspection.atsProvider && careerInspection.atsMappingVerified && careerInspection.careersUrl) {
    outcome.ats = makeAtsEvidence(
      careerInspection.atsProvider,
      careerInspection.careersUrl,
      careerPage.url,
      "verified",
    );
    outcome.careersUrl = careerInspection.careersUrl;
  }
  return outcome;
}

function bestOutcome(outcomes: TargetOutcome[]): TargetOutcome | null {
  return [...outcomes].sort((a, b) =>
    Number(b.identityVerified && !b.geographyMismatch) - Number(a.identityVerified && !a.geographyMismatch) ||
    b.target.searchScore - a.target.searchScore,
  )[0] ?? null;
}

function textExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("This sponsor website audit is development-only; set NODE_ENV=development.");
  }
  if (process.argv.includes("--persist-only")) {
    const saved = JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as {
      runId: string;
      records: InsertSponsorLicenceWebsiteEnrichmentAudit[];
    };
    if (!saved.runId || !Array.isArray(saved.records) || saved.records.length !== 100) {
      throw new Error(`Persist-only expected 100 saved audit rows; got ${saved.records?.length ?? 0}.`);
    }
    const records = saved.records.map((record) => ({
      ...record,
      checkedAt: record.checkedAt ? new Date(String(record.checkedAt)) : undefined,
    }));
    await persistSponsorWebsiteAuditRun(records);
    process.stdout.write(`${JSON.stringify({ runId: saved.runId, persistedRows: records.length })}\n`);
    return;
  }

  const input = JSON.parse(await readFile(INPUT_PATH, "utf8")) as AuditInput;
  if (!input.runId || input.employers.length !== 100) {
    throw new Error(`Expected one run ID and exactly 100 employers; got ${input.employers.length}.`);
  }
  const employerKeys = new Set(
    input.employers.map((employer) => sponsorOrganisationKey(employer.row.organisation_name)),
  );
  if (employerKeys.size !== 100) {
    throw new Error(`Expected 100 unique employer names; got ${employerKeys.size}.`);
  }

  const targetsByEmployer = new Map<string, TargetInput[]>();
  for (const target of input.targets) {
    const targetKey = sponsorOrganisationKey(target.organisationName);
    if (!targetKey || !employerKeys.has(targetKey)) {
      throw new Error(`Candidate target is missing or outside the 100-employer sample: ${target.organisationName}`);
    }
    const list = targetsByEmployer.get(targetKey) ?? [];
    list.push(target);
    targetsByEmployer.set(targetKey, list);
  }
  for (const targets of targetsByEmployer.values()) {
    targets.sort((a, b) =>
      Number(b.sourceType === "stored_website") - Number(a.sourceType === "stored_website") ||
      b.searchScore - a.searchScore,
    );
    if (targets.length > 5) {
      throw new Error(`Refusing to fetch ${targets.length} candidate URLs for one employer; expected at most 5.`);
    }
  }
  process.stdout.write(
    `Validated ${input.employers.length} unique employers and ${input.targets.length} candidate URLs across ${targetsByEmployer.size} employers.\n`,
  );

  const outcomes: TargetOutcome[] = [];
  let cursor = 0;
  let completedEmployers = 0;
  async function worker(): Promise<void> {
    while (cursor < input.employers.length) {
      const employer = input.employers[cursor++];
      if (!employer) continue;
      const targets = targetsByEmployer.get(sponsorOrganisationKey(employer.row.organisation_name)) ?? [];
      for (const target of targets) {
        const outcome = await inspectTarget(target);
        outcomes.push(outcome);
        if (outcome.identityVerified && !outcome.geographyMismatch && outcome.websiteConfidence === "high") {
          break;
        }
      }
      completedEmployers += 1;
      if (completedEmployers % 10 === 0 || completedEmployers === input.employers.length) {
        process.stdout.write(`Protected fetch checked ${completedEmployers}/${input.employers.length} employers.\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: 3 }, () => worker()));

  const records: InsertSponsorLicenceWebsiteEnrichmentAudit[] = [];
  for (const employer of input.employers) {
    const row = employer.row;
    const key = sponsorOrganisationKey(row.organisation_name);
    const employerOutcomes = outcomes.filter((outcome) =>
      sponsorOrganisationKey(outcome.target.organisationName) === key,
    );
    const primary = bestOutcome(employerOutcomes);
    const verified = employerOutcomes.filter((item) =>
      item.identityVerified && !item.geographyMismatch,
    );
    const distinctVerifiedHosts = new Set(verified.map((item) => {
      try { return new URL(item.pageUrl ?? "").hostname.toLowerCase().replace(/^www\./, ""); }
      catch { return ""; }
    }).filter(Boolean));
    const ambiguousVerifiedSites = distinctVerifiedHosts.size > 1;
    const websiteConfidence: SponsorWebsiteConfidence = !primary
      ? "none"
      : ambiguousVerifiedSites
        ? "medium"
        : primary.websiteConfidence;
    const websiteUrl = primary?.pageUrl
      ? `${new URL(primary.pageUrl).protocol}//${new URL(primary.pageUrl).host}/`
      : row.website;
    const websiteEvidenceUrl = primary?.identityVerified && !primary.geographyMismatch
      ? primary.pageUrl
      : null;

    const careerOutcome = employerOutcomes.find((item) =>
      item.careersConfidence === "high" && item.careersUrl,
    ) ?? employerOutcomes.find((item) => item.careersUrl);
    const searchAts = employer.candidates.find((candidate) =>
      candidate.sourceType === "supported_ats" || candidate.sourceType === "unsupported_ats",
    );
    const ats = employerOutcomes.find((item) => item.ats?.status === "verified")?.ats ??
      (searchAts
        ? makeAtsEvidence(
          atsProviderForUrl(searchAts.url) ??
            (searchAts.sourceType === "supported_ats" ? "supported ATS" : "unsupported ATS"),
          searchAts.url,
          null,
          "unverified",
        )
        : row.careers_url && atsProviderForUrl(row.careers_url)
          ? makeAtsEvidence(atsProviderForUrl(row.careers_url)!, row.careers_url, null, "unverified")
          : null);

    const candidateResults = [...employer.candidates];
    for (const outcome of employerOutcomes) {
      const url = outcome.target.url;
      const existing = candidateResults.find((candidate) => candidate.url === url);
      const verifiedReason = outcome.identityVerified && !outcome.geographyMismatch
        ? `Fetched through protected employer-site path; identity corroborated${outcome.pageUrl ? ` at ${outcome.pageUrl}` : ""}.`
        : `Protected fetch did not establish employer ownership${outcome.error ? `: ${outcome.error}` : "."}`;
      if (existing) {
        existing.confidence = outcome.websiteConfidence === "none" ? "low" : outcome.websiteConfidence;
        existing.reason = `${existing.reason}; ${verifiedReason}`;
      } else {
        candidateResults.push({
          url,
          hostname: new URL(url).hostname.toLowerCase().replace(/^www\./, ""),
          title: outcome.pageTitle ?? outcome.target.candidateTitle,
          snippet: textExcerpt(outcome.excerpt),
          sourceUrl: outcome.pageUrl ?? url,
          sourceType: "official_site",
          confidence: outcome.websiteConfidence === "none" ? "low" : outcome.websiteConfidence,
          reason: verifiedReason,
        });
      }
    }

    const classifications: string[] = [];
    if (websiteConfidence === "high") classifications.push("official_website_found");
    if (careerOutcome?.careersConfidence === "high") classifications.push("careers_page_found");
    if (websiteConfidence === "none" || websiteConfidence === "low") {
      classifications.push("no_website_found");
    }
    const searchedOfficial = employer.candidates.some((candidate) => candidate.sourceType === "official_site");
    const rejectedOfficial = employerOutcomes.some((item) =>
      item.fetched && (!item.identityVerified || item.geographyMismatch),
    );
    if (ambiguousVerifiedSites || rejectedOfficial || (searchedOfficial && websiteConfidence !== "high")) {
      classifications.push("ambiguous_wrong_company_risk");
    }
    if (
      websiteConfidence !== "high" &&
      employer.candidates.length > 0 &&
      employer.candidates.every((candidate) =>
        candidate.sourceType === "social" ||
        candidate.sourceType === "directory" ||
        candidate.sourceType === "aggregator" ||
        candidate.sourceType === "job_board" ||
        candidate.sourceType === "other",
      )
    ) {
      classifications.push("social_or_directory_only");
    }
    if (ats) {
      classifications.push(ats.supported ? "supported_ats_discovered" : "unsupported_ats_discovered");
      if (ats.status !== "verified") classifications.push("ats_mapping_unverified");
    }
    const uniqueClassifications = [...new Set(classifications)];
    const errors = employerOutcomes.map((item) => item.error).filter(Boolean).join(" | ").slice(0, 2_000);
    records.push({
      runId: input.runId,
      organisationKey: key,
      organisationName: row.organisation_name,
      sampleGroup: row.sample_group,
      sector: row.sector,
      townCity: row.town_city,
      existingWebsiteUrl: row.website,
      existingCareersUrl: row.careers_url,
      websiteUrl,
      websiteConfidence,
      websiteEvidenceUrl,
      careersUrl: careerOutcome?.careersUrl ?? row.careers_url,
      careersConfidence: careerOutcome?.careersConfidence ?? (row.careers_url ? "medium" : "none"),
      careersEvidenceUrl: careerOutcome?.careersEvidenceUrl ?? null,
      atsProvider: ats?.provider ?? null,
      atsBoardId: ats?.boardId ?? null,
      atsMappingStatus: ats?.status ?? null,
      atsMappingEvidenceUrl: ats?.evidenceUrl ?? null,
      classifications: uniqueClassifications,
      candidateResults,
      searchQueries: employer.queries,
      checkedAt: new Date(),
      lastError: errors || null,
    });
  }

  const output = {
    runId: input.runId,
    targetCount: input.targets.length,
    attemptedPageCount: outcomes.length,
    fetchedPageCount: outcomes.filter((item) => item.fetched).length,
    identityConfirmedCount: outcomes.filter((item) => item.identityVerified && !item.geographyMismatch).length,
    records,
    pageOutcomes: outcomes,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await persistSponsorWebsiteAuditRun(records);
  process.stdout.write(`${JSON.stringify({
    runId: input.runId,
    employers: records.length,
    attemptedPageCount: output.attemptedPageCount,
    fetchedPageCount: output.fetchedPageCount,
    identityConfirmedCount: output.identityConfirmedCount,
    websiteConfidence: records.reduce<Record<string, number>>((counts, record) => {
      const confidence = record.websiteConfidence ?? "none";
      counts[confidence] = (counts[confidence] ?? 0) + 1;
      return counts;
    }, {}),
    careersConfidence: records.reduce<Record<string, number>>((counts, record) => {
      const confidence = record.careersConfidence ?? "none";
      counts[confidence] = (counts[confidence] ?? 0) + 1;
      return counts;
    }, {}),
    atsMappings: records.reduce<Record<string, number>>((counts, record) => {
      const key = record.atsMappingStatus ?? "none";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});