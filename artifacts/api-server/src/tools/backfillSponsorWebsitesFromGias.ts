/**
 * Backfills sponsor_licences.website from the official DfE GIAS
 * "all establishment data" extract (edubasealldata*.csv, public daily
 * download from get-information-schools.service.gov.uk/Downloads).
 *
 * Matches sponsor organisation_name to EstablishmentName on a normalised key
 * (lowercase, punctuation stripped, whitespace collapsed). Only open
 * establishments with a SchoolWebsite are used; existing websites are never
 * overwritten.
 *
 *   tsx src/tools/backfillSponsorWebsitesFromGias.ts <path-to-csv>
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function norm(s: string): string {
  return s.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("usage: backfillSponsorWebsitesFromGias.ts <gias csv>");

  const rl = createInterface({ input: createReadStream(csvPath) });
  let header: string[] | null = null;
  const websites = new Map<string, string>();
  for await (const line of rl) {
    // GIAS CSV cells never contain newlines for the fields we need.
    const cells = parseCsvLine(line);
    if (!header) { header = cells.map((c) => c.trim()); continue; }
    const get = (name: string) => cells[header!.indexOf(name)]?.trim() ?? "";
    if (get("EstablishmentStatus (name)") !== "Open") continue;
    const site = get("SchoolWebsite");
    const name = get("EstablishmentName");
    if (!site || !name) continue;
    const key = norm(name);
    if (!websites.has(key)) websites.set(key, site);
  }
  console.log(`GIAS rows loaded: ${websites.size} open establishments with websites`);

  const sponsors = await db.execute<{ organisation_name: string }>(sql`
    SELECT DISTINCT organisation_name FROM sponsor_licences
    WHERE website IS NULL OR btrim(website) = ''
  `);
  let matched = 0;
  let updated = 0;
  for (const row of sponsors.rows) {
    const site = websites.get(norm(row.organisation_name));
    if (!site) continue;
    matched++;
    const res = await db.execute(sql`
      UPDATE sponsor_licences SET website = ${site}
      WHERE organisation_name = ${row.organisation_name}
        AND (website IS NULL OR btrim(website) = '')
    `);
    updated += res.rowCount ?? 0;
  }
  console.log(`matched ${matched} sponsors -> updated ${updated} sponsor_licences rows`);
  process.exit(0);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

main().catch((error) => { console.error(error); process.exit(1); });
