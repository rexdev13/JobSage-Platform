import app from "./app";
import { seedRulesets } from "./lib/seedRulesets";
import { startAlertScheduler } from "./lib/alertScheduler";
import { startSponsorLicenceScheduler } from "./lib/sponsorLicenceScheduler";
import { startVacancyCheckScheduler } from "./lib/vacancyCheckScheduler";
import { startDailyVacancySyncScheduler } from "./lib/dailyVacancySync";
import { runSponsorLicenceSync } from "./lib/sponsorLicenceSync";
import { runIndustryBackfill } from "./lib/industryBackfill";
import { db, sponsorLicenceSyncLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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

const STALE_SYNC_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

async function triggerSyncIfStale(): Promise<void> {
  try {
    const [row] = await db
      .select({ createdAt: sponsorLicenceSyncLogTable.createdAt })
      .from(sponsorLicenceSyncLogTable)
      .where(eq(sponsorLicenceSyncLogTable.status, "success"))
      .orderBy(desc(sponsorLicenceSyncLogTable.createdAt))
      .limit(1);

    const lastSuccessMs = row?.createdAt ? row.createdAt.getTime() : 0;
    const ageMs = Date.now() - lastSuccessMs;

    if (ageMs > STALE_SYNC_THRESHOLD_MS) {
      const ageDays = Math.round(ageMs / 86_400_000);
      console.log(
        `[sponsor-sync] Last successful sync was ${ageDays}d ago — triggering catch-up sync on startup`,
      );
      runSponsorLicenceSync("manual").catch((err) => {
        console.error("[sponsor-sync] Startup catch-up sync failed:", err);
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
  startDailyVacancySyncScheduler();
  void triggerSyncIfStale();
  runIndustryBackfill().catch((err) => {
    console.error("[industry-backfill] Startup backfill failed:", err);
  });
});
