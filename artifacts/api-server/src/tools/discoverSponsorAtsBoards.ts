/**
 * Bulk ATS board discovery. Two passes:
 *   --mode=site-evidence: fetch each sponsor's stored official website once,
 *     find links to supported ATS job boards on the employer's own page
 *     (first-party proof), then verify the board feed actually returns jobs.
 *   --mode=slug-guess: guess board slugs from the organisation name for every
 *     unprobed sponsor and keep only feeds whose own identity claims match the
 *     sponsor name exactly.
 * Verified rows land in sponsor_licence_company_site_checks
 * (ats_mapping_status='verified'), where the company_site_direct_feed job
 * harvests them. Progress is ledgered via last_outcome='ats_probe_*'.
 *
 * Usage: tsx src/tools/discoverSponsorAtsBoards.ts --mode=site-evidence|slug-guess [--limit N] [--concurrency N]
 */
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchDirectEmployerBoard, parseDirectBoardMapping } from "../lib/directEmployerBoardConnectors";
import { fetchCompanySitePage } from "../lib/companySiteHttp";

const LEGAL_SUFFIXES = new Set([
  "ltd", "limited", "plc", "llp", "lp", "inc", "llc", "company", "co",
  "corporation", "corp", "holdings", "holding", "group", "uk", "u.k.", "the",
]);
// Trailing generic business words a feed brand name usually drops ("Monzo
// Bank" -> "Monzo"). Stripped only after legal suffixes for identity soft-match.
const DOMAIN_SUFFIXES = new Set([
  "bank", "payments", "services", "service", "solutions", "systems",
  "technologies", "technology", "homes", "care", "management", "consulting",
  "consultancy", "international", "logistics", "construction", "engineering",
  "media", "digital", "security", "facilities", "support", "health",
  "recruitment", "staffing", "training", "education", "retail", "transport",
  "travel", "insurance", "capital", "partners", "global", "hospitality",
  "motors", "automotive", "energy", "power", "pharmaceuticals", "pharmacy",
  "medical", "clinic", "legal", "law", "finance", "financial", "trading",
  "enterprises", "industries", "manufacturing", "property", "properties",
  "developments", "investments", "investment", "housing", "business",
  "design", "marketing", "communications", "software", "data", "networks",
  "aerospace", "marine", "electronics", "laboratories", "labs", "biotech",
  "research", "ventures", "resources", "catering", "productions", "creative",
  "studios", "agency", "consultants",
]);

function identityKey(value: string, domainSuffixes: boolean): string {
  const words = value.toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && (LEGAL_SUFFIXES.has(words[words.length - 1]!) ||
    (domainSuffixes && DOMAIN_SUFFIXES.has(words[words.length - 1]!)))) words.pop();
  return words.join(" ");
}

const ATS_LINK = /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|recruitee\.com|jobs\.personio\.|pinpointhq\.com|myworkdayjobs\.com/i;

function slugCandidates(organisationName: string): string[] {
  const words = organisationName.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  if (!words.length) return [];
  const candidates = [words.join("")];
  if (words.length > 1 && words[0]!.length >= 4) candidates.push(words[0]!);
  if (words.length > 2) candidates.push(words.slice(0, 2).join(""));
  return [...new Set(candidates.filter((c) => /^[a-z0-9][a-z0-9-]{1,60}$/.test(c)))];
}

const PROVIDERS: { provider: string; boardUrl: (slug: string) => string }[] = [
  { provider: "Greenhouse", boardUrl: (s) => `https://job-boards.greenhouse.io/${s}` },
  { provider: "Lever", boardUrl: (s) => `https://jobs.lever.co/${s}` },
  { provider: "Ashby", boardUrl: (s) => `https://jobs.ashbyhq.com/${s}` },
];

function boardRootUrl(url: URL): { provider: string; careersUrl: string } | null {
  const host = url.hostname.toLowerCase();
  const seg = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(seg)) {
    if (/^[a-z0-9-]+\.recruitee\.com$/i.test(host)) return { provider: "Recruitee", careersUrl: `https://${host}/` };
    if (/^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/i.test(host)) return { provider: "Personio", careersUrl: `https://${host}/` };
    if (/^([a-z0-9-]+)\.pinpointhq\.com$/i.test(host)) return { provider: "Pinpoint", careersUrl: `https://${host}/` };
    if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) return { provider: "Workday", careersUrl: url.toString() };
    return null;
  }
  if (/^(?:www\.)?jobs\.ashbyhq\.com$/i.test(host)) return { provider: "Ashby", careersUrl: `https://jobs.ashbyhq.com/${seg}` };
  if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/i.test(host)) return { provider: "Greenhouse", careersUrl: `https://job-boards.greenhouse.io/${seg}` };
  if (/^jobs(?:\.eu)?\.lever\.co$/i.test(host)) return { provider: "Lever", careersUrl: `https://jobs.lever.co/${seg}` };
  if (/^jobs\.smartrecruiters\.com$/i.test(host)) return { provider: "SmartRecruiters", careersUrl: `https://jobs.smartrecruiters.com/${seg}` };
  if (/^[a-z0-9-]+\.recruitee\.com$/i.test(host)) return { provider: "Recruitee", careersUrl: `https://${host}/` };
  if (/^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/i.test(host)) return { provider: "Personio", careersUrl: `https://${host}/` };
  if (/^([a-z0-9-]+)\.pinpointhq\.com$/i.test(host)) return { provider: "Pinpoint", careersUrl: `https://${host}/` };
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) return { provider: "Workday", careersUrl: url.toString() };
  return null;
}

