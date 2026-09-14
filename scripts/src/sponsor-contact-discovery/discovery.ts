import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseCsvObjects, readCsvFile, writeCsvFile } from "./csv";
import { PublicSiteFetcher } from "./http";
import type {
  DiscoveryRow,
  OfficialRecord,
  SponsorInput,
} from "./types";

export const DEFAULT_HOME_OFFICE_URL =
  "https://www.gov.uk/csv-preview/6a86dc008d785493a9c89864/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-08-20.csv";

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

function normaliseName(valueToNormalise: string): string {
  return valueToNormalise.toLowerCase()
    .replace(/\b(the|limited|ltd|plc|llp|company|co)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const cleaned = raw.toLowerCase().replace(/\s+/g, "").replace(/\[at\]|\(at\)/g, "@")
    .replace(/\[dot\]|\(dot\)/g, ".");
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
  };
}

async function officialRecordsFromFile(path: string, source: string): Promise<OfficialRecord[]> {
  const rows = await readCsvFile(path);
  return rows.map((row) => ({
    organisationName: value(row, "organisation_name", "organisation name", "organisation", "establishmentname", "establishment name", "name"),
    townCity: value(row, "town_city", "town/city", "town", "city", "town/city"),
    website: normaliseWebsite(value(row, "website", "website_url", "schoolwebsite", "school website")),
    email: normaliseEmail(value(row, "contact_email", "contact email", "mainemail", "main email")),
    source,
    evidenceUrl: value(row, "website_evidence_url", "evidence_url", "source_url"),
  })).filter((record) => record.organisationName);
}

function findOfficialMatch(input: SponsorInput, records: readonly OfficialRecord[]): OfficialRecord | null {
  const name = normaliseName(input.organisationName);
  const exact = records.filter((record) => normaliseName(record.organisationName) === name);
  if (exact.length === 1) return exact[0]!;
  const town = normaliseTown(input.townCity);
  const townMatches = exact.filter((record) => town && normaliseTown(record.townCity) === town);
  return townMatches.length === 1 ? townMatches[0]! : null;
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
  const paths = ["", "/contact", "/careers", "/jobs"];
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

export async function loadSponsorInputs(
  inputPath: string | undefined,
  homeOfficeUrl = DEFAULT_HOME_OFFICE_URL,
): Promise<SponsorInput[]> {
  const rows = inputPath
    ? await readCsvFile(inputPath)
    : parseCsvObjects(await (await fetch(homeOfficeUrl, { signal: AbortSignal.timeout(30_000) })).text());
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
}): Promise<DiscoveryRow[]> {
  const inputs = choosePilot(
    await loadSponsorInputs(options.inputPath, options.homeOfficeUrl),
    options.limit,
  );
  const official = [
    ...(options.cqcPath ? await officialRecordsFromFile(options.cqcPath, "cqc") : []),
    ...(options.giasPath ? await officialRecordsFromFile(options.giasPath, "gias") : []),
    ...(options.charityPath ? await officialRecordsFromFile(options.charityPath, "charity_commission") : []),
  ];
  const fetcher = new PublicSiteFetcher(options.delayMs);
  const foundAt = new Date().toISOString();
  const output: DiscoveryRow[] = [];

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
          organisationName: input.organisationName,
          townCity: input.townCity,
          website: searched.website,
          email: "",
          source: "bing",
          evidenceUrl: searched.evidenceUrl,
        };
      }
    }
    if (!base.website && match?.website) {
      base.website = match.website;
      base.website_source = match.source;
      base.website_evidence_url = match.evidenceUrl;
    }
    if (match?.email) {
      base.contact_email = normaliseEmail(match.email, base.website);
      base.contact_source = match.source;
      base.contact_evidence_url = match.evidenceUrl || base.website_evidence_url;
    }
    if (!base.website) {
      base.status = match ? "no_website" : "unmatched";
      base.confidence = "medium";
      base.notes = match
        ? "Official record matched, but no corroborated website was published."
        : "No unambiguous official-register match; no website guessed.";
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
        base.status = "website_no_email";
        base.confidence = "medium";
        base.notes = "Confirmed website fetched, but no accepted public employer-domain email was found.";
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
    output.push(base);
  }
  return output;
}

export async function writeDiscoveryOutput(path: string, rows: readonly DiscoveryRow[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeCsvFile(path, rows, [
    "organisation_name", "town_city", "county", "industry", "website", "website_source",
    "website_evidence_url", "contact_email", "contact_source", "contact_evidence_url",
    "confidence", "status", "found_at", "notes",
  ]);
}