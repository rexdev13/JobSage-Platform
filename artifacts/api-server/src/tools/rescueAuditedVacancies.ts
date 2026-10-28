/**
 * Rescues audited board listings that were rejected as
 * 'no_sponsor_identity_match' but whose employer name is the same sponsor
 * modulo legal-suffix / punctuation variants ("ABC Ltd" vs "ABC LIMITED").
 *
 * Safety: only unambiguous normalized keys are rescued — a normalized key
 * must map to exactly ONE sponsor and be >= 5 chars, so generic short names
 * ("CARE") can never false-match. Rescued audits are re-marked
 * 'rescued_sponsor_match' so stats stay honest.
 *
 * Usage: tsx src/tools/rescueAuditedVacancies.ts [--dry-run]
 */
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const LEGAL_SUFFIXES = ["the", "ltd", "limited", "plc", "llp", "lp", "inc", "llc",
  "company", "co", "corporation", "corp", "holdings", "holding", "group", "uk"];

function normKey(value: string): string {
  const words = value.toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1]!)) words.pop();
  if (words[0] === "the" && words.length > 1) words.shift();
  return words.join(" ");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const sponsors = await db.execute<any>(sql`SELECT organisation_name FROM sponsor_licences`);
  const keyToSponsors = new Map<string, Set<string>>();
  for (const row of sponsors.rows) {
    const key = normKey(String(row.organisation_name));
    if (!key) continue;
    (keyToSponsors.get(key) ?? keyToSponsors.set(key, new Set()).get(key)!).add(String(row.organisation_name));
  }
  const eligible = new Map<string, string>();
  for (const [key, names] of keyToSponsors) {
    if (names.size === 1 && key.length >= 5) eligible.set(key, [...names][0]!);
  }
  console.log(`sponsors=${sponsors.rows.length} eligible_norm_keys=${eligible.size}`);

  const audits = await db.execute<any>(sql`
    SELECT id, source_id, provider, board_name, external_id, employer_name, title, listing_url
    FROM vacancy_source_listing_audits
    WHERE match_reason = 'no_sponsor_identity_match'`);
  console.log(`audits=${audits.rows.length}`);

  const existing = await db.execute<any>(sql`
    SELECT board_name, external_listing_id, url FROM sponsor_licence_vacancies
    WHERE source_type = 'job_board'`);
  const have = new Set(existing.rows.map((r) => `${r.board_name}|${r.external_listing_id ?? ""}|${r.url ?? ""}`));

  let rescued = 0, ambiguous = 0, noKey = 0;
  const updates: number[] = [];
  for (const row of audits.rows) {
    const key = normKey(String(row.employer_name));
    const sponsor = key ? eligible.get(key) : undefined;
    if (!sponsor) { key ? ambiguous++ : noKey++; continue; }
    const listingKey = `${row.board_name}|${row.external_id ?? ""}|${row.listing_url ?? ""}`;
    const extKey = `${row.board_name}|${row.source_id}:${row.external_id}|${row.listing_url ?? ""}`;
    if (have.has(listingKey) || have.has(extKey)) { updates.push(row.id); continue; }
    if (!dryRun) {
      await db.execute(sql`
        INSERT INTO sponsor_licence_vacancies
          (organisation_name, check_date, title, location, url, application_url,
           source_type, board_name, external_listing_id, liveness, source_metadata)
        VALUES (${sponsor}, CURRENT_DATE, ${row.title}, NULL,
          ${row.listing_url}, ${row.listing_url}, 'job_board', ${row.board_name},
          ${`${row.source_id}:${row.external_id}`}, 'unverified',
          ${JSON.stringify({ rescuedFromAudit: true, provider: row.provider, employerName: row.employer_name })}::jsonb)`);
      have.add(extKey);
    }
    updates.push(row.id);
    rescued++;
  }
  if (!dryRun && updates.length) {
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      await db.execute(sql`UPDATE vacancy_source_listing_audits
        SET match_reason = 'rescued_sponsor_match'
        WHERE id IN ${sql.raw(`(${chunk.join(",")})`)}`);
    }
  }
  console.log(`rescued=${rescued} ambiguous=${ambiguous} no_key=${noKey} marked=${updates.length} dryRun=${dryRun}`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
