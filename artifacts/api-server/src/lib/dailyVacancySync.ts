import cron from "node-cron";
import { runSponsorLicenceSync } from "./sponsorLicenceSync";
import { runCheckAllVacanciesPass } from "./vacancyCheckAllRunner";

/**
 * Full daily pipeline: refresh the sponsor register, then check every
 * organisation for vacancies (24h cache means only stale orgs actually
 * re-query the AI), then rescore vacancies for every candidate.
 */
export async function runDailyVacancySync(): Promise<void> {
  console.log("[daily-vacancy-sync] Starting daily pipeline");

  try {
    await runSponsorLicenceSync("scheduler");
  } catch (err) {
    console.error("[daily-vacancy-sync] Sponsor register sync failed:", err instanceof Error ? err.message : err);
  }

  try {
    await runCheckAllVacanciesPass("scheduler", { rescoreAllUsers: true });
  } catch (err) {
    console.error("[daily-vacancy-sync] Full vacancy check pass failed:", err instanceof Error ? err.message : err);
  }

  console.log("[daily-vacancy-sync] Daily pipeline complete");
}

export function startDailyVacancySyncScheduler(): void {
  // Run once daily at 04:00 Europe/London — after the 02:00 register sync window
  // used historically, but this job also runs its own register sync first.
  cron.schedule(
    "0 4 * * *",
    () => {
      runDailyVacancySync().catch((err) => {
        console.error("[daily-vacancy-sync] Unhandled scheduler error:", err instanceof Error ? err.message : err);
      });
    },
    { timezone: "Europe/London" },
  );

  console.log("[daily-vacancy-sync] Scheduler registered: daily at 04:00 Europe/London");
}
