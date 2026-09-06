import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  COMPANY_SITE_EMPLOYER_BUDGET_MS,
  fetchCompanySitePage,
  isAllowedCompanyDestination,
  knownAtsProvider,
} from "./companySiteHttp";
import { normaliseSponsorWebsite } from "./companySiteDiscovery";

export const CONTACT_ENRICHMENT_BATCH_SIZE = 5;
export const CONTACT_ENRICHMENT_MAX_PAGES = 4;
export const STORED_CONTACT_HARVEST_BATCH_SIZE = 250;
export const STORED_CONTACT_HARVEST_BUDGET_MS = 20_000;
export const CONTACT_WEB_SEARCH_DEFAULT_DAILY_CAP = 50;
export const CONTACT_WEB_SEARCH_MAX_DAILY_CAP = 100;
const WEBSITE_LOOKUP_TIMEOUT_MS = 20_000;
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com",
]);
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const CONTACT_LINK = /\b(contact|about|career|careers|job|jobs|recruit|join|work with us)\b/i;
const BLOCKED_OFFICIAL_HOSTS = [
  "linkedin.com", "indeed.com", "facebook.com", "instagram.com", "x.com",
  "twitter.com", "find-and-update.company-information.service.gov.uk", "gov.uk",
  "yell.com", "glassdoor.com", "reed.co.uk", "jobs.nhs.uk",
];
const BLOCKED_CONTACT_DOMAINS = [
  ...BLOCKED_OFFICIAL_HOSTS,
  "greenhouse.io", "lever.co", "myworkdayjobs.com", "workday.com",
  "smartrecruiters.com", "teamtailor.com", "jobvite.com", "bamboohr.com",
];
const BLOCKED_VACANCY_EVIDENCE_HOSTS = ["linkedin.com", "indeed.com"];
const GENERIC_ORGANISATION_WORDS = new Set([
  "limited", "ltd", "plc", "llp", "group", "care", "services", "service",
  "health", "healthcare", "uk", "company", "the", "and", "for", "with",
]);

export type ContactEnrichmentTarget = {
  organisationName: string;
  website: string | null;
  companySiteUrl: string | null;
  stage: "website" | "contact";
  attempts: number;
  citedWebsite: string | null;
};

export function getContactWebSearchDailyCap(raw = process.env["CONTACT_WEB_SEARCH_DAILY_CAP"]): number {
  const parsed = raw == null || raw === "" ? CONTACT_WEB_SEARCH_DEFAULT_DAILY_CAP : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, CONTACT_WEB_SEARCH_MAX_DAILY_CAP) : 0;
}

function nextUtcDay(): Date { const value = new Date(); value.setUTCHours(24, 0, 0, 0); return value; }
async function reserveContactWebSearch(organisationName: string): Promise<boolean> {
  const cap = getContactWebSearchDailyCap();
  if (cap === 0) return false;
  const day = new Date().toISOString().slice(0, 10);
  const result = await db.execute<any>(sql`
    INSERT INTO contact_web_search_usage (utc_date, organisation_name)
    SELECT ${day}::date, lower(btrim(${organisationName}))
    WHERE (SELECT count(*) FROM contact_web_search_usage WHERE utc_date = ${day}::date) < ${cap}
    ON CONFLICT (utc_date, organisation_name) DO NOTHING RETURNING id
  `);
  return result.rows.length > 0;
}
export type ContactEnrichmentSummary = {
  selected: number;
  upserted: number;
  live: number;
  dead: number;
  inconclusive: number;
  errors: number;
  done: boolean;
  remaining: number;
  harvested: number;
  skippedExisting: number;
  noEmailInStore: number;
  harvestRemaining: number;
};

export type StoredContactCandidate = {
  email: string;
  source: "vacancy_field" | "vacancy_text" | "sponsor_record";
  evidenceUrl: string | null;
};

export type StoredVacancyContactRow = {
  contactEmail?: string | null;
  description: string | null;
  url: string | null;
  liveness: string;
};

type StoredHarvestTarget = {
  organisationName: string;
  profileEmail: string | null;
  profileWebsite: string | null;
  vacancies: StoredVacancyContactRow[];
};

