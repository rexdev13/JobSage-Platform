import cron from "node-cron";
import { getCalendlyConnectionIssue, syncCalendlyEvents } from "./calendlySync";
import { logger } from "./logger";

let started = false;
let lastReportedConnectionIssue: string | null = null;

function reportSyncFailure(error: unknown, source: "scheduled" | "initial"): void {
  const connectionIssue = getCalendlyConnectionIssue(error);
  if (connectionIssue) {
    if (lastReportedConnectionIssue !== connectionIssue.connectionStatus) {
      logger.warn(
        { connectionStatus: connectionIssue.connectionStatus },
        "Calendly sync is waiting for a valid connection",
      );
    }
    lastReportedConnectionIssue = connectionIssue.connectionStatus;
    return;
  }

  logger.error(
    { source, errorKind: error instanceof Error ? error.name : "unknown" },
    "Calendly synchronization failed",
  );
}

export function startCalendlySyncScheduler(): void {
  if (started) return;
  started = true;

  cron.schedule("*/10 * * * *", () => {
    void syncCalendlyEvents()
      .then((summary) => {
        if (!summary.alreadyRunning) {
          lastReportedConnectionIssue = null;
          logger.info(
            {
              scanned: summary.scanned,
              imported: summary.imported,
              updated: summary.updated,
              skippedUnmappedHost: summary.skippedUnmappedHost,
            },
            "Scheduled Calendly synchronization completed",
          );
        }
      })
      .catch((error) => reportSyncFailure(error, "scheduled"));
  });

  const initialSync = setTimeout(() => {
    void syncCalendlyEvents()
      .then((summary) => {
        if (!summary.alreadyRunning) {
          lastReportedConnectionIssue = null;
          logger.info(
            {
              scanned: summary.scanned,
              imported: summary.imported,
              updated: summary.updated,
              skippedUnmappedHost: summary.skippedUnmappedHost,
            },
            "Initial Calendly synchronization completed",
          );
        }
      })
      .catch((error) => reportSyncFailure(error, "initial"));
  }, 15_000);
  initialSync.unref();
}