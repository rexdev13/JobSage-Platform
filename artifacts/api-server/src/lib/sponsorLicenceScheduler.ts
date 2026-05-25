import cron from "node-cron";
import { runSponsorLicenceSync } from "./sponsorLicenceSync";

export function startSponsorLicenceScheduler(): void {
  cron.schedule(
    "0 2 * * *",
    () => {
      runSponsorLicenceSync().catch((err) => {
        console.error("[sponsor-sync] Unhandled scheduler error:", err);
      });
    },
    { timezone: "Europe/London" },
  );

  console.log("[sponsor-sync] Scheduler registered: daily at 02:00 Europe/London");
}