type ContactEnrichmentOutcome = "stored" | "existing" | "inconclusive" | "budget_exhausted";
type WebsiteLookupResult = {
  url?: string;
  evidenceUrl?: string;
  error?: string;
  deferred?: boolean;
};

function cleanText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&(?:amp|#38);/gi, "&")
    .replace(/&#64;|&commat;/gi, "@").replace(/\s+/g, " ").trim();
}

function domainMatchesSite(email: string, site: URL): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  const host = site.hostname.toLowerCase().replace(/^www\./, "");
  return !!domain && (domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`));
}

/** Only visible mailto/plain-text addresses; this deliberately never constructs one. */
export function extractPublishedContactEmails(html: string, website: string): string[] {
  let site: URL;
  try { site = new URL(website); } catch { return []; }
  const visible = cleanText(html);
  const mailtos = [...html.matchAll(/\bhref\s*=\s*["']mailto:([^"'?#\s]+)/gi)]
    .map((m) => decodeURIComponent(m[1]!).trim().toLowerCase());
  const candidates = [...mailtos, ...(visible.match(EMAIL) ?? [])]
    .map((email) => email.trim().toLowerCase().replace(/[)>.,;:]+$/, ""))
    .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
  return [...new Set(candidates)].filter((email) => {
    const domain = email.split("@")[1]!;
    return !email.startsWith("noreply@") && !email.startsWith("no-reply@") &&
      !FREE_EMAIL_DOMAINS.has(domain) &&
      (domainMatchesSite(email, site) ||
        (mailtos.includes(email) && /(?:recruit|jobs?|careers?|hr)/i.test(email.split("@")[0]!)));
  });
}

function chooseEmail(emails: string[]): string | null {
  return emails.sort((a, b) => {
    const score = (email: string) => /\b(recruit|jobs?|careers?|hr)\b/i.test(email) ? 2 :
      /\b(info|contact|admin)\b/i.test(email) ? 1 : 0;
    return score(b) - score(a) || a.localeCompare(b);
  })[0] ?? null;
}

function hostnameIsBlocked(hostname: string, blockedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function evidenceUrlAllowed(value: string | null): boolean {
  if (!value) return false;
  try {
    return !hostnameIsBlocked(new URL(value).hostname, BLOCKED_VACANCY_EVIDENCE_HOSTS);
  } catch {
    return false;
  }
}

export function validateStoredContactEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase().replace(/^mailto:/, "").replace(/[)>.,;:]+$/, "") ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  if (/^(?:no-?reply|donotreply|do-not-reply)$/i.test(local)) return null;
  if (hostnameIsBlocked(domain, BLOCKED_CONTACT_DOMAINS)) return null;
  return email;
}

function emailsFromStoredText(value: string): string[] {
  const mailtos = [...value.matchAll(/\bhref\s*=\s*["']mailto:([^"'?#\s]+)/gi)].map((match) => match[1] ?? "");
  const visible = cleanText(value).match(EMAIL) ?? [];
  return [...new Set([...mailtos, ...visible].map(validateStoredContactEmail).filter((email): email is string => !!email))];
}

/** Chooses only persisted evidence; this function never fetches and never constructs an address. */
export function chooseStoredContactCandidate(
  vacancies: readonly StoredVacancyContactRow[],
  profileEmail: string | null,
  profileWebsite: string | null = null,
): StoredContactCandidate | null {
  const current = vacancies.filter((vacancy) => vacancy.liveness !== "dead" && evidenceUrlAllowed(vacancy.url));
  for (const vacancy of current) {
    const email = validateStoredContactEmail(vacancy.contactEmail);
    if (email) return { email, source: "vacancy_field", evidenceUrl: vacancy.url };
  }
  const textCandidates = current.flatMap((vacancy) =>
    emailsFromStoredText(vacancy.description ?? "").map((email) => ({ email, evidenceUrl: vacancy.url })));
  const textEmail = chooseEmail(textCandidates.map((candidate) => candidate.email));
  if (textEmail) {
    return {
      email: textEmail,
      source: "vacancy_text",
      evidenceUrl: textCandidates.find((candidate) => candidate.email === textEmail)?.evidenceUrl ?? null,
    };
  }
  const storedEmail = validateStoredContactEmail(profileEmail);
  return storedEmail
    ? { email: storedEmail, source: "sponsor_record", evidenceUrl: profileWebsite }
    : null;
}

function contactLinkPriority(value: string): number {
  if (/\b(recruit|career|careers|job|jobs|join|work with us)\b/i.test(value)) return 3;
  if (/\b(contact|contact us|get in touch)\b/i.test(value)) return 2;
  if (/\babout\b/i.test(value)) return 1;
  return 0;
}

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Reject generic legal/industry language: a page saying only “care limited” is not corroboration. */
export function corroboratesEmployer(html: string, organisationName: string): boolean {
  const name = normaliseName(organisationName);
  const tokens = name.split(" ").filter((word) => word.length >= 3 && !GENERIC_ORGANISATION_WORDS.has(word));
  if (tokens.length === 0) return false;
  const priorityText = [
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    ...[...html.matchAll(/<meta\b[^>]*(?:name|property)=["'](?:description|og:site_name)["'][^>]*content=["']([^"']*)/gi)].map((match) => match[1] ?? ""),
    ...[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => match[1] ?? ""),
    cleanText(html),
  ].map((value) => normaliseName(cleanText(value))).join(" ");
  const compactName = name.replace(/\s/g, "");
  if (compactName.length >= 4 && priorityText.replace(/\s/g, "").includes(compactName)) return true;
  const matches = tokens.filter((token) => new RegExp(`\\b${token}\\b`).test(priorityText)).length;
  return matches >= Math.min(2, tokens.length);
}

function websiteFromVacancyUrl(value: string | null): string | null {
  if (!value || knownAtsProvider(value)) return null;
  const normalised = normaliseSponsorWebsite(value);
  if (!normalised) return null;
  try {
    const parsed = new URL(normalised);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}

function isPermittedOfficialWebsite(value: string | null): string | null {
  const normalised = normaliseSponsorWebsite(value ?? "");
  if (!normalised) return null;
  let host: string;
  try { host = new URL(normalised).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  if (BLOCKED_OFFICIAL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`)) || knownAtsProvider(normalised)) {
    return null;
  }
  return normalised;
}

