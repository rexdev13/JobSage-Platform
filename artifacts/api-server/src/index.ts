import app from "./app";
import { seedRulesets } from "./lib/seedRulesets";
import { startAlertScheduler } from "./lib/alertScheduler";
import { startSponsorLicenceScheduler } from "./lib/sponsorLicenceScheduler";
import { startVacancyCheckScheduler } from "./lib/vacancyCheckScheduler";
import { runSponsorLicenceSync } from "./lib/sponsorLicenceSync";
import { runIndustryBackfill } from "./lib/industryBackfill";
import { db, sponsorLicenceSyncLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function triggerSyncIfNeverSucceeded(): Promise<void> {
  try {
    const [row] = await db
      .select({ id: sponsorLicenceSyncLogTable.id })
      .from(sponsorLicenceSyncLogTable)
      .where(eq(sponsorLicenceSyncLogTable.status, "success"))
      .limit(1);
    if (!row) {
      console.log("[sponsor-sync] No successful sync on record — triggering initial sync");
      runSponsorLicenceSync().catch((err) => {
        console.error("[sponsor-sync] Initial startup sync failed:", err);
      });
    }
  } catch (err) {
    console.error("[sponsor-sync] Could not check sync log for startup sync:", err);
  }
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  seedRulesets().catch((err) => {
    console.error("[seed] Failed to seed rulesets:", err);
  });
  startAlertScheduler();
  startSponsorLicenceScheduler();
  startVacancyCheckScheduler();
  void triggerSyncIfNeverSucceeded();
  runIndustryBackfill().catch((err) => {
    console.error("[industry-backfill] Startup backfill failed:", err);
  });
});
