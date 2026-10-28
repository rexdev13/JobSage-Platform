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
 * Usage: tsx src/tools/discoverSponsorAtsBoards.ts --mode=site-evidence|slug-guess [--limit N] [--concurrency N] [--shard K/N] [--providers a,b,...] [--retry=none]
 * --shard K/N runs shard K of N disjoint name-hash partitions, so N parallel
 * processes cover the sponsor list without overlapping work.
 * --providers limits slug-guess to a comma list of provider ids
 * (greenhouse,lever,ashby,smartrecruiters,recruitee,personio,pinpoint).
 * --retry=none re-selects sponsors whose previous slug-guess outcome was
 * 'ats_probe_none' — used to sweep the failed set against newly added
 * providers instead of re-probing everything.
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

const ATS_LINK = /greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|recruitee\.com|jobs\.personio\.|pinpointhq\.com|myworkdayjobs\.com|bamboohr\.com|workable\.com|teamtailor\.com|icims\.com/i;

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

const PROVIDERS: { id: string; provider: string; boardUrl: (slug: string) => string }[] = [
  { id: "greenhouse", provider: "Greenhouse", boardUrl: (s) => `https://job-boards.greenhouse.io/${s}` },
  { id: "lever", provider: "Lever", boardUrl: (s) => `https://jobs.lever.co/${s}` },
  { id: "ashby", provider: "Ashby", boardUrl: (s) => `https://jobs.ashbyhq.com/${s}` },
  { id: "smartrecruiters", provider: "SmartRecruiters", boardUrl: (s) => `https://jobs.smartrecruiters.com/${s}` },
  { id: "recruitee", provider: "Recruitee", boardUrl: (s) => `https://${s}.recruitee.com/` },
  { id: "personio", provider: "Personio", boardUrl: (s) => `https://${s}.jobs.personio.com/` },
  { id: "pinpoint", provider: "Pinpoint", boardUrl: (s) => `https://${s}.pinpointhq.com/` },
  { id: "workable", provider: "Workable", boardUrl: (s) => `https://apply.workable.com/${s}/` },
  { id: "teamtailor", provider: "Teamtailor", boardUrl: (s) => `https://${s}.teamtailor.com/jobs` },
  { id: "icims", provider: "iCIMS", boardUrl: (s) => `https://careers-${s}.icims.com/jobs` },
];