/** Parses response text, not model metadata, then proves the exact host has a URL citation. */
export function citedWebsiteFromResponse(outputText: string, response: unknown): string | null {
  const citedHosts = new Set<string>();
  const collect = (value: unknown, inCitation = false): void => {
    if (Array.isArray(value)) return void value.forEach((item) => collect(item, inCitation));
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const isCitation = inCitation || record.type === "url_citation";
    for (const [key, child] of Object.entries(record)) {
      if (key === "url" && isCitation && typeof child === "string") {
        try { citedHosts.add(new URL(child).hostname.toLowerCase()); } catch { /* invalid citation */ }
      } else collect(child, isCitation || key === "annotations" || key === "citations");
    }
  };
  collect(response);
  const urls = outputText.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  for (const url of urls) {
    const normalised = isPermittedOfficialWebsite(url);
    if (normalised && citedHosts.has(new URL(normalised).hostname.toLowerCase())) return normalised;
  }
  return null;
}

/**
 * Grounded lookup is intentionally capability-gated.  A deployment with an SDK
 * that does not return URL citations must retry rather than treating model text
 * as a source.  It does not use the vacancy AI budget/cap.
 */
export async function lookupOfficialWebsite(
  organisationName: string,
  candidateUrl?: string | null,
): Promise<WebsiteLookupResult> {
  try {
    if (!await reserveContactWebSearch(organisationName)) {
      return { error: "contact web-search daily allowance unavailable", deferred: true };
    }
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBSITE_LOOKUP_TIMEOUT_MS);
    let response: any;
    try { response = await (openai.responses as any).create({
        model: "gpt-5.4-mini",
        tools: [{ type: "web_search_preview" }],
        input: candidateUrl
          ? `Confirm whether ${candidateUrl} is the official employer website for ${organisationName}. Return that URL only with a web citation.`
          : `Find the official employer website for ${organisationName}. Return only its URL with a web citation; do not use directories, social networks, recruitment agencies, or ATS sites.`,
      }, { signal: controller.signal }); } finally { clearTimeout(timeout); }
    const normalised = citedWebsiteFromResponse((response as any).output_text ?? "", response);
    if (!normalised) return { error: "grounded website lookup returned no usable cited URL" };
    return { url: normalised, evidenceUrl: normalised };
  } catch (error) {
    return { error: `grounded website lookup unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function selectContactEnrichmentBatch(limit = CONTACT_ENRICHMENT_BATCH_SIZE): Promise<ContactEnrichmentTarget[]> {
  const result = await db.execute<any>(sql`
    WITH organisations AS (
      SELECT lower(btrim(sl.organisation_name)) AS organisation_key,
        min(btrim(sl.organisation_name)) AS organisation_name, max(NULLIF(trim(sl.website), '')) AS website,
        min(v.url) FILTER (WHERE v.source_type = 'company_site' AND v.liveness <> 'dead') AS company_site_url
      FROM sponsor_licences sl
      JOIN sponsor_licence_vacancies v ON lower(btrim(v.organisation_name)) = lower(btrim(sl.organisation_name))
      WHERE NULLIF(trim(sl.contact_email), '') IS NULL AND v.liveness <> 'dead'
      GROUP BY lower(btrim(sl.organisation_name))
    )
    SELECT o.organisation_key AS organisation_name, COALESCE(e.website_url, o.website) AS website, o.company_site_url,
      CASE WHEN e.website_cited_at IS NOT NULL THEN e.website_url END AS cited_website,
      COALESCE(e.stage, CASE WHEN o.website IS NULL THEN 'website' ELSE 'contact' END) AS stage,
      COALESCE(e.attempts, 0) AS attempts
    FROM organisations o
    LEFT JOIN sponsor_licence_contact_enrichments e ON lower(btrim(e.organisation_name)) = o.organisation_key
    WHERE e.stored_harvested_at IS NOT NULL
      AND (e.status IN ('pending', 'retry') AND (e.retry_after IS NULL OR e.retry_after <= NOW()))
    ORDER BY (e.website_cited_at IS NULL), COALESCE(e.updated_at, to_timestamp(0)), o.organisation_name
    LIMIT ${Math.max(1, Math.floor(limit))}
  `);
  return result.rows.map((row: any) => ({
    organisationName: row.organisation_name, website: row.website, companySiteUrl: row.company_site_url,
    stage: row.stage === "contact" ? "contact" : "website", attempts: Number(row.attempts), citedWebsite: row.cited_website,
  }));
}

async function saveState(target: ContactEnrichmentTarget, state: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    INSERT INTO sponsor_licence_contact_enrichments
      (organisation_name, stage, status, attempts, retry_after, website_url, website_lookup_source, website_lookup_at, website_cited_at, website_verified_at, website_evidence_url,
       contact_email, contact_source, contact_evidence_url, contact_extracted_at, last_error, completed_at, updated_at)
    VALUES (${target.organisationName}, ${state.stage ?? target.stage}, ${state.status ?? "pending"}, ${target.attempts + 1},
      ${state.retryAfter ?? null}, ${state.websiteUrl ?? null}, ${state.websiteLookupSource ?? null}, ${state.websiteLookupAt ?? null}, ${state.websiteCitedAt ?? null}, ${state.websiteVerifiedAt ?? null}, ${state.websiteEvidenceUrl ?? null},
      ${state.contactEmail ?? null}, ${state.contactSource ?? null}, ${state.contactEvidenceUrl ?? null}, ${state.contactExtractedAt ?? null},
      ${state.lastError ?? null}, ${state.completedAt ?? null}, NOW())
    ON CONFLICT (organisation_name) DO UPDATE SET
      stage = EXCLUDED.stage, status = EXCLUDED.status, attempts = EXCLUDED.attempts, retry_after = EXCLUDED.retry_after,
      website_url = COALESCE(EXCLUDED.website_url, sponsor_licence_contact_enrichments.website_url),
      website_lookup_source = COALESCE(EXCLUDED.website_lookup_source, sponsor_licence_contact_enrichments.website_lookup_source),
      website_lookup_at = COALESCE(EXCLUDED.website_lookup_at, sponsor_licence_contact_enrichments.website_lookup_at),
      website_cited_at = COALESCE(EXCLUDED.website_cited_at, sponsor_licence_contact_enrichments.website_cited_at),
      website_verified_at = COALESCE(EXCLUDED.website_verified_at, sponsor_licence_contact_enrichments.website_verified_at),
      website_evidence_url = COALESCE(EXCLUDED.website_evidence_url, sponsor_licence_contact_enrichments.website_evidence_url),
      contact_email = COALESCE(EXCLUDED.contact_email, sponsor_licence_contact_enrichments.contact_email),
      contact_source = COALESCE(EXCLUDED.contact_source, sponsor_licence_contact_enrichments.contact_source),
      contact_evidence_url = COALESCE(EXCLUDED.contact_evidence_url, sponsor_licence_contact_enrichments.contact_evidence_url),
      contact_extracted_at = COALESCE(EXCLUDED.contact_extracted_at, sponsor_licence_contact_enrichments.contact_extracted_at),
      last_error = EXCLUDED.last_error, completed_at = EXCLUDED.completed_at, updated_at = NOW()
  `);
}

