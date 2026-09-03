import app from "./app";
import { seedRulesets } from "./lib/seedRulesets";
import { startAlertScheduler } from "./lib/alertScheduler";
import { startSponsorLicenceScheduler } from "./lib/sponsorLicenceScheduler";
import { startVacancyCheckScheduler } from "./lib/vacancyCheckScheduler";
import { startCompanySiteDiscoveryScheduler } from "./lib/companySiteScheduler";
import { startDailyVacancySyncScheduler } from "./lib/dailyVacancySync";
import { startVacancyLivenessSweepScheduler } from "./lib/vacancyLivenessSweep";
import { startSponsorVacancyCleanupScheduler } from "./lib/sponsorVacancyCleanup";
import { runSponsorLicenceSync } from "./lib/sponsorLicenceSync";
import { runIndustryBackfill } from "./lib/industryBackfill";
import { runRegionBackfill } from "./lib/regionBackfill";
import { runDocumentAclBackfill } from "./lib/documentAclBackfill";
import { runProfilePhotoAclBackfill } from "./lib/profilePhotoAclBackfill";
import { startApplyUrlBackfillScheduler } from "./lib/applyUrlBackfillScheduler";
import { startContactBackfill } from "./lib/contactBackfillRunner";
import { runStartupSchemaDriftCheck } from "./lib/schemaDriftCheck";
import { bootstrapSuperAdmins } from "./lib/bootstrapSuperAdmins";
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
  void runStartupSchemaDriftCheck();
  seedRulesets().catch((err) => {
    console.error("[seed] Failed to seed rulesets:", err);
  });
  bootstrapSuperAdmins().catch((err) => {
    console.error("[bootstrap-super-admin] Failed:", err);
  });
  startAlertScheduler();
  startSponsorLicenceScheduler();
  startVacancyCheckScheduler();
  startCompanySiteDiscoveryScheduler();
  startDailyVacancySyncScheduler();
  startVacancyLivenessSweepScheduler();
  startSponsorVacancyCleanupScheduler();
  startApplyUrlBackfillScheduler();
  if (process.env.ENABLE_CONTACT_BACKFILL === "true") {
    const contactBackfillResult = startContactBackfill(500);
    if (contactBackfillResult.started) {
      console.log("[contact-backfill] Startup backfill triggered (up to 500 sponsors)");
    } else {
      console.log(`[contact-backfill] Startup backfill skipped: ${contactBackfillResult.reason}`);
    }
  } else {
    console.log("[contact-backfill] Skipped — set ENABLE_CONTACT_BACKFILL=true to run on startup");
  }
  void triggerSyncIfStale();
  if (process.env.ENABLE_INDUSTRY_BACKFILL === "true") {
    runIndustryBackfill().catch((err) => {
      console.error("[industry-backfill] Startup backfill failed:", err);
    });
  } else {
    console.log("[industry-backfill] Skipped — set ENABLE_INDUSTRY_BACKFILL=true to run on startup");
  }
  // Most unmapped rows contain free-form county values the current mapper
  // cannot resolve. Re-scanning all of them on every autoscale cold start
  // competes with candidate-facing requests, so run this migration only when
  // explicitly requested.
  if (process.env.ENABLE_REGION_BACKFILL === "true") {
    runRegionBackfill().catch((err) => {
      console.error("[region-backfill] Startup backfill failed:", err);
    });
  } else {
    console.log("[region-backfill] Skipped — set ENABLE_REGION_BACKFILL=true to run on startup");
  }
  runDocumentAclBackfill().catch((err) => {
    console.error("[doc-acl-backfill] Startup backfill failed:", err);
  });
  runProfilePhotoAclBackfill().catch((err) => {
    console.error("[photo-acl-backfill] Startup backfill failed:", err);
  });
});
