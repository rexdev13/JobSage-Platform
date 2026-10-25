import { runSponsorLicenceSync } from "./sponsorLicenceSync";

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

  // Disabled: duplicates the 20-min vacancyCheckScheduler pass, was double-billing OpenAI calls.
  // try {
  //   await runCheckAllVacanciesPass("scheduler", { rescoreAllUsers: true });
  // } catch (err) {
  //   console.error("[daily-vacancy-sync] Full vacancy check pass failed:", err instanceof Error ? err.message : err);
  // }

  console.log("[daily-vacancy-sync] Daily pipeline complete");
}