async function selectStoredHarvestBatch(limit: number): Promise<StoredHarvestTarget[]> {
  const result = await db.execute<any>(sql`
    WITH target_organisations AS (
      SELECT lower(btrim(sl.organisation_name)) AS organisation_key,
        min(btrim(sl.organisation_name)) AS organisation_name
      FROM sponsor_licences sl
      JOIN sponsor_licence_vacancies v
        ON lower(btrim(v.organisation_name)) = lower(btrim(sl.organisation_name))
      LEFT JOIN sponsor_licence_contact_enrichments e
        ON lower(btrim(e.organisation_name)) = lower(btrim(sl.organisation_name))
      WHERE NULLIF(btrim(sl.contact_email), '') IS NULL
        AND v.liveness <> 'dead'
        AND e.stored_harvested_at IS NULL
      GROUP BY lower(btrim(sl.organisation_name))
      ORDER BY lower(btrim(sl.organisation_name))
      LIMIT ${limit}
    )
    SELECT target.organisation_name,
      profile.contact_email AS profile_email,
      profile.contact_website AS profile_website,
      json_agg(json_build_object(
        'description', vacancy.description,
        'url', vacancy.url,
        'liveness', vacancy.liveness
      ) ORDER BY vacancy.id) AS vacancies
    FROM target_organisations target
    JOIN sponsor_licence_vacancies vacancy
      ON lower(btrim(vacancy.organisation_name)) = target.organisation_key
      AND vacancy.liveness <> 'dead'
    LEFT JOIN LATERAL (
      SELECT ep.contact_email, ep.contact_website
      FROM employer_profiles ep
      WHERE lower(btrim(ep.company_name)) = target.organisation_key
      ORDER BY ep.updated_at DESC, ep.id
      LIMIT 1
    ) profile ON true
    GROUP BY target.organisation_key, target.organisation_name,
      profile.contact_email, profile.contact_website
    ORDER BY target.organisation_key
  `);
  return result.rows.map((row: any) => ({
    organisationName: row.organisation_name,
    profileEmail: row.profile_email ?? null,
    profileWebsite: row.profile_website ?? null,
    vacancies: Array.isArray(row.vacancies) ? row.vacancies : [],
  }));
}

