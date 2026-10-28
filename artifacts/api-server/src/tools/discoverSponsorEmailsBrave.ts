/**
 * Brave-powered email discovery for sponsors whose normal contact scrape
 * failed terminally (status='failed' or attempts>=max) or who have a website
 * but no email after enrichment. Queries Brave for the company contact page,
 * extracts email addresses from result titles/snippets/URLs, and stores only
 * addresses that are published verbatim in the results — never guessed.
 * Run: BRAVE_API_KEY=... tsx src/tools/discoverSponsorEmailsBrave.ts
 *        [--limit=100] [--dry]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { webSearch } from "../lib/webSearchFallback";
const args = new Map(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "true"]; }));
const LIMIT = Number(args.get("limit") ?? "100") || 100;
const DRY = args.has("dry");

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD_LOCAL = /^(noreply|no-reply|donotreply|example|test|user|name|email|yourname|info@example|mail@example)/i;
const BAD_DOMAIN = /(example\.|sentry|wixpress|godaddy|squarespace|wordpress|github|fonts\.|schema\.|w3\.|jquery|bootstrap|cloudflare|linkedin|facebook|twitter|instagram|google|microsoft|apple|amazonses|sendgrid|mailchimp|hubspot|stripe|brave\.)/i;
const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|btinternet|proton)\./i;

// Sponsors: has website (or had a failed enrichment), no stored email, not
// already attempted by this tool recently (retry_after is used as a marker
// would collide with the contact job — instead we requery cheaply and rely on
// the 2k/mo cap making repeated full sweeps unlikely).
const targets = (await db.execute(sql`
  SELECT DISTINCT lower(btrim(sl.organisation_name)) AS org_key,
         min(btrim(sl.organisation_name)) AS org_name,
         max(NULLIF(btrim(sl.website),'')) AS website,
         min(sl.town_city) AS town
  FROM sponsor_licences sl
  WHERE (sl.contact_email IS NULL OR btrim(sl.contact_email)='')
    AND (
      sl.website IS NOT NULL AND btrim(sl.website)<>''
      OR EXISTS (SELECT 1 FROM sponsor_licence_contact_enrichments e
                 WHERE lower(btrim(e.organisation_name)) = lower(btrim(sl.organisation_name))
                   AND (e.status='failed' OR e.attempts>=4))
    )
  GROUP BY lower(btrim(sl.organisation_name))
  ORDER BY org_name
  LIMIT ${LIMIT}
`)) as unknown as { rows: Array<{ org_key: string; org_name: string; website: string | null; town: string | null }> };

let found = 0, checked = 0;
for (const t of targets.rows) {
  checked++;
  const domain = t.website ? (() => { try { return new URL(t.website).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "";
  const q = domain
    ? `"${domain}" contact email`
    : `"${t.org_name}" ${t.town ?? ""} email contact`.replace(/\s+/g, " ").trim();
  try {
    const results = await webSearch(q, 8);
    if (!results) { console.log(`no results`); continue; }
    const texts = results.flatMap((r) => [r.title ?? "", r.description ?? "", r.url ?? ""]);
    const seen = new Set<string>();
    let best: string | null = null;
    for (const text of texts) {
      for (const m of text.matchAll(EMAIL_RE)) {
        const email = m[0].toLowerCase();
        if (seen.has(email)) continue;
        seen.add(email);
        if (BAD_LOCAL.test(email) || BAD_DOMAIN.test(email)) continue;
        const eDomain = email.split("@")[1] ?? "";
        // Prefer an address on the company's own domain; accept generic
        // published addresses only if no own-domain one exists.
        if (domain && eDomain === domain) { best = email; break; }
        if (!best && !FREE_MAIL.test(eDomain)) best = email;
      }
      if (best && domain && best.endsWith(`@${domain}`)) break;
    }
    if (best) {
      if (DRY) console.log(`${t.org_name} -> ${best}`);
      else {
        await db.execute(sql`UPDATE sponsor_licences SET contact_email = ${best}
          WHERE lower(btrim(organisation_name)) = ${t.org_key}
            AND (contact_email IS NULL OR btrim(contact_email)='')`);
      }
      found++;
    }
    await new Promise((r2) => setTimeout(r2, 1600));
  } catch (e) {
    console.log(`err ${t.org_name}: ${(e as Error).message.slice(0, 80)}`);
  }
}
console.log(`checked=${checked} found=${found} dry=${DRY}`);
process.exit(0);
