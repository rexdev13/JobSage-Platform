/**
 * One-off cleanup for vacancies already stored before same-source repeat
 * collapsing existed in normaliseAndDedupeBoardAdverts.
 *
 * Within one source (board name, or the employer's own site) the same
 * employer + title + location is one vacancy. Keeps the best row per group
 * (has a score/gap analysis > live > unverified > dead, then oldest) and
 * deletes the rest.
 *
 * Usage: tsx src/tools/collapseRepeatedListings.ts [--apply]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const ranked = sql`
    SELECT v.id
    FROM (
      SELECT v.id,
        row_number() OVER (
          PARTITION BY coalesce(v.board_name, v.source_type),
            lower(btrim(v.organisation_name)),
            lower(btrim(v.title)),
            lower(btrim(coalesce(v.location, '')))
          ORDER BY
            (EXISTS (SELECT 1 FROM sponsor_licence_vacancy_scores s WHERE s.vacancy_id = v.id)
             OR EXISTS (SELECT 1 FROM sponsor_licence_gap_analyses g WHERE g.vacancy_id = v.id)) DESC,
            CASE v.liveness WHEN 'live' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END,
            v.created_at, v.id
        ) AS rn
      FROM sponsor_licence_vacancies v
    ) v
    WHERE v.rn > 1
  `;
  const perSource = await db.execute<{ source: string; n: number }>(sql`
    SELECT coalesce(board_name, source_type) AS source, count(*)::int AS n
    FROM sponsor_licence_vacancies WHERE id IN (${ranked})
    GROUP BY 1 ORDER BY n DESC
  `);
  for (const row of perSource.rows) console.log(`${row.source}: ${row.n} repeats`);
  const total = perSource.rows.reduce((sum, row) => sum + row.n, 0);
  console.log(`${apply ? "Deleting" : "Would delete"} ${total} rows`);
  if (apply && total) {
    await db.execute(sql`DELETE FROM sponsor_licence_vacancies WHERE id IN (${ranked})`);
    console.log("done");
  }
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
