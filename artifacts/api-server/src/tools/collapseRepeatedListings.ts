/**
 * Usage: tsx src/tools/collapseRepeatedListings.ts [--apply]
 * See collapseRepeatedListings in lib/vacancyDedupeMaintenance.
 */
import { pool } from "@workspace/db";
import { collapseRepeatedListings } from "../lib/vacancyDedupeMaintenance";

const apply = process.argv.includes("--apply");
collapseRepeatedListings(apply)
  .then((result) => {
    for (const [source, n] of Object.entries(result.bySource)) console.log(`${source}: ${n} repeats`);
    console.log(`${apply ? "Deleted" : "Would delete"} ${result.total} rows`);
  })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
