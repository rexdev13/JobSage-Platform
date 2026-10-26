import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchCompanySitePage } from "../lib/companySiteHttp";
import { boardLinkCandidates } from "./discoverSponsorAtsBoards";

async function main(): Promise<void> {
  const r = await db.execute<any>(sql`
    SELECT DISTINCT ON (lower(btrim(organisation_name)))
      lower(btrim(organisation_name)) AS org, btrim(website) AS website
    FROM sponsor_licences WHERE website IS NOT NULL LIMIT 10
  `);
  for (const row of r.rows) {
    try {
      const home = await fetchCompanySitePage(row.website, new URL(row.website).hostname, Date.now() + 20000);
      const links = home.ok ? boardLinkCandidates(home.body, home.url) : [];
      console.log(row.org.slice(0, 45), "| ok=" + home.ok, home.ok ? `links=${links.length} ${links[0]?.careersUrl ?? ""}` : (home.reason ?? "").slice(0, 70));
    } catch (e) {
      console.log(row.org.slice(0, 45), "THREW", e instanceof Error ? e.message.slice(0, 120) : e);
    }
  }
  process.exit(0);
}
main();
