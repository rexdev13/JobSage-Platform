import cron from "node-cron";
import { syncCalendlyEvents } from "./calendlySync";

let started = false;

export function startCalendlySyncScheduler(): void {
  if (started) return;
  started = true;

  cron.schedule("*/10 * * * *", () => {
    void syncCalendlyEvents()
      .then((summary) => {
        if (!summary.alreadyRunning) {
          console.log(
            `[calendly-sync] Scheduled synchronization complete: scanned=${summary.scanned} imported=${summary.imported} updated=${summary.updated} unmapped=${summary.skippedUnmappedHost}`,
          );
        }
      })
      .catch((error) => {
        console.error("[calendly-sync] Scheduled synchronization failed:", error);
      });
  });

  const initialSync = setTimeout(() => {
    void syncCalendlyEvents()
      .then((summary) => {
        if (!summary.alreadyRunning) {
          console.log(
            `[calendly-sync] Initial synchronization complete: scanned=${summary.scanned} imported=${summary.imported} updated=${summary.updated} unmapped=${summary.skippedUnmappedHost}`,
          );
        }
      })
      .catch((error) => {
        console.error("[calendly-sync] Initial synchronization failed:", error);
      });
  }, 15_000);
  initialSync.unref();
}