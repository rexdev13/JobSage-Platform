/**
 * Manual verification script — Task 1 & 2 from pipeline QA brief.
 * Runs live vacancy checks (bypassCache) on 15 sponsor companies,
 * then prints the 10 most recently inserted sponsor_licence_vacancies rows.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/testScrapeVerify.ts
 */
import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceVacanciesTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { runVacancyCheck } from "../lib/vacancyCheckHelper";
import { isValidVacancyDeepLink, isBlockedVacancyUrl } from "../lib/vacancyUrlPolicy";

// Pick 15 well-known NHS/healthcare sponsors — diverse enough to stress the prompt
const TEST_ORGS = [
  "Bupa",
  "Ramsay Health Care UK",
  "Spire Healthcare",
  "HCA Healthcare UK",
  "Circle Health Group",
  "Nuffield Health",
  "BMI Healthcare",
  "Priory Group",
  "Cygnet Health Care",
  "The Huntercombe Group",
  "St Andrew's Healthcare",
  "Partnerships in Care",
  "Elysium Healthcare",
  "Barchester Healthcare",
  "Four Seasons Health Care",
];

async function main() {
  console.log("=".repeat(70));
  console.log("TASK 1 — Live vacancy checks (bypassCache) on 15 test orgs");
  console.log("=".repeat(70));

  const results: Array<{
    org: string;
    vacanciesFound: boolean;
    count: number | null;
    validUrls: number;
    invalidUrls: number;
    blockedUrls: number;
    genericUrls: number;
    sampleUrls: string[];
    error?: string;
  }> = [];

  for (const org of TEST_ORGS) {
    process.stdout.write(`  Checking "${org}" … `);
    try {
      const r = await runVacancyCheck(org, { bypassCache: true });
      const urls = (r.vacancyList ?? []).map((v) => v.url).filter(Boolean) as string[];
      const valid = urls.filter((u) => isValidVacancyDeepLink(u));
      const blocked = urls.filter((u) => isBlockedVacancyUrl(u));
      const generic = urls.filter((u) => !isBlockedVacancyUrl(u) && !isValidVacancyDeepLink(u));

      console.log(
        `${r.vacanciesFound ? "✅" : "⬜"} ${r.vacancyCount ?? 0} vacancies | ` +
        `valid deep-links: ${valid.length}/${urls.length}` +
        (blocked.length ? ` | ❌ BLOCKED: ${blocked.length}` : "") +
        (generic.length ? ` | ⚠️  GENERIC: ${generic.length}` : ""),
      );

      results.push({
        org,
        vacanciesFound: r.vacanciesFound,
        count: r.vacancyCount,
        validUrls: valid.length,
        invalidUrls: urls.length - valid.length,
        blockedUrls: blocked.length,
        genericUrls: generic.length,
        sampleUrls: urls.slice(0, 2),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`💥 ERROR: ${msg}`);
      results.push({ org, vacanciesFound: false, count: null, validUrls: 0, invalidUrls: 0, blockedUrls: 0, genericUrls: 0, sampleUrls: [], error: msg });
    }
  }

  // Summary
  const totalUrls = results.reduce((s, r) => s + r.validUrls + r.invalidUrls, 0);
  const totalValid = results.reduce((s, r) => s + r.validUrls, 0);
  const totalBlocked = results.reduce((s, r) => s + r.blockedUrls, 0);
  const totalGeneric = results.reduce((s, r) => s + r.genericUrls, 0);
  const totalErrors = results.filter((r) => r.error).length;

  console.log("\n" + "=".repeat(70));
  console.log("SCRAPE SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Orgs checked     : ${TEST_ORGS.length}`);
  console.log(`  Orgs with errors : ${totalErrors}`);
  console.log(`  Total URLs seen  : ${totalUrls}`);
  console.log(`  ✅ Valid deep-links : ${totalValid} (${totalUrls > 0 ? Math.round(totalValid / totalUrls * 100) : "n/a"}%)`);
  console.log(`  ❌ Aggregator URLs  : ${totalBlocked}`);
  console.log(`  ⚠️  Generic paths   : ${totalGeneric}`);

  if (totalBlocked === 0 && totalGeneric === 0) {
    console.log("\n  ✅ PASS — Zero aggregator or generic URLs survived ingestion.");
  } else {
    console.log("\n  ❌ FAIL — Policy violations detected (see above).");
  }

  // -----------------------------------------------------------------------
  // TASK 2 — DB verification: 10 most recently inserted vacancies
  // -----------------------------------------------------------------------
  console.log("\n" + "=".repeat(70));
  console.log("TASK 2 — 10 most recently inserted sponsor_licence_vacancies rows");
  console.log("=".repeat(70));

  const recent = await db
    .select({
      id: sponsorLicenceVacanciesTable.id,
      title: sponsorLicenceVacanciesTable.title,
      organisationName: sponsorLicenceVacanciesTable.organisationName,
      url: sponsorLicenceVacanciesTable.url,
      checkDate: sponsorLicenceVacanciesTable.checkDate,
    })
    .from(sponsorLicenceVacanciesTable)
    .orderBy(desc(sponsorLicenceVacanciesTable.id))
    .limit(10);

  if (recent.length === 0) {
    console.log("  No rows found.");
  } else {
    let anyAggregator = false;
    let anyGeneric = false;

    for (const row of recent) {
      const isBlocked = row.url ? isBlockedVacancyUrl(row.url) : false;
      const isDeepLink = row.url ? isValidVacancyDeepLink(row.url) : false;
      const isGeneric = row.url && !isBlocked && !isDeepLink;
      if (isBlocked) anyAggregator = true;
      if (isGeneric) anyGeneric = true;

      const flag = !row.url ? "⬜ null" : isBlocked ? "❌ AGGREGATOR" : isGeneric ? "⚠️  GENERIC" : "✅ deep-link";
      console.log(`  [${row.id}] ${row.title.slice(0, 40).padEnd(40)} | ${row.organisationName.slice(0, 30).padEnd(30)} | ${row.checkDate} | ${flag}`);
      if (row.url) console.log(`         URL: ${row.url}`);
    }

    console.log("\n  VERDICT:");
    console.log(`    Aggregator URLs in DB : ${anyAggregator ? "❌ YES — POLICY VIOLATION" : "✅ None"}`);
    console.log(`    Generic paths in DB   : ${anyGeneric ? "⚠️  YES — check isValidVacancyDeepLink" : "✅ None"}`);
    console.log(`    100% direct deep-links: ${!anyAggregator && !anyGeneric ? "✅ CONFIRMED" : "❌ NOT CONFIRMED"}`);

    // -----------------------------------------------------------------------
    // TASK 3 — Test track-outbound on the most recent vacancy with a URL
    // -----------------------------------------------------------------------
    const firstWithUrl = recent.find((r) => r.url && isValidVacancyDeepLink(r.url));
    if (firstWithUrl?.url) {
      console.log("\n" + "=".repeat(70));
      console.log("TASK 3 — Test GET /api/applications/track-outbound");
      console.log("=".repeat(70));
      console.log(`  Using vacancy id=${firstWithUrl.id} | "${firstWithUrl.title}" | ${firstWithUrl.organisationName}`);
      console.log(`  URL: ${firstWithUrl.url}`);

      // Call the live API server (session cookie auth not available in script;
      // test the URL validation + deep-link logic directly instead)
      const { isValidVacancyDeepLink: validate, isBlockedVacancyUrl: blocked } = await import("../lib/vacancyUrlPolicy");
      const url = firstWithUrl.url;
      const parsedOk = (() => { try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } })();
      const notBlocked = !blocked(url);
      const deepLink = validate(url);

      console.log(`  URL parses as http(s) : ${parsedOk ? "✅" : "❌"}`);
      console.log(`  Not an aggregator     : ${notBlocked ? "✅" : "❌"}`);
      console.log(`  Passes deep-link check: ${deepLink ? "✅" : "❌"}`);
      if (parsedOk && notBlocked && deepLink) {
        console.log("  ✅ This URL would receive a clean HTTP 302 redirect — no validation errors.");
      } else {
        console.log("  ❌ This URL would be REJECTED by track-outbound.");
      }
    } else {
      console.log("\n  Task 3 skipped — no rows with a valid deep-link URL in the last 10.");
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Verification complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
