import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runVacancyCheck } from "../lib/vacancyCheckHelper";

type OrganisationRow = { organisation_name: string };

const limit = Math.max(1, Math.min(200, Number(process.env["JOB_BOARD_CATCHUP_LIMIT"] ?? 30)));
const result = await db.execute<OrganisationRow>(sql`
  SELECT DISTINCT sl.organisation_name
  FROM sponsor_licences sl
  WHERE sl.industry ~* 'health|hospital|medical|nursing|care|social[[:space:]]*work|dental|pharma'
    AND (
      EXISTS (
        SELECT 1 FROM sponsor_licence_vacancies sv
        WHERE sv.organisation_name = sl.organisation_name
      )
      OR EXISTS (
        SELECT 1 FROM sponsor_licence_vacancy_checks sc
        WHERE sc.organisation_name = sl.organisation_name
      )
      OR EXISTS (
        SELECT 1
        FROM sponsor_licence_bookmarks sb
        WHERE sb.sponsor_licence_id = sl.id
      )
    )
  ORDER BY sl.organisation_name
  LIMIT ${limit}
`);

let checked = 0;
let vacancies = 0;
let errors = 0;
const queue = [...result.rows];
const concurrency = 4;
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) return;
      try {
        const outcome = await runVacancyCheck(row.organisation_name, { bypassCache: true });
        checked += 1;
        vacancies += outcome.vacancyList?.length ?? 0;
      } catch (error) {
        errors += 1;
        console.warn(
          `[job-board-catchup] failed organisation="${row.organisation_name}"`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }),
);

console.log(JSON.stringify({ selected: result.rows.length, checked, vacancies, errors }, null, 2));