export function boardLinkCandidates(body: string, pageUrl: string): { provider: string; careersUrl: string }[] {
  const out = new Map<string, { provider: string; careersUrl: string }>();
  for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href || !ATS_LINK.test(href)) continue;
    let parsed: URL;
    try { parsed = new URL(href, pageUrl); } catch { continue; }
    const candidate = boardRootUrl(parsed);
    if (candidate && parseDirectBoardMapping(candidate.provider, candidate.careersUrl)) {
      out.set(candidate.careersUrl, candidate);
    }
  }
  return [...out.values()];
}

async function recordProbe(organisationName: string, outcome: string, verified?: {
  provider: string; boardId: string; careersUrl: string; adverts: number;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO sponsor_licence_company_site_checks
      (organisation_name, last_attempted_at, last_outcome,
       careers_url, ats_provider, ats_board_id, ats_mapping_status, ats_mapping_evidence_url,
       last_adverts_found, updated_at)
    VALUES (${organisationName}, NOW(), ${outcome},
      ${verified?.careersUrl ?? null}, ${verified?.provider ?? null}, ${verified?.boardId ?? null},
      ${verified ? "verified" : "unverified"}, ${verified?.careersUrl ?? null},
      ${verified?.adverts ?? null}, NOW())
    ON CONFLICT (organisation_name) DO UPDATE SET
      last_attempted_at = NOW(), last_outcome = EXCLUDED.last_outcome,
      ats_checked_at = CASE WHEN EXCLUDED.ats_mapping_status = 'verified'
        THEN NULL ELSE sponsor_licence_company_site_checks.ats_checked_at END,
      careers_url = COALESCE(EXCLUDED.careers_url, sponsor_licence_company_site_checks.careers_url),
      ats_provider = COALESCE(EXCLUDED.ats_provider, sponsor_licence_company_site_checks.ats_provider),
      ats_board_id = COALESCE(EXCLUDED.ats_board_id, sponsor_licence_company_site_checks.ats_board_id),
      ats_mapping_status = CASE WHEN EXCLUDED.ats_mapping_status = 'verified'
        THEN 'verified' ELSE sponsor_licence_company_site_checks.ats_mapping_status END,
      ats_mapping_evidence_url = COALESCE(EXCLUDED.ats_mapping_evidence_url,
        sponsor_licence_company_site_checks.ats_mapping_evidence_url),
      last_adverts_found = COALESCE(EXCLUDED.last_adverts_found, sponsor_licence_company_site_checks.last_adverts_found),
      updated_at = NOW()
  `);
  if (verified) {
    // Direct-feed selection requires a sponsor website; the board URL is the
    // employer's real careers presence, so seed it when none exists.
    await db.execute(sql`
      UPDATE sponsor_licences
      SET website = ${verified.careersUrl}
      WHERE organisation_name = ${organisationName}
        AND (website IS NULL OR btrim(website) = '')
    `);
  }
}

async function verifyCandidate(organisationName: string, provider: string, careersUrl: string,
  firstParty: boolean, deadlineMs: number): Promise<boolean> {
  try {
    const scan = await fetchDirectEmployerBoard(organisationName, provider, careersUrl, {
      deadlineMs, readOnly: true, noHostState: true, noProcessCache: true,
    });
    const softOk = (scan.identity?.claims ?? []).length > 0 &&
      (scan.identity?.claims ?? []).every((claim) =>
        claim?.name && identityKey(claim.name, true) === identityKey(organisationName, true));
    const identityOk = firstParty
      ? scan.identity?.status !== "mismatched"
      : scan.identity?.status === "matched" || softOk;
    const mapping = scan.mapping ?? parseDirectBoardMapping(provider, careersUrl);
    if (scan.complete && identityOk && mapping && scan.advertsExtracted >= 1) {
      await recordProbe(organisationName, "ats_probe_verified", {
        provider: mapping.provider, boardId: mapping.boardId,
        careersUrl: mapping.evidenceUrl, adverts: scan.advertsExtracted,
      });
      console.log(`VERIFIED ${organisationName} -> ${mapping.provider} ${mapping.boardId} (${scan.advertsExtracted} adverts, firstParty=${firstParty})`);
      return true;
    }
  } catch { /* try next candidate */ }
  return false;
}

const CAREERS_LINK = /career|job|vacanc|work[- ]?with|join[- ]?us|recruit|people|team|staff/i;
const COMMON_CAREERS_PATHS = ["/careers", "/jobs", "/vacancies", "/work-with-us", "/join-us", "/careers-and-jobs"];

async function probeSiteEvidence(organisationName: string, website: string, deadlineMs: number): Promise<string> {
  const origin = new URL(website).hostname;
  const home = await fetchCompanySitePage(website, origin, deadlineMs);
  if (!home.ok) { await recordProbe(organisationName, "ats_probe_site_error"); return "site_error"; }
  const pages = [home];
  // Careers links usually sit one level deep: follow internal careers-ish
  // links from the homepage, and probe a couple of common paths as fallback.
  const careersLinks = new Set<string>();
  for (const m of home.body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(m[1], home.url);
      if (url.hostname === origin && CAREERS_LINK.test(`${m[2]} ${url.pathname}`)) {
        careersLinks.add(url.toString());
      }
    } catch { /* skip */ }
  }
  for (const path of COMMON_CAREERS_PATHS) {
    try { careersLinks.add(new URL(path, home.url).toString()); } catch { /* skip */ }
  }
  for (const url of [...careersLinks].slice(0, 3)) {
    const page = await fetchCompanySitePage(url, origin, deadlineMs);
    if (page.ok) pages.push(page);
  }
  const candidates = pages.flatMap((page) => boardLinkCandidates(page.body, page.url));
  if (!candidates.length) { await recordProbe(organisationName, "ats_probe_no_board_link"); return "no_link"; }
  for (const candidate of candidates.slice(0, 4)) {
    if (await verifyCandidate(organisationName, candidate.provider, candidate.careersUrl, true, deadlineMs)) {
      return "verified";
    }
  }
  await recordProbe(organisationName, "ats_probe_board_empty");
  return "empty";
}

async function probeSlugGuess(organisationName: string, deadlineMs: number): Promise<string> {
  for (const slug of slugCandidates(organisationName)) {
    for (const { provider, boardUrl } of PROVIDERS) {
      if (await verifyCandidate(organisationName, provider, boardUrl(slug), false, deadlineMs)) {
        return "verified";
      }
    }
  }
  await recordProbe(organisationName, "ats_probe_none");
  return "none";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode"));
  const mode = modeArg?.split("=")[1] ?? args[args.indexOf("--mode") + 1] ?? "slug-guess";
  const limit = Number(args[args.indexOf("--limit") + 1]) || 50;
  const concurrency = Math.max(1, Number(args[args.indexOf("--concurrency") + 1]) || 10);
  let verified = 0; let attempted = 0; let totalOffset = 0;
  while (true) {
    const result = mode === "site-evidence"
      ? await db.execute<any>(sql`
          SELECT DISTINCT ON (lower(btrim(sl.organisation_name))) sl.organisation_name,
            NULLIF(btrim(sl.website), '') AS website
          FROM sponsor_licences sl
          WHERE NULLIF(btrim(sl.website), '') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM sponsor_licence_company_site_checks c
              WHERE lower(btrim(c.organisation_name)) = lower(btrim(sl.organisation_name))
                AND (c.last_outcome LIKE 'ats\_probe\_%' OR c.ats_mapping_status = 'verified')
            )
          ORDER BY lower(btrim(sl.organisation_name)), sl.organisation_name
          LIMIT ${limit}`)
      : await db.execute<any>(sql`
          SELECT DISTINCT ON (lower(btrim(sl.organisation_name))) sl.organisation_name
          FROM sponsor_licences sl
          WHERE NOT EXISTS (
            SELECT 1 FROM sponsor_licence_company_site_checks c
            WHERE lower(btrim(c.organisation_name)) = lower(btrim(sl.organisation_name))
              AND (c.last_outcome = 'ats_probe_none' OR c.ats_mapping_status = 'verified')
          )
          ORDER BY lower(btrim(sl.organisation_name)), sl.organisation_name
          LIMIT ${limit} OFFSET ${totalOffset}`);
    if (!result.rows.length) break;
    totalOffset += result.rows.length;
    const queue = [...result.rows];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const row = queue.shift()!;
        const outcome = mode === "site-evidence"
          ? await probeSiteEvidence(row.organisation_name, row.website, Date.now() + 25_000).catch(() => "error")
          : await probeSlugGuess(row.organisation_name, Date.now() + 20_000).catch(() => "error");
        attempted++;
        if (outcome === "verified") verified++;
      }
    }));
    console.log(`progress attempted=${attempted} verified=${verified}`);
  }
  console.log(`DONE attempted=${attempted} verified=${verified}`);
  await pool.end();
}

main().catch(async (error) => { console.error(error); await pool.end(); process.exit(1); });