async function markStoredHarvested(
  target: StoredHarvestTarget,
  candidate: StoredContactCandidate | null,
): Promise<"harvested" | "skippedExisting" | "noEmailInStore"> {
  if (!candidate) {
    await db.execute(sql`
      INSERT INTO sponsor_licence_contact_enrichments
        (organisation_name, stage, status, attempts, stored_harvested_at, updated_at)
      VALUES (${target.organisationName}, 'website', 'pending', 0, NOW(), NOW())
      ON CONFLICT (organisation_name) DO UPDATE SET
        stored_harvested_at = NOW(), updated_at = NOW()
    `);
    return "noEmailInStore";
  }

  const updated = await db.execute<any>(sql`
    UPDATE sponsor_licences
    SET contact_email = COALESCE(NULLIF(btrim(contact_email), ''), ${candidate.email})
    WHERE lower(btrim(organisation_name)) = lower(btrim(${target.organisationName}))
      AND NULLIF(btrim(contact_email), '') IS NULL
    RETURNING id
  `);
  const harvested = updated.rows.length > 0;
  await db.execute(sql`
    INSERT INTO sponsor_licence_contact_enrichments
      (organisation_name, stage, status, attempts, stored_harvested_at,
       contact_email, contact_source, contact_evidence_url, contact_extracted_at,
       completed_at, updated_at)
    VALUES (${target.organisationName}, 'contact', 'complete', 0, NOW(),
      ${harvested ? candidate.email : null}, ${harvested ? candidate.source : null},
      ${harvested ? candidate.evidenceUrl : null}, ${harvested ? new Date() : null},
      NOW(), NOW())
    ON CONFLICT (organisation_name) DO UPDATE SET
      stage = 'contact', status = 'complete', retry_after = NULL,
      stored_harvested_at = NOW(),
      contact_email = COALESCE(EXCLUDED.contact_email, sponsor_licence_contact_enrichments.contact_email),
      contact_source = COALESCE(EXCLUDED.contact_source, sponsor_licence_contact_enrichments.contact_source),
      contact_evidence_url = COALESCE(EXCLUDED.contact_evidence_url, sponsor_licence_contact_enrichments.contact_evidence_url),
      contact_extracted_at = COALESCE(EXCLUDED.contact_extracted_at, sponsor_licence_contact_enrichments.contact_extracted_at),
      last_error = NULL, completed_at = NOW(), updated_at = NOW()
  `);
  return harvested ? "harvested" : "skippedExisting";
}

