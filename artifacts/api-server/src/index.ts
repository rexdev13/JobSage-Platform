import app from "./app";
import { seedRulesets } from "./lib/seedRulesets";
import { startAlertScheduler } from "./lib/alertScheduler";
import { startSponsorLicenceScheduler } from "./lib/sponsorLicenceScheduler";
import { runSponsorLicenceSync } from "./lib/sponsorLicenceSync";
import { db, sponsorLicencesTable } from "@workspace/db";
import { count } from "drizzle-orm";

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

async function triggerSyncIfEmpty(): Promise<void> {
  try {
    const [row] = await db.select({ cnt: count(sponsorLicencesTable.id) }).from(sponsorLicencesTable);
    if (Number(row?.cnt ?? 0) === 0) {
      console.log("[sponsor-sync] Table empty on startup — triggering initial sync");
      runSponsorLicenceSync().catch((err) => {
        console.error("[sponsor-sync] Initial startup sync failed:", err);
      });
    }
  } catch (err) {
    console.error("[sponsor-sync] Could not check table for startup sync:", err);
  }
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  seedRulesets().catch((err) => {
    console.error("[seed] Failed to seed rulesets:", err);
  });
  startAlertScheduler();
  startSponsorLicenceScheduler();
  void triggerSyncIfEmpty();
});
