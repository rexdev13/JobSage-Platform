import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchText } from "./freeBoardSources";
import { inferVacancySponsorshipStatus } from "./sponsorVacancyRoles";

/**
 * NHS Jobs search results only carry a short summary, but the full advert
 * states whether the employer accepts Certificate of Sponsorship applicants
 * (or explicitly cannot sponsor). The search API finds the adverts that
 * mention sponsorship; only those pages are fetched, politely and in
 * sequence, and the sponsorship sentences are stored verbatim as evidence in
 * source_metadata.sponsorshipEvidence. No sentence means no evidence.
 */

const NHS_SEARCH = "https://www.jobs.nhs.uk/api/v1/search_xml";
const KEYWORDS = ["sponsorship", "certificate of sponsorship", "visa sponsorship"];
const PAGE_DELAY_MS = 1_000;
export const NHS_EVIDENCE_RECHECK_DAYS = 7;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function decode(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

/** Unique sentences mentioning sponsorship, sponsor licences or tier 2 / skilled worker visas. */
export function extractSponsorshipSentences(html: string): string[] {
  const text = decode(html);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out = new Set<string>();
  for (const sentence of sentences) {
    if (!/\bsponsor(?:ship|ed)?\b|\btier\s*2\b|\bskilled\s+worker\b/i.test(sentence)) continue;
    if (/\bcriminal record certificate\b|\bUK Visas and Immigration website\b/i.test(sentence)) continue;
    const trimmed = sentence.trim().slice(0, 400);
    if (trimmed.length >= 20) out.add(trimmed);
    if (out.size >= 6) break;
  }
  return [...out];
}

async function searchReferences(deadlineMs: number): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const keyword of KEYWORDS) {
    for (let page = 1; page <= 60 && Date.now() < deadlineMs; page++) {
      const url = new URL(NHS_SEARCH);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", "100");
      const xml = await fetchText(url.toString(), deadlineMs);
      const found = [...xml.matchAll(/<reference>([^<]+)<\/reference>/g)].map((m) => m[1]!.trim());
      found.forEach((ref) => refs.add(ref));
      const totalPages = Number(xml.match(/<totalPages>(\d+)<\/totalPages>/)?.[1] ?? 0);
      if (!found.length || page >= totalPages) break;
      await sleep(PAGE_DELAY_MS);
    }
  }
  return refs;
}

export type NhsSponsorshipEvidenceSummary = {
  referencesFound: number;
  candidates: number;
  checked: number;
  confirmed: number;
  notOffered: number;
  unknown: number;
  errors: number;
};

export async function runNhsSponsorshipEvidenceBatch(options: {
  limit?: number;
  deadlineMs?: number;
} = {}): Promise<NhsSponsorshipEvidenceSummary> {
  const deadlineMs = options.deadlineMs ?? Date.now() + 10 * 60_000;
  const limit = Math.max(1, options.limit ?? 300);
  const refs = await searchReferences(deadlineMs);
  const rows = refs.size === 0 ? { rows: [] } : await db.execute<{ id: number; url: string }>(sql`
    SELECT id, url FROM sponsor_licence_vacancies
    WHERE board_name = 'NHS Jobs'
      AND liveness <> 'dead'
      AND external_listing_id = ANY(${sql.param([...refs])}::text[])
      AND (source_metadata->'sponsorshipEvidence'->>'checkedAt' IS NULL
        OR (source_metadata->'sponsorshipEvidence'->>'checkedAt')::timestamptz
           < NOW() - make_interval(days => ${NHS_EVIDENCE_RECHECK_DAYS}))
    ORDER BY id DESC
    LIMIT ${limit}
  `);
  const summary: NhsSponsorshipEvidenceSummary = {
    referencesFound: refs.size,
    candidates: rows.rows.length,
    checked: 0, confirmed: 0, notOffered: 0, unknown: 0, errors: 0,
  };
  for (const row of rows.rows) {
    if (Date.now() >= deadlineMs - 20_000) break;
    try {
      const html = await fetchText(row.url, deadlineMs);
      const sentences = extractSponsorshipSentences(html);
      const status = sentences.length
        ? inferVacancySponsorshipStatus("", sentences.join("\n"))
        : "unknown";
      const evidence = { status, sentences, url: row.url, checkedAt: new Date().toISOString() };
      await db.execute(sql`
        UPDATE sponsor_licence_vacancies
        SET source_metadata = jsonb_set(COALESCE(source_metadata, '{}'::jsonb), '{sponsorshipEvidence}', ${JSON.stringify(evidence)}::jsonb)
        WHERE id = ${row.id}
      `);
      summary.checked++;
      if (status === "confirmed") summary.confirmed++;
      else if (status === "not_offered") summary.notOffered++;
      else summary.unknown++;
    } catch (error) {
      summary.errors++;
      console.warn(`[nhs-sponsorship] ${row.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(PAGE_DELAY_MS);
  }
  return summary;
}