async function countStoredHarvestRemaining(): Promise<number> {
  const result = await db.execute<any>(sql`
    SELECT count(DISTINCT lower(btrim(sl.organisation_name)))::int AS remaining
    FROM sponsor_licences sl
    JOIN sponsor_licence_vacancies v
      ON lower(btrim(v.organisation_name)) = lower(btrim(sl.organisation_name))
    LEFT JOIN sponsor_licence_contact_enrichments e
      ON lower(btrim(e.organisation_name)) = lower(btrim(sl.organisation_name))
    WHERE NULLIF(btrim(sl.contact_email), '') IS NULL
      AND v.liveness <> 'dead'
      AND e.stored_harvested_at IS NULL
  `);
  return Number(result.rows[0]?.remaining ?? 0);
}

async function runStoredContactHarvestBatch(): Promise<{
  selected: number;
  harvested: number;
  skippedExisting: number;
  noEmailInStore: number;
  remaining: number;
}> {
  const startedAt = Date.now();
  const targets = await selectStoredHarvestBatch(STORED_CONTACT_HARVEST_BATCH_SIZE);
  let selected = 0;
  let harvested = 0;
  let skippedExisting = 0;
  let noEmailInStore = 0;
  for (const target of targets) {
    if (Date.now() - startedAt >= STORED_CONTACT_HARVEST_BUDGET_MS) break;
    const outcome = await markStoredHarvested(
      target,
      chooseStoredContactCandidate(target.vacancies, target.profileEmail, target.profileWebsite),
    );
    selected++;
    if (outcome === "harvested") harvested++;
    else if (outcome === "skippedExisting") skippedExisting++;
    else noEmailInStore++;
  }
  return {
    selected,
    harvested,
    skippedExisting,
    noEmailInStore,
    remaining: await countStoredHarvestRemaining(),
  };
}

export function shouldRunPaidContactEnrichment(harvestRemaining: number): boolean {
  return harvestRemaining === 0;
}

