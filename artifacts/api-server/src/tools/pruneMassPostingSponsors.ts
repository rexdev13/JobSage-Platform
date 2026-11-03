/**
 * Usage: tsx src/tools/pruneMassPostingSponsors.ts [--limit=300] [--apply]
 * See pruneMassPostingSponsors in lib/vacancyDedupeMaintenance.
 */
import { pool } from "@workspace/db";
import { SPONSOR_BATCH_VACANCY_LIMIT } from "../lib/boardVacancyPipeline";
import { pruneMassPostingSponsors } from "../lib/vacancyDedupeMaintenance";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : SPONSOR_BATCH_VACANCY_LIMIT;
const apply = args.includes("--apply");
pruneMassPostingSponsors(limit, apply)
  .then((result) => {
    for (const s of result.sponsors) {
      console.log(`${s.organisationName}: ${s.rows} rows -> unpaid ${s.unpaid}, duplicate ${s.duplicate}, over-limit ${s.overLimit}`);
    }
    console.log(`${apply ? "Deleted" : "Would delete"} ${result.total} rows across ${result.sponsors.length} sponsors`);
  })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
