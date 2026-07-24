/**
 * One-off runner: purge aggregator / generic vacancy URLs from
 * sponsor_licence_vacancies. Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/runVacancyUrlCleanup.ts
 */
import { runVacancyUrlCleanup } from "../lib/vacancyUrlCleanup";

runVacancyUrlCleanup("manual")
  .then((summary) => {
    console.log("[vacancy-url-cleanup] Done:", JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("[vacancy-url-cleanup] Failed:", err);
    process.exit(1);
  });