function boardRootUrl(url: URL): { provider: string; careersUrl: string } | null {
  const host = url.hostname.toLowerCase();
  const seg = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(seg)) {
    if (/^[a-z0-9-]+\.recruitee\.com$/i.test(host)) return { provider: "Recruitee", careersUrl: `https://${host}/` };
    if (/^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/i.test(host)) return { provider: "Personio", careersUrl: `https://${host}/` };
    if (/^([a-z0-9-]+)\.pinpointhq\.com$/i.test(host)) return { provider: "Pinpoint", careersUrl: `https://${host}/` };
    if (/^[a-z0-9-]+\.bamboohr\.com$/i.test(host)) return { provider: "BambooHR", careersUrl: `https://${host}/careers` };
    const wdHost = /^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host);
    if (wdHost) {
      const site = url.pathname.split("/").filter(Boolean)
        .find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
      return site ? { provider: "Workday", careersUrl: `https://${host}/${site}` } : null;
    }
    if (/^[a-z0-9-]+\.teamtailor\.com$/i.test(host)) return { provider: "Teamtailor", careersUrl: `https://${host}/jobs` };
    if (/^careers-[a-z0-9-]+\.icims\.com$/i.test(host)) return { provider: "iCIMS", careersUrl: `https://${host}/jobs` };
    return null;
  }
  if (/^(?:www\.)?jobs\.ashbyhq\.com$/i.test(host)) return { provider: "Ashby", careersUrl: `https://jobs.ashbyhq.com/${seg}` };
  if (/^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/i.test(host)) return { provider: "Greenhouse", careersUrl: `https://job-boards.greenhouse.io/${seg}` };
  if (/^jobs(?:\.eu)?\.lever\.co$/i.test(host)) return { provider: "Lever", careersUrl: `https://jobs.lever.co/${seg}` };
  if (/^jobs\.smartrecruiters\.com$/i.test(host)) return { provider: "SmartRecruiters", careersUrl: `https://jobs.smartrecruiters.com/${seg}` };
  if (/^[a-z0-9-]+\.recruitee\.com$/i.test(host)) return { provider: "Recruitee", careersUrl: `https://${host}/` };
  if (/^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/i.test(host)) return { provider: "Personio", careersUrl: `https://${host}/` };
  if (/^([a-z0-9-]+)\.pinpointhq\.com$/i.test(host)) return { provider: "Pinpoint", careersUrl: `https://${host}/` };
  if (/^[a-z0-9-]+\.bamboohr\.com$/i.test(host)) return { provider: "BambooHR", careersUrl: `https://${host}/careers` };
  if (/^apply\.workable\.com$/i.test(host)) return { provider: "Workable", careersUrl: `https://apply.workable.com/${seg}/` };
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) {
    const site = url.pathname.split("/").filter(Boolean)
      .find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
    return site ? { provider: "Workday", careersUrl: `https://${host}/${site}` } : null;
  }
  if (/^[a-z0-9-]+\.teamtailor\.com$/i.test(host)) return { provider: "Teamtailor", careersUrl: `https://${host}/jobs` };
  if (/^careers-[a-z0-9-]+\.icims\.com$/i.test(host)) return { provider: "iCIMS", careersUrl: `https://${host}/jobs` };
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
    // Workday boards can exceed the probe's fetch deadline on big inventories;
    // a partial-but-structured feed still proves the board. Harvest re-fetches
    // with its own budget and only persists when the feed completes there.
    const feedOk = scan.complete || mapping?.provider === "Workday";
    if (feedOk && identityOk && mapping && scan.advertsExtracted >= 1) {
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

async function probeSlugGuess(organisationName: string, deadlineMs: number,
  providers: typeof PROVIDERS): Promise<string> {
  for (const slug of slugCandidates(organisationName)) {
    for (const { provider, boardUrl } of providers) {
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
  const shardArg = args.find((a) => a.startsWith("--shard"));
  const [shardIndex, shards] = (() => {
    const raw = shardArg?.includes("=") ? shardArg.split("=")[1] : shardArg ? args[args.indexOf("--shard") + 1] : "0/1";
    const [k, n] = (raw ?? "0/1").split("/").map(Number);
    return [Math.max(0, k || 0), Math.max(1, n || 1)];
  })();
  const providersArg = args.find((a) => a.startsWith("--providers"));
  const providerFilter = providersArg
    ? (providersArg.includes("=") ? providersArg.split("=")[1] : args[args.indexOf("--providers") + 1] ?? "")
        .split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)
    : [];
  const providers = providerFilter.length
    ? PROVIDERS.filter((p) => providerFilter.includes(p.id))
    : PROVIDERS;
  if (!providers.length) { console.error("no providers matched --providers filter"); process.exit(2); }
  const retryNone = args.some((a) => a === "--retry=none" || a === "--retry" && args[args.indexOf(a) + 1] === "none");
  const sectorsArg = args.find((a) => a.startsWith("--sectors"));
  const sectors = sectorsArg
    ? (sectorsArg.includes("=") ? sectorsArg.split("=")[1] : args[args.indexOf("--sectors") + 1] ?? "")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  const sectorWhere = sectors.length
    ? sql`AND lower(btrim(COALESCE(sl.industry, ''))) = ANY(${sql.param(sectors)}::text[])`
    : sql``;
  let verified = 0; let attempted = 0;
  while (true) {
    const result = mode === "site-evidence"
      ? await db.execute<any>(sql`
          SELECT DISTINCT ON (lower(btrim(sl.organisation_name))) sl.organisation_name,
            NULLIF(btrim(sl.website), '') AS website
          FROM sponsor_licences sl
          WHERE NULLIF(btrim(sl.website), '') IS NOT NULL
            ${sectorWhere}
            AND mod((hashtext(lower(btrim(sl.organisation_name)))::bigint & 2147483647), ${shards}) = ${shardIndex}
            AND ${retryNone
              ? sql`EXISTS (
              SELECT 1 FROM sponsor_licence_company_site_checks c
              WHERE lower(btrim(c.organisation_name)) = lower(btrim(sl.organisation_name))
                AND c.last_outcome = 'ats_probe_none' AND c.ats_mapping_status <> 'verified'
            )`
              : sql`NOT EXISTS (
              SELECT 1 FROM sponsor_licence_company_site_checks c
              WHERE lower(btrim(c.organisation_name)) = lower(btrim(sl.organisation_name))
                AND (c.last_outcome LIKE 'ats\_probe\_%' OR c.ats_mapping_status = 'verified')
            )`}
          ORDER BY lower(btrim(sl.organisation_name)), sl.organisation_name
          LIMIT ${limit}`)
      : await db.execute<any>(sql`
          SELECT organisation_name FROM (
            SELECT DISTINCT ON (lower(btrim(sl.organisation_name))) sl.organisation_name, sl.industry
            FROM sponsor_licences sl
            WHERE ${retryNone
              ? sql`EXISTS (
              SELECT 1 FROM sponsor_licence_company_site_checks c
              WHERE lower(btrim(c.organisation_name)) = lower(btrim(sl.organisation_name))
                AND c.last_outcome = 'ats_probe_none' AND c.ats_mapping_status <> 'verified'
            )`
              : sql`NOT EXISTS (
              SELECT 1 FROM sponsor_licence_company_site_checks c
              WHERE lower(btrim(c.organisation_name)) = lower(btrim(sl.organisation_name))
                AND (c.last_outcome = 'ats_probe_none' OR c.ats_mapping_status = 'verified')
            )`}
            ${sectorWhere}
            AND mod((hashtext(lower(btrim(sl.organisation_name)))::bigint & 2147483647), ${shards}) = ${shardIndex}
            ORDER BY lower(btrim(sl.organisation_name)), sl.organisation_name
          ) t
          ORDER BY
            CASE
              WHEN lower(btrim(COALESCE(industry, ''))) ~ '(technology|software|digital|cyber|data|telecom|finance|financial|fintech|bank|insurance|legal|law|engineer|manufactur|construction|architect|hospitality|hotel|restaurant|retail|wholesale|logistics|transport|warehouse|pharma|biotech|life science|energy|aerospace|defence|media|marketing|advertis|consult)' THEN 0
              ELSE 1
            END,
            lower(btrim(organisation_name)), organisation_name
          LIMIT ${limit}`);
    if (!result.rows.length) break;
    const queue = [...result.rows];
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const row = queue.shift()!;
        const outcome = mode === "site-evidence"
          ? await probeSiteEvidence(row.organisation_name, row.website, Date.now() + 25_000).catch(() => "error")
          : await probeSlugGuess(row.organisation_name, Date.now() + 20_000, providers).catch(() => "error");
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
