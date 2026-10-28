/**
 * Sector-focused generic careers discovery drain.
 *
 * Feeds website sponsors of the requested industries straight into
 * runCompanySiteDiscoveryBatch via its organisationNames filter, so weak
 * sectors can be drained first instead of waiting for the global rotation.
 * Only sponsors never generically crawled (generic_checked_at IS NULL) and
 * not already verified to an ATS board are selected.
 *
 * Usage: tsx src/tools/sectorSiteDrain.ts --sectors=social%20care,hospitality [--shard=K/N] [--concurrency=10]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runCompanySiteDiscoveryBatch } from "../lib/companySiteScheduler";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sectorsArg = args.find((a) => a.startsWith("--sectors"));
  const sectors = sectorsArg
    ? decodeURIComponent(
        sectorsArg.includes("=") ? sectorsArg.split("=")[1]! : args[args.indexOf("--sectors") + 1] ?? "",
      ).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  if (!sectors.length) { console.error("--sectors=a,b,c required"); process.exit(2); }
  const shardArg = args.find((a) => a.startsWith("--shard"));
  const [shardIndex, shards] = (() => {
    const raw = shardArg?.includes("=") ? shardArg.split("=")[1] : shardArg ? args[args.indexOf("--shard") + 1] : "0/1";
    const [k, n] = (raw ?? "0/1").split("/").map(Number);
    return [Math.max(0, k || 0), Math.max(1, n || 1)];
  })();

  const result = await db.execute<{ organisation_name: string }>(sql`
    SELECT DISTINCT ON (lower(btrim(sl.organisation_name))) sl.organisation_name
    FROM sponsor_licences sl
    LEFT JOIN sponsor_licence_company_site_checks cs
      ON cs.organisation_name = sl.organisation_name
    WHERE NULLIF(btrim(sl.website), '') IS NOT NULL
      AND lower(btrim(COALESCE(sl.industry, ''))) = ANY(${sql.param(sectors)}::text[])
      AND (cs.ats_mapping_status IS DISTINCT FROM 'verified' OR cs.ats_mapping_status IS NULL)
      AND COALESCE(cs.probe_status, 'unknown') <> 'bad'
      AND mod((hashtext(lower(btrim(sl.organisation_name)))::bigint & 2147483647), ${shards}) = ${shardIndex}
    ORDER BY lower(btrim(sl.organisation_name)), sl.organisation_name
  `);
  const names = result.rows.map((r) => r.organisation_name);
  console.log(`sectorSiteDrain sectors=[${sectors.join(",")}] shard=${shardIndex}/${shards} sponsors=${names.length}`);
  if (!names.length) { console.log("DONE nothing to drain"); return; }

  let idleRounds = 0;
  let batches = 0;
  let upserted = 0;
  while (idleRounds < 2) {
    const summary = await runCompanySiteDiscoveryBatch({
      organisationNames: names,
      batchSize: 40,
      directFeedsOnly: false,
      deadlineMs: Date.now() + 5 * 60_000,
    });
    batches++;
    if (summary == null) { await sleep(10_000); continue; } // global batch busy — retry
    upserted += summary.upserted ?? 0;
    if (!summary.selected) idleRounds++; else idleRounds = 0;
    console.log(`sectorSiteDrain batch=${batches} selected=${summary.selected} upserted_total=${upserted} done=${summary.done ?? false}`);
    if (!summary.selected) break;
  }
  console.log(`DONE sectors=[${sectors.join(",")}] batches=${batches} upserted=${upserted}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
