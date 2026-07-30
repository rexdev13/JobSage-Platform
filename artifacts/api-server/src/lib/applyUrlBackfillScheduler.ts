import cron from "node-cron";
import { runApplyUrlBackfill } from "./applyUrlBackfill";
import { runSponsorVacancyApplyUrlBackfill } from "./sponsorVacancyApplyUrlBackfill";

/**
 * Start the apply-URL backfill scheduler.
 * Runs once a day at 03:00 Europe/London to pick up newly imported roles
 * that don't yet have an apply URL.
 */
export function startApplyUrlBackfillScheduler(): void {
  cron.schedule(
    "0 3 * * *",
    () => {
      runApplyUrlBackfill({ triggeredBy: "scheduler", batchSize: 50 }).catch(
        (err) => {
          console.error("[apply-url-backfill-scheduler] Unhandled error:", err);
        },
      );
      // Run sponsor-vacancy pass immediately after the roles pass in the same window.
      runSponsorVacancyApplyUrlBackfill({ triggeredBy: "scheduler", batchSize: 50 }).catch(
        (err) => {
          console.error("[sponsor-vacancy-backfill-scheduler] Unhandled error:", err);
        },
      );
    },
    { timezone: "Europe/London" },
  );

  console.log(
    "[apply-url-backfill-scheduler] Registered: daily at 03:00 Europe/London",
  );
}
