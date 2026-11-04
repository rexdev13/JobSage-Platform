import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { SPONSOR_BATCH_VACANCY_LIMIT } from "./boardVacancyPipeline";
import { isUnpaidRoleTitle } from "./vacancyTitlePolicy";

/**
 * Stored-row equivalents of the pipeline's dedupe rules, for data written
 * before those rules existed (or imported from another database). Both are
 * dry runs unless apply is true, and never remove rows that already have
 * scores or gap analyses attached.
 */

export type RepeatCollapseResult = { bySource: Record<string, number>; total: number; applied: boolean };

const REPEATED_ROWS = sql`
  SELECT ranked.id FROM (
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
  ) ranked
  WHERE ranked.rn > 1
`;

/** Same source + employer + title + location is one vacancy; keep the best row. */
export async function collapseRepeatedListings(apply = false): Promise<RepeatCollapseResult> {
  const perSource = await db.execute<{ source: string; n: number }>(sql`
    SELECT coalesce(board_name, source_type) AS source, count(*)::int AS n
    FROM sponsor_licence_vacancies WHERE id IN (${REPEATED_ROWS})
    GROUP BY 1 ORDER BY n DESC
  `);
  const bySource = Object.fromEntries(perSource.rows.map((row) => [row.source, Number(row.n)]));
  const total = Object.values(bySource).reduce((sum: number, n: number) => sum + n, 0);
  if (apply && total > 0) {
    await db.execute(sql`DELETE FROM sponsor_licence_vacancies WHERE id IN (${REPEATED_ROWS})`);
  }
  return { bySource, total, applied: apply };
}

export type MassPostingPruneResult = {
  sponsors: { organisationName: string; rows: number; unpaid: number; duplicate: number; overLimit: number }[];
  total: number;
  applied: boolean;
};

type StoredRow = { id: number; title: string; location: string | null };
const norm = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Caps sponsors above the batch limit and drops their unpaid/repeated rows. */
export async function pruneMassPostingSponsors(
  limit = SPONSOR_BATCH_VACANCY_LIMIT,
  apply = false,
): Promise<MassPostingPruneResult> {
  const sponsors = await db.execute<{ organisation_name: string; n: number }>(sql`
    SELECT organisation_name, count(*)::int AS n FROM sponsor_licence_vacancies
    GROUP BY organisation_name HAVING count(*) > ${limit} ORDER BY n DESC
  `);
  const toDelete: number[] = [];
  const report: MassPostingPruneResult["sponsors"] = [];
  for (const sponsor of sponsors.rows) {
    const rows = await db.execute<StoredRow>(sql`
      SELECT v.id, v.title, v.location FROM sponsor_licence_vacancies v
      WHERE v.organisation_name = ${sponsor.organisation_name}
        AND NOT EXISTS (SELECT 1 FROM sponsor_licence_vacancy_scores s WHERE s.vacancy_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM sponsor_licence_gap_analyses g WHERE g.vacancy_id = v.id)
      ORDER BY v.created_at ASC, v.id ASC
    `);
    const seen = new Set<string>();
    const kept: StoredRow[] = [];
    let unpaid = 0;
    let duplicate = 0;
    for (const row of rows.rows) {
      if (isUnpaidRoleTitle(row.title)) { unpaid++; toDelete.push(row.id); continue; }
      const key = `${norm(row.title)}|${norm(row.location)}`;
      if (seen.has(key)) { duplicate++; toDelete.push(row.id); continue; }
      seen.add(key);
      kept.push(row);
    }
    const surplus = kept.slice(limit);
    toDelete.push(...surplus.map((row) => row.id));
    report.push({
      organisationName: sponsor.organisation_name,
      rows: Number(sponsor.n),
      unpaid,
      duplicate,
      overLimit: surplus.length,
    });
  }
  if (apply) {
    for (let i = 0; i < toDelete.length; i += 500) {
      await db.execute(sql`DELETE FROM sponsor_licence_vacancies WHERE id = ANY(${sql.param(toDelete.slice(i, i + 500))}::int[])`);
    }
  }
  return { sponsors: report, total: toDelete.length, applied: apply };
}
