/**
 * One-off sweep: null out any `apply_url` values in `roles` and `job_listings`
 * that do not pass `isValidVacancyDeepLink` (i.e. generic homepages, careers
 * landing pages, or aggregator links that slipped in before write-time validation
 * was enforced).
 *
 * Run once via:
 *   cd artifacts/api-server && npx tsx src/scripts/purgeRolesApplyUrls.ts
 */

import { db } from "@workspace/db";
import { rolesTable, jobListingsTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { isValidVacancyDeepLink } from "../lib/vacancyUrlPolicy";
import { eq } from "drizzle-orm";

async function main() {
  console.log("[purge-roles-apply-urls] Starting sweep…\n");

  // ── roles table ─────────────────────────────────────────────────────────────
  const allRoles = await db
    .select({ id: rolesTable.id, applyUrl: rolesTable.applyUrl })
    .from(rolesTable)
    .where(isNotNull(rolesTable.applyUrl));

  let rolesScanned = allRoles.length;
  let rolesNulled = 0;
  let rolesKept = 0;

  for (const role of allRoles) {
    if (!isValidVacancyDeepLink(role.applyUrl)) {
      await db.update(rolesTable).set({ applyUrl: null }).where(eq(rolesTable.id, role.id));
      rolesNulled++;
    } else {
      rolesKept++;
    }
  }

  // ── job_listings table ───────────────────────────────────────────────────────
  const allListings = await db
    .select({ id: jobListingsTable.id, applyUrl: jobListingsTable.applyUrl })
    .from(jobListingsTable)
    .where(isNotNull(jobListingsTable.applyUrl));

  let listingsScanned = allListings.length;
  let listingsNulled = 0;
  let listingsKept = 0;

  for (const listing of allListings) {
    if (!isValidVacancyDeepLink(listing.applyUrl)) {
      await db.update(jobListingsTable).set({ applyUrl: null }).where(eq(jobListingsTable.id, listing.id));
      listingsNulled++;
    } else {
      listingsKept++;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════");
  console.log("[purge-roles-apply-urls] RESULTS");
  console.log("────────────────────────────────────────────────");
  console.log(`roles table:`);
  console.log(`  Scanned : ${rolesScanned}`);
  console.log(`  Nulled  : ${rolesNulled}  (generic/aggregator URLs removed)`);
  console.log(`  Kept    : ${rolesKept}   (valid deep-links preserved)`);
  console.log(`job_listings table:`);
  console.log(`  Scanned : ${listingsScanned}`);
  console.log(`  Nulled  : ${listingsNulled}  (generic/aggregator URLs removed)`);
  console.log(`  Kept    : ${listingsKept}   (valid deep-links preserved)`);
  console.log("════════════════════════════════════════════════");

  process.exit(0);
}

main().catch((err) => {
  console.error("[purge-roles-apply-urls] Fatal error:", err);
  process.exit(1);
});