async function retry(
  target: ContactEnrichmentTarget,
  error: string,
  retryAfter?: Date,
  evidence: { websiteUrl?: string; websiteEvidenceUrl?: string } = {},
): Promise<void> {
  const terminal = target.attempts + 1 >= 6;
  await saveState(target, {
    status: terminal ? "failed" : "retry",
    lastError: error,
    retryAfter: terminal ? null : retryAfter ?? new Date(Date.now() + Math.min(24 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(target.attempts, 6))),
    ...evidence,
  });
}

async function storeContactIfBlank(organisationName: string, email: string): Promise<boolean> {
  const result = await db.execute<any>(sql`
    UPDATE sponsor_licences
    SET contact_email = COALESCE(NULLIF(trim(contact_email), ''), ${email})
    WHERE lower(btrim(organisation_name)) = lower(btrim(${organisationName}))
      AND NULLIF(trim(contact_email), '') IS NULL
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function contactAlreadyPresent(organisationName: string): Promise<boolean> {
  const result = await db.execute<any>(sql`
    SELECT 1 FROM sponsor_licences
    WHERE lower(btrim(organisation_name)) = lower(btrim(${organisationName}))
      AND NULLIF(trim(contact_email), '') IS NOT NULL
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function enrichTarget(target: ContactEnrichmentTarget): Promise<ContactEnrichmentOutcome> {
  let website = isPermittedOfficialWebsite(target.website) ?? websiteFromVacancyUrl(target.companySiteUrl);
  let websiteEvidenceUrl = website ?? undefined;
  if (!target.citedWebsite) {
    const lookup = await lookupOfficialWebsite(target.organisationName, website);
    if (lookup.deferred) return "budget_exhausted";
    if (!lookup.url) {
      await retry(target, lookup.error ?? "no official website source", nextUtcDay());
      return "inconclusive";
    }
    website = lookup.url;
    websiteEvidenceUrl = lookup.evidenceUrl;
    // Citation is durable before the network fetch: retrying a fetch never pays
    // for another model call.
    await saveState(target, {
      stage: "website", status: "pending", websiteUrl: website,
      websiteLookupSource: target.website ? "stored" : target.companySiteUrl ? "vacancy" : "web_search",
      websiteLookupAt: new Date(), websiteCitedAt: new Date(), websiteEvidenceUrl,
    });
  } else if (!website) {
    await retry(target, "cited website is no longer valid");
    return "inconclusive";
  }
  const origin = new URL(website).hostname;
  const deadline = Date.now() + COMPANY_SITE_EMPLOYER_BUDGET_MS;
  const home = await fetchCompanySitePage(website, origin, deadline);
  if (!home.ok) {
    await retry(target, home.reason, home.retryAt, { websiteUrl: website, websiteEvidenceUrl });
    return "inconclusive";
  }
  if (!corroboratesEmployer(home.body, target.organisationName)) {
    await retry(target, "official-site identity could not be corroborated", undefined, { websiteUrl: website, websiteEvidenceUrl }); return "inconclusive";
  }
  // Website is persisted only after an official page corroborates the employer.
  await db.execute(sql`UPDATE sponsor_licences SET website = COALESCE(NULLIF(trim(website), ''), ${website})
    WHERE lower(btrim(organisation_name)) = lower(btrim(${target.organisationName}))`);
  const pages = [{ url: home.url, body: home.body }];
  const links = [...home.body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1], text: cleanText(m[2]) }))
    .filter((link) => link.href && CONTACT_LINK.test(`${link.text} ${link.href}`))
    .map((link) => {
      try {
        return {
          url: new URL(link.href!, home.url).toString(),
          priority: contactLinkPriority(`${link.text} ${link.href}`),
        };
      } catch {
        return null;
      }
    })
    .filter((link): link is { url: string; priority: number } =>
      !!link
      && isAllowedCompanyDestination(origin, link.url)
      && new URL(link.url).hostname === new URL(home.url).hostname)
    .sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url))
    .slice(0, CONTACT_ENRICHMENT_MAX_PAGES - 1)
    .map((link) => link.url);
  for (const url of links) {
    const page = await fetchCompanySitePage(url, origin, deadline);
    if (page.ok) pages.push({ url: page.url, body: page.body });
  }
  for (const page of pages) {
    const email = chooseEmail(extractPublishedContactEmails(page.body, website));
    if (!email) continue;
    const stored = await storeContactIfBlank(target.organisationName, email);
    await saveState(target, {
      stage: "contact", status: "complete", websiteUrl: website, websiteEvidenceUrl: home.url, websiteVerifiedAt: new Date(),
      ...(stored ? {
        contactEmail: email,
        contactSource: "website",
        contactEvidenceUrl: page.url,
        contactExtractedAt: new Date(),
      } : {}),
      completedAt: new Date(),
    });
    return stored ? "stored" : "existing";
  }
  if (await contactAlreadyPresent(target.organisationName)) {
    await saveState(target, { stage: "contact", status: "complete", websiteUrl: website, websiteEvidenceUrl: home.url, websiteVerifiedAt: new Date(), completedAt: new Date() });
    return "existing";
  }
  await saveState(target, {
    stage: "contact", status: target.attempts + 1 >= 6 ? "failed" : "retry", websiteUrl: website, websiteEvidenceUrl: home.url, websiteVerifiedAt: new Date(),
    lastError: "no published contact email found", retryAfter: new Date(Date.now() + 30 * 24 * 60 * 60_000),
  });
  return "inconclusive";
}

