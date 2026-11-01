/**
 * One-off cleanup matching applySponsorVolumeGuard for rows already stored.
 *
 * For every sponsor holding more than --limit vacancies (default
 * SPONSOR_BATCH_VACANCY_LIMIT), repeated title+location postings are
 * collapsed to the oldest row, unpaid/volunteer titles are removed, and the
 * sponsor is capped at --limit rows (newest surplus removed). Rows with
 * applications or scores attached are never removed.
 *
 * Usage: tsx src/tools/pruneMassPostingSponsors.ts [--limit=300] [--apply]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { SPONSOR_BATCH_VACANCY_LIMIT } from "../lib/boardVacancyPipeline";
import { isUnpaidRoleTitle } from "../lib/vacancyTitlePolicy";

type Row = { id: number; organisation_name: string; title: string; location: string | null; created_at: string };

const norm = (v: string | null) => (v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : SPONSOR_BATCH_VACANCY_LIMIT;
  const apply = args.includes("--apply");

  const sponsors = await db.execute<{ organisation_name: string; n: number }>(sql`
    SELECT organisation_name, count(*)::int AS n
    FROM sponsor_licence_vacancies
    GROUP BY organisation_name
    HAVING count(*) > ${limit}
    ORDER BY n DESC
  `);

  const toDelete: number[] = [];
  for (const sponsor of sponsors.rows) {
    const rows = await db.execute<Row>(sql`
      SELECT v.id, v.organisation_name, v.title, v.location, v.created_at
      FROM sponsor_licence_vacancies v
      WHERE v.organisation_name = ${sponsor.organisation_name}
        AND NOT EXISTS (SELECT 1 FROM sponsor_licence_vacancy_scores s WHERE s.vacancy_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM sponsor_licence_gap_analyses g WHERE g.vacancy_id = v.id)
      ORDER BY v.created_at ASC, v.id ASC
    `);
    const seen = new Set<string>();
    const kept: Row[] = [];
    let unpaid = 0;
    let dupes = 0;
    for (const row of rows.rows) {
      if (isUnpaidRoleTitle(row.title)) { unpaid++; toDelete.push(row.id); continue; }
      const key = `${norm(row.title)}|${norm(row.location)}`;
      if (seen.has(key)) { dupes++; toDelete.push(row.id); continue; }
      seen.add(key);
      kept.push(row);
    }
    const surplus = kept.slice(limit);
    toDelete.push(...surplus.map((r) => r.id));
    console.log(
      `${sponsor.organisation_name}: ${sponsor.n} rows -> unpaid ${unpaid}, duplicate ${dupes}, over-limit ${surplus.length}, keep ${Math.min(kept.length, limit)}`,
    );
  }

  console.log(`${apply ? "Deleting" : "Would delete"} ${toDelete.length} rows across ${sponsors.rows.length} sponsors`);
  if (apply && toDelete.length) {
    for (let i = 0; i < toDelete.length; i += 500) {
      const chunk = toDelete.slice(i, i + 500);
      await db.execute(sql`DELETE FROM sponsor_licence_vacancies WHERE id = ANY(${sql.param(chunk)}::int[])`);
    }
    console.log("done");
  }
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
