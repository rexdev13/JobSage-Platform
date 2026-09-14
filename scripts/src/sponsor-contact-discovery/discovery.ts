import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCsv, parseCsvObjects, readCsvFile, writeCsvFile } from "./csv";
import { PublicSiteFetcher } from "./http";
import { acquireOfficialSources } from "./officialSources";
import type {
  DiscoveryRow,
  OfficialRecord,
  SponsorInput,
} from "./types";

export const DEFAULT_HOME_OFFICE_URL =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

const EMAIL =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+\s*(?:@|\[at\]|\(at\))\s*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\s*(?:\.|\[dot\]|\(dot\))\s*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const FREE_EMAILS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com",
]);
const BLOCKED_HOSTS = [
  "linkedin.com", "indeed.com", "facebook.com", "instagram.com", "x.com",
  "twitter.com", "yell.com", "glassdoor.com", "reed.co.uk", "jobs.nhs.uk",
  "gov.uk", "find-and-update.company-information.service.gov.uk",
];

function value(row: Record<string, string>, ...names: string[]): string {
  const found = Object.entries(row).find(([key]) =>
    names.some((name) => key.trim().toLowerCase() === name.toLowerCase()),
  );
  return found?.[1]?.trim() ?? "";
}

export function normaliseName(valueToNormalise: string): string {
  return valueToNormalise.toLowerCase()
    .replace(/\b(?:t\/a|trading\s+as|formerly)\b/g, " ")
    .replace(/\b(the|limited|ltd|plc|llp|cic|cio|group|uk|england|services|care|company|co|trade|name)\b/g, " ")
    .replace(/\s*&\s*|\band\b/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameVariants(raw: string): string[] {
  return [...new Set(raw
    .split(/\b(?:t\/a|trading\s+as|formerly)\b/i)
    .map((part) => normaliseName(part))
    .filter(Boolean))];
}

function normaliseTown(valueToNormalise: string): string {
  return valueToNormalise.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normaliseWebsite(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || !url.hostname.includes(".")) return "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function normaliseEmail(raw: string, website = ""): string {
  const cleaned = raw.toLowerCase().trim()
    .replace(/\[at\]|\(at\)|\{at\}|\s+at\s+/g, "@")
    .replace(/\[dot\]|\(dot\)|\{dot\}|\s+dot\s+/g, ".")
    .replace(/\s+/g, "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleaned)) return "";
  const [local, domain] = cleaned.split("@");
  if (!local || !domain || FREE_EMAILS.has(domain) || /^(?:no-?reply|donotreply)$/i.test(local)) return "";
  if (blockedHost(domain)) return "";
  if (website) {
    try {
      const siteHost = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
      if (domain !== siteHost && !domain.endsWith(`.${siteHost}`) && !siteHost.endsWith(`.${domain}`)) return "";
    } catch {
      return "";
    }
  }
  return cleaned;
}

function extractEmails(html: string, website: string): string[] {
  const mailtos = [...html.matchAll(/\bhref\s*=\s*["']mailto:([^"'?#\s]+)/gi)]
    .map((match) => decodeURIComponent(match[1] ?? ""));
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&commat;|&#64;/gi, "@");
  const candidates = [...mailtos, ...(visible.match(EMAIL) ?? [])];
  return [...new Set(candidates.map((candidate) => normaliseEmail(candidate, website)).filter(Boolean))];
}

function chooseEmail(emails: readonly string[]): string {
  return [...emails].sort((a, b) => {
    const score = (email: string) => /(?:recruit|career|job|hr)@/i.test(email) ? 3 :
      /(?:info|contact|admin)@/i.test(email) ? 2 : 1;
    return score(b) - score(a) || a.localeCompare(b);
  })[0] ?? "";
}

function inputFromRow(row: Record<string, string>): SponsorInput {
  return {
    organisationName: value(row, "organisation_name", "organisation name", "organisation", "name"),
    townCity: value(row, "town_city", "town/city", "town", "city"),
    county: value(row, "county"),
    industry: value(row, "industry", "sector", "type & rating", "type and rating"),
    website: normaliseWebsite(value(row, "website", "website_url", "schoolwebsite", "school website")),
    contactEmail: normaliseEmail(value(row, "contact_email", "contact email", "mainemail", "main email")),
    postcode: value(row, "postcode", "post code"),
  };
}

export async function officialRecordsFromFile(
  path: string,
  source: string,
  defaultEvidenceUrl = "",
): Promise<OfficialRecord[]> {
  const rows = await readOfficialRows(path);
  const records: OfficialRecord[] = [];
  for (const row of rows) {
    const providerName = value(row, "provider name");
    const locationName = value(row, "name");
    const organisationName = value(
      row,
      "organisation_name",
      "organisation name",
      "organisation",
      "establishmentname",
      "establishment name",
    ) || providerName || locationName;
    const townCity = value(row, "town_city", "town/city", "town", "city", "local authority") ||
      value(row, "address");
    const website = normaliseWebsite(value(
      row,
      "website",
      "website_url",
      "schoolwebsite",
      "school website",
      "service's website (if available)",
    ));
    const email = normaliseEmail(value(row, "contact_email", "contact email", "mainemail", "main email"), website);
    const evidenceUrl = value(row, "website_evidence_url", "evidence_url", "source_url") ||
      value(row, "location url", "locationurl", "school website") ||
      normaliseWebsite(value(row, "website", "website_url", "schoolwebsite", "school website")) ||
      defaultEvidenceUrl;
    const county = value(row, "county", "local authority");
    const postcode = value(row, "postcode", "post code");
    const makeRecord = (name: string, role: OfficialRecord["role"]): void => {
      if (!name) return;
      records.push({
        organisationName: name,
        townCity,
        county,
        postcode,
        website,
        email,
        source,
        evidenceUrl,
        role,
      });
    };
    if (source === "cqc" && providerName) {
      makeRecord(providerName, "provider");
      if (locationName && normaliseName(locationName) !== normaliseName(providerName)) {
        makeRecord(locationName, "location");
      }
    } else {
      makeRecord(organisationName, source === "gias" ? "education" : source.includes("charity") ? "charity" : undefined);
    }
  }
  return records;
}

async function readOfficialRows(path: string): Promise<Array<Record<string, string>>> {
  const rows = parseCsv(await readFile(path, "utf8"));
  const headerIndex = rows.findIndex((row) => {
    const headers = new Set(row.map((cell) => cell.trim().toLowerCase()));
    return headers.has("organisation_name") ||
      headers.has("provider name") ||
      headers.has("establishmentname") ||
      headers.has("establishment name") ||
      (headers.has("name") && (headers.has("website") || headers.has("service's website (if available)")));
  });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex]!.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  return rows.slice(headerIndex + 1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
  );
}

type OfficialMatch = {
  record: OfficialRecord;
  method: "exact_name" | "exact_name_town" | "fuzzy_name_town" | "provider_name" | "location_name";
  confidence: "high" | "medium";
  candidatesCount: number;
};

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size, 1);
}

function locationAgrees(input: SponsorInput, record: OfficialRecord): boolean {
  const town = normaliseTown(input.townCity);
  const county = normaliseTown(input.county);
  const postcode = normaliseTown(input.postcode);
  const sourceLocation = normaliseTown(`${record.townCity} ${record.county} ${record.postcode}`);
  return Boolean(
    (town && sourceLocation.includes(town)) ||
    (county && sourceLocation.includes(county)) ||
    (postcode && sourceLocation.includes(postcode)),
  );
}

function preferCandidate(candidates: OfficialRecord[]): OfficialRecord | null {
  const deduped = [...new Map(candidates.map((record) => [
    `${normaliseName(record.organisationName)}|${record.website}|${record.email}`,
    record,
  ])).values()];
  if (deduped.length === 1) return deduped[0]!;
  const providers = deduped.filter((record) => record.role === "provider");
  if (providers.length === 1) return providers[0]!;
  return null;
}

function findOfficialMatch(input: SponsorInput, records: readonly OfficialRecord[]): OfficialMatch | null {
  const inputNames = nameVariants(input.organisationName);
  const exact = records.filter((record) =>
    nameVariants(record.organisationName).some((name) => inputNames.includes(name)),
  );
  const candidate = preferCandidate(exact);
  if (candidate) {
    const method = candidate.role === "provider" ? "provider_name" :
      candidate.role === "location" ? "location_name" :
        locationAgrees(input, candidate) ? "exact_name_town" : "exact_name";
    return {
      record: candidate,
      method,
      confidence: "high",
      candidatesCount: exact.length,
    };
  }
  const town = normaliseTown(input.townCity);
  if (!town && !normaliseTown(input.county) && !normaliseTown(input.postcode)) return null;
  const fuzzy = records
    .filter((record) => locationAgrees(input, record))
    .map((record) => ({
      record,
      score: Math.max(...nameVariants(record.organisationName).map((name) =>
        Math.max(...inputNames.map((inputName) => tokenSimilarity(inputName, name))),
      )),
    }))
    .filter((candidate) => candidate.score >= 0.88)
    .sort((a, b) => b.score - a.score);
  if (fuzzy.length === 0 || (fuzzy[1] && fuzzy[0]!.score - fuzzy[1].score < 0.05)) return null;
  return {
    record: fuzzy[0]!.record,
    method: "fuzzy_name_town",
    confidence: "medium",
    candidatesCount: fuzzy.length,
  };
}

function category(input: SponsorInput): "social-care" | "education" | "nhs-public" | "other" {
  const text = `${input.industry} ${input.organisationName}`.toLowerCase();
  if (/\b(care|nursing|healthcare|home care)\b/.test(text)) return "social-care";
  if (/\b(school|college|university|academy|education)\b/.test(text)) return "education";
  if (/\b(nhs|hospital|council|council|public health|clinic)\b/.test(text)) return "nhs-public";
  return "other";
}

function choosePilot(inputs: readonly SponsorInput[], limit: number): SponsorInput[] {
  if (inputs.length <= limit) return [...inputs];
  const groups = new Map<string, SponsorInput[]>();
  for (const input of inputs) {
    const key = category(input);
    groups.set(key, [...(groups.get(key) ?? []), input]);
  }
  const ordered = ["social-care", "education", "nhs-public", "other"];
  const selected: SponsorInput[] = [];
  let cursor = 0;
  while (selected.length < limit) {
    const group = groups.get(ordered[cursor % ordered.length]!) ?? [];
    const candidate = group.shift();
    if (candidate) selected.push(candidate);
    if (ordered.every((key) => (groups.get(key)?.length ?? 0) === 0)) break;
    cursor += 1;
  }
  return selected;
}

async function bingWebsite(input: SponsorInput): Promise<{ website: string; evidenceUrl: string } | null> {
  const key = process.env.BING_SEARCH_API_KEY;
  if (!key) return null;
  const query = `official website "${input.organisationName}" ${input.townCity}`.trim();
  const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?${new URLSearchParams({ q: query, count: "10", safeSearch: "Strict" })}`, {
    headers: { "Ocp-Apim-Subscription-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const json = await response.json() as { webPages?: { value?: Array<{ url?: string; name?: string; snippet?: string }> } };
  for (const result of json.webPages?.value ?? []) {
    const website = normaliseWebsite(result.url ?? "");
    if (!website || blockedHost(new URL(website).hostname)) continue;
    const evidence = result.url ?? "";
    const token = normaliseName(input.organisationName).split(" ").find((part) => part.length >= 4);
    if (token && `${result.name ?? ""} ${result.snippet ?? ""}`.toLowerCase().includes(token)) {
      return { website, evidenceUrl: evidence };
    }
  }
  return null;
}

async function discoverOnWebsite(
  website: string,
  fetcher: PublicSiteFetcher,
): Promise<{ email: string; evidenceUrl: string; pages: number; error?: string }> {
  const site = new URL(website);
  const paths = ["", "/contact", "/careers", "/about"];
  let lastError = "";
  let pages = 0;
  for (const path of paths) {
    try {
      const page = await fetcher.fetch(new URL(path, site).toString(), site.hostname);
      pages += 1;
      const email = chooseEmail(extractEmails(page.body, website));
      if (email) return { email, evidenceUrl: page.url, pages };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { email: "", evidenceUrl: "", pages, error: lastError || undefined };
}

async function bingDomainEmail(
  website: string,
): Promise<{ email: string; evidenceUrl: string } | null> {
  const key = process.env.BING_SEARCH_API_KEY;
  if (!key) return null;
  const domain = new URL(website).hostname.replace(/^www\./, "");
  const query = `site:${domain} ("recruitment@" OR "careers@" OR "jobs@" OR "hr@" OR mailto:)`;
  const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?${new URLSearchParams({
    q: query,
    count: "10",
    safeSearch: "Strict",
  })}`, {
    headers: { "Ocp-Apim-Subscription-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const json = await response.json() as {
    webPages?: { value?: Array<{ url?: string; name?: string; snippet?: string }> };
  };
  for (const result of json.webPages?.value ?? []) {
    const evidenceUrl = result.url ?? "";
    const email = chooseEmail(extractEmails(`${result.name ?? ""} ${result.snippet ?? ""}`, website));
    if (email && evidenceUrl) return { email, evidenceUrl };
  }
  return null;
}

export async function loadSponsorInputs(
  inputPath: string | undefined,
  homeOfficeUrl = DEFAULT_HOME_OFFICE_URL,
): Promise<SponsorInput[]> {
  let rows: Array<Record<string, string>>;
  if (inputPath) {
    rows = await readCsvFile(inputPath);
  } else {
    const response = await fetch(homeOfficeUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Home Office register request failed: HTTP ${response.status}`);
    const body = await response.text();
    const csvUrl = body.match(
      /https?:\/\/assets\.publishing\.service\.gov\.uk\/[^"'\s]+\.csv/i,
    )?.[0];
    const csvResponse = await fetch(csvUrl ?? homeOfficeUrl, { signal: AbortSignal.timeout(60_000) });
    if (!csvResponse.ok) throw new Error(`Home Office CSV request failed: HTTP ${csvResponse.status}`);
    rows = parseCsvObjects(await csvResponse.text());
  }
  return rows.map(inputFromRow).filter((input) => input.organisationName);
}

export async function runDiscovery(options: {
  inputPath?: string;
  cqcPath?: string;
  giasPath?: string;
  charityPath?: string;
  homeOfficeUrl?: string;
  limit: number;
  delayMs: number;
  cacheDir: string;
  noAutoFetch: boolean;
}): Promise<{
  rows: DiscoveryRow[];
  rejected: Array<Record<string, string>>;
  warnings: string[];
  sourceUrls: Record<string, string>;
  summary: Record<string, unknown>;
}> {
  const sources = await acquireOfficialSources({
    cacheDir: options.cacheDir,
    cqcPath: options.cqcPath,
    giasPath: options.giasPath,
    charityPath: options.charityPath,
    noAutoFetch: options.noAutoFetch,
  });
  const inputs = choosePilot(
    await loadSponsorInputs(options.inputPath, options.homeOfficeUrl),
    options.limit,
  );
  const official = [
    ...(sources.cqcPath ? await officialRecordsFromFile(sources.cqcPath, "cqc", sources.sourceUrls.cqc) : []),
    ...(sources.giasPath ? await officialRecordsFromFile(sources.giasPath, "gias", sources.sourceUrls.gias) : []),
    ...(sources.charityPath ? await officialRecordsFromFile(sources.charityPath, "charity_commission", sources.sourceUrls.charity) : []),
  ];
  const fetcher = new PublicSiteFetcher(options.delayMs);
  const foundAt = new Date().toISOString();
  const output: DiscoveryRow[] = [];
  const rejected: Array<Record<string, string>> = [];

  for (const input of inputs) {
    const base: DiscoveryRow = {
      organisation_name: input.organisationName,
      town_city: input.townCity,
      county: input.county,
      industry: input.industry,
      website: input.website,
      website_source: input.website ? "input" : "",
      website_evidence_url: "",
      contact_email: input.contactEmail,
      contact_source: input.contactEmail ? "input" : "",
      contact_evidence_url: "",
      confidence: "",
      status: "no_website",
      match_method: "",
      match_confidence: "",
      match_candidates_count: "0",
      found_at: foundAt,
      notes: "",
    };
    if (input.contactEmail) {
      base.status = "skipped_existing";
      base.confidence = "high";
      base.notes = "Existing contact_email retained; no rediscovery performed.";
      output.push(base);
      continue;
    }

    let match = findOfficialMatch(input, official);
    if (!base.website && !match) {
      const searched = await bingWebsite(input);
      if (searched) {
        base.website = searched.website;
        base.website_source = "bing";
        base.website_evidence_url = searched.evidenceUrl;
        match = {
          record: {
            organisationName: input.organisationName,
            townCity: input.townCity,
            website: searched.website,
            email: "",
            source: "bing",
            evidenceUrl: searched.evidenceUrl,
          },
          method: "exact_name",
          confidence: "high",
          candidatesCount: 1,
        };
      }
    }
    if (match) {
      base.match_method = match.method;
      base.match_confidence = match.confidence;
      base.match_candidates_count = String(match.candidatesCount);
    }
    if (!base.website && match?.record.website) {
      base.website = match.record.website;
      base.website_source = match.record.source;
      base.website_evidence_url = match.record.evidenceUrl;
    }
    if (match?.record.email && (match.record.evidenceUrl || base.website_evidence_url)) {
      base.contact_email = normaliseEmail(match.record.email, base.website);
      base.contact_source = match.record.source;
      base.contact_evidence_url = match.record.evidenceUrl || base.website_evidence_url;
    }
    if (!base.website) {
      base.status = match ? "no_website" : "unmatched";
      base.confidence = "medium";
      base.notes = match
        ? "Official record matched, but no corroborated website was published."
        : "No unambiguous official-register match; no website guessed.";
      rejected.push({
        organisation_name: base.organisation_name,
        status: base.status,
        reason_code: match ? "no_website" : "unmatched",
        reason: base.notes,
      });
      output.push(base);
      continue;
    }
    if (!base.contact_email) {
      const discovered = await discoverOnWebsite(base.website, fetcher);
      if (discovered.email) {
        base.contact_email = discovered.email;
        base.contact_source = "website";
        base.contact_evidence_url = discovered.evidenceUrl;
        base.confidence = "high";
        base.status = "verified_email";
        base.notes = `Accepted published employer-domain email after checking ${discovered.pages} page(s).`;
      } else if (discovered.pages > 0) {
        const bing = await bingDomainEmail(base.website);
        if (bing) {
          base.contact_email = bing.email;
          base.contact_source = "bing";
          base.contact_evidence_url = bing.evidenceUrl;
          base.confidence = "high";
          base.status = "verified_email";
          base.notes = `Accepted published employer-domain email from a same-domain search result after checking ${discovered.pages} page(s).`;
        } else {
          base.status = "website_no_email";
          base.confidence = "medium";
          base.notes = "Confirmed website fetched, but no accepted public employer-domain email was found.";
        }
      } else {
        base.status = "no_public_contact";
        base.confidence = "medium";
        base.notes = `Website could not be safely fetched: ${discovered.error ?? "unknown fetch error"}.`;
      }
    } else {
      base.confidence = "high";
      base.status = "verified_email";
      base.notes ||= "Accepted email from an official register source.";
    }
    if (base.status !== "verified_email") {
      rejected.push({
        organisation_name: base.organisation_name,
        status: base.status,
        reason_code: base.status,
        reason: base.notes,
      });
    }
    output.push(base);
  }
  const statusCounts = output.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {});
  const sourceCounts = output.reduce<Record<string, number>>((counts, row) => {
    const source = row.contact_source || row.website_source || "none";
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
  return {
    rows: output,
    rejected,
    warnings: sources.warnings,
    sourceUrls: sources.sourceUrls,
    summary: {
      totalRows: output.length,
      matchedWebsites: output.filter((row) => row.website).length,
      verifiedEmail: output.filter((row) => row.status === "verified_email").length,
      unmatched: output.filter((row) => row.status === "unmatched").length,
      websiteNoEmail: output.filter((row) => row.status === "website_no_email").length,
      statusCounts,
      sourceCounts,
      sampleGood: output.filter((row) => row.status === "verified_email").slice(0, 3),
      sampleProblematic: output.filter((row) => row.status !== "verified_email").slice(0, 3),
    },
  };
}

export async function writeDiscoveryOutput(path: string, rows: readonly DiscoveryRow[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeCsvFile(path, rows, [
    "organisation_name", "town_city", "county", "industry", "website", "website_source",
    "website_evidence_url", "contact_email", "contact_source", "contact_evidence_url",
    "confidence", "status", "match_method", "match_confidence", "match_candidates_count",
    "found_at", "notes",
  ]);
}