export async function runContactEnrichmentBatch(options: { batchSize?: number } = {}): Promise<ContactEnrichmentSummary> {
  const batchSize = Math.min(5, Math.max(1, Math.floor(options.batchSize ?? CONTACT_ENRICHMENT_BATCH_SIZE)));
  const harvest = await runStoredContactHarvestBatch();
  if (!shouldRunPaidContactEnrichment(harvest.remaining)) {
    const remaining = await countContactEnrichmentRemaining();
    return {
      selected: harvest.selected,
      upserted: harvest.harvested,
      live: 0,
      dead: 0,
      inconclusive: harvest.noEmailInStore,
      errors: 0,
      done: false,
      remaining,
      harvested: harvest.harvested,
      skippedExisting: harvest.skippedExisting,
      noEmailInStore: harvest.noEmailInStore,
      harvestRemaining: harvest.remaining,
    };
  }
  const targets = await selectContactEnrichmentBatch(batchSize);
  let selected = 0; let upserted = 0; let inconclusive = 0; let errors = 0;
  for (const target of targets) {
    try {
      const outcome = await enrichTarget(target);
      if (outcome === "budget_exhausted") break;
      selected++;
      if (outcome === "stored") upserted++;
      else if (outcome === "inconclusive") inconclusive++;
    } catch (error) {
      selected++;
      errors++;
      await retry(target, error instanceof Error ? error.message : String(error));
    }
  }
  const remaining = await countContactEnrichmentRemaining();
  return {
    selected: harvest.selected + selected,
    upserted: harvest.harvested + upserted,
    live: 0,
    dead: 0,
    inconclusive: harvest.noEmailInStore + inconclusive,
    errors,
    done: remaining === 0,
    remaining,
    harvested: harvest.harvested,
    skippedExisting: harvest.skippedExisting,
    noEmailInStore: harvest.noEmailInStore,
    harvestRemaining: harvest.remaining,
  };
}

async function countContactEnrichmentRemaining(): Promise<number> {
  const pending = await db.execute<any>(sql`
    SELECT count(DISTINCT lower(btrim(sl.organisation_name)))::int AS remaining
    FROM sponsor_licences sl JOIN sponsor_licence_vacancies v
      ON lower(btrim(v.organisation_name)) = lower(btrim(sl.organisation_name))
    LEFT JOIN sponsor_licence_contact_enrichments e
      ON lower(btrim(e.organisation_name)) = lower(btrim(sl.organisation_name))
    WHERE NULLIF(trim(sl.contact_email), '') IS NULL AND v.liveness <> 'dead'
      AND (e.status IS NULL OR e.status IN ('pending', 'retry'))
  `);
  return Number(pending.rows[0]?.remaining ?? 0);
}