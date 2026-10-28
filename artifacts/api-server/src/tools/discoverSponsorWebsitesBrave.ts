/**
 * Find official websites for sponsors that have none, via Brave Search API.
 * Scores candidate domains on name-token overlap; rejects directories and
 * social/profile sites. Only writes sponsor_licences.website when empty.
 * Run: BRAVE_API_KEY=... tsx src/tools/discoverSponsorWebsitesBrave.ts
 *        [--limit=100] [--sectors=a,b] [--dry]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const KEY = process.env["BRAVE_API_KEY"];
const args = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "true"]; }));
const LIMIT = Number(args.get("limit") ?? "100") || 100;
const DRY = args.has("dry");
const SECTORS = (args.get("sectors") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const BAD_HOSTS = /linkedin\.|facebook\.|instagram\.|twitter\.|x\.com|endole\.|companieshouse|company-information|checkcompany|duedil|kompany|glassdoor|indeed\.|yell\.|192\.com|companycheck|companysearches|openendings|constructionline|find-and-update|suitcase|kompass|allcompanies|companylist|bizdb|business-sale|thegazette|gov\.uk|wikipedia|zoominfo|rocketreach|ukdata|fullcircl|completecompanyformation|companydirectorcheck|dnb\.com|ukcompanies|b2bhint|cylex|trustpilot/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ")
    .replace(/\b(ltd|limited|llp|plc|inc|corp|company|co|uk|group|holdings|the)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function score(host: string, nameTokens: string[]): number {
  const h = host.replace(/^www\./, "");
  const hits = nameTokens.filter((t) => t.length >= 4 && h.includes(t)).length;
  return nameTokens.length === 0 ? 0 : hits / Math.min(2, nameTokens.length);
}

if (!KEY) { console.error("BRAVE_API_KEY not set"); process.exit(1); }

const where = SECTORS.length
  ? sql`WHERE (website IS NULL OR btrim(website)='') AND lower(btrim(COALESCE(industry,''))) = ANY(${sql.param(SECTORS)}::text[])`
  : sql`WHERE website IS NULL OR btrim(website)=''`;

const targets = (await db.execute(sql`
  SELECT organisation_name, town_city FROM sponsor_licences ${where}
  ORDER BY organisation_name LIMIT ${LIMIT}
`)) as unknown as { rows: Array<{ organisation_name: string; town_city: string | null }> };

let found = 0, checked = 0;
for (const t of targets.rows) {
  checked++;
  const q = `${t.organisation_name} ${t.town_city ?? ""} UK`.replace(/\s+/g, " ").trim();
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", q);
    url.searchParams.set("count", "5");
    const res = await fetch(url, { headers: { "X-Subscription-Token": KEY, Accept: "application/json" } });
    if (res.status === 429) { console.log("rate-limited, stopping"); break; }
    if (!res.ok) { console.log(`HTTP ${res.status} for ${t.organisation_name}`); continue; }
    const data = await res.json() as { web?: { results?: Array<{ url?: string }> } };
    const tokens = norm(t.organisation_name).split(" ").filter((x) => x.length >= 4);
    for (const r of data.web?.results ?? []) {
      if (!r.url) continue;
      let host: string;
      try { host = new URL(r.url).hostname; } catch { continue; }
      if (BAD_HOSTS.test(host)) continue;
      if (score(host, tokens) >= 0.5) {
        if (DRY) console.log(`${t.organisation_name} -> ${host}`);
        else {
          await db.execute(sql`UPDATE sponsor_licences SET website = ${`https://${host}`}
            WHERE organisation_name = ${t.organisation_name} AND (website IS NULL OR btrim(website)='')`);
        }
        found++;
        break;
      }
    }
    await new Promise((r2) => setTimeout(r2, 1100)); // 1 req/sec
  } catch (e) {
    console.log(`err ${t.organisation_name}: ${(e as Error).message.slice(0, 80)}`);
  }
}
console.log(`checked=${checked} found=${found} dry=${DRY}`);
process.exit(0);
