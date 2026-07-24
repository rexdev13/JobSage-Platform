import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isValidVacancyDeepLink, isBlockedVacancyUrl } from "../lib/vacancyUrlPolicy";

async function main() {
  // Task 1: Find generic/homepage URLs still in the DB
  const result = await db.execute(sql`
    SELECT id, title, organisation_name, url, check_date
    FROM sponsor_licence_vacancies
    WHERE url IS NOT NULL
      AND (
        url ~ '^https?://[^/]+/?$'
        OR url ~ '^https?://[^/]+/(careers|jobs|vacancies|search|career|work-for-us|join-us|apply)/?$'
        OR length(regexp_replace(url, '^https?://[^/]+', '')) < 8
      )
    ORDER BY id DESC
    LIMIT 10
  `);

  console.log("=== TASK 1: Generic/homepage URLs in sponsor_licence_vacancies ===");
  console.log(`Found ${result.rows.length} rows\n`);

  if (result.rows.length === 0) {
    console.log("✅ No generic URLs found in the database.");
  } else {
    for (const row of result.rows as any[]) {
      console.log(`id=${row.id} | "${row.title}" | ${row.organisation_name}`);
      console.log(`  url: ${row.url}`);
      console.log(`  check_date: ${row.check_date}`);
      // Task 2: Run validator on these exact URLs
      const blocked = isBlockedVacancyUrl(row.url);
      const valid = isValidVacancyDeepLink(row.url);
      console.log(`  isBlockedVacancyUrl()      → ${blocked}`);
      console.log(`  isValidVacancyDeepLink()   → ${valid}`);
      if (!blocked && !valid) {
        console.log(`  ✅ Validator correctly returns false — saved anyway (ingestion gap)`);
      } else if (valid) {
        console.log(`  ❌ Validator returns true — logic flaw leaking this URL`);
      }
      console.log();
    }
  }

  // Also check total counts for context
  const counts = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE url IS NOT NULL) AS total_with_url,
      COUNT(*) FILTER (WHERE url IS NULL) AS total_null_url,
      COUNT(*) FILTER (
        WHERE url IS NOT NULL AND (
          url ~ '^https?://[^/]+/?$'
          OR url ~ '^https?://[^/]+/(careers|jobs|vacancies|search|career|work-for-us|join-us|apply)/?$'
          OR length(regexp_replace(url, '^https?://[^/]+', '')) < 8
        )
      ) AS generic_url_count
    FROM sponsor_licence_vacancies
  `);
  const c = (counts.rows[0] as any);
  console.log("=== DB URL HEALTH SNAPSHOT ===");
  console.log(`  Rows with a URL    : ${c.total_with_url}`);
  console.log(`  Rows with null URL : ${c.total_null_url}`);
  console.log(`  Generic URL rows   : ${c.generic_url_count}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
