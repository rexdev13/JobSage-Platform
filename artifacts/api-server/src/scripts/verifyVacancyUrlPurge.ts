import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isValidVacancyDeepLink } from "../lib/vacancyUrlPolicy";

async function main() {
  // Validator-parity generic patterns (matches GENERIC_PATHS in vacancyUrlPolicy)
  const generic = await db.execute(sql`
    SELECT COUNT(*) AS n FROM sponsor_licence_vacancies
    WHERE url IS NOT NULL AND (
      url ~* '^https?://[^/]+/?$'
      OR url ~* '^https?://[^/]+/(careers|career|jobs|vacancies|search)/?$'
      OR length(regexp_replace(url, '^https?://[^/]+', '')) < 8
    )`);
  console.log("Validator-generic pattern rows remaining:", (generic.rows[0] as any).n);

  // Full parity check: every remaining non-null URL must pass the TS validator
  const rows = await db.execute(sql`SELECT url FROM sponsor_licence_vacancies WHERE url IS NOT NULL`);
  const failing = (rows.rows as any[]).filter(r => !isValidVacancyDeepLink(r.url));
  console.log("Non-null URLs remaining:", rows.rows.length);
  console.log("URLs failing isValidVacancyDeepLink():", failing.length);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
