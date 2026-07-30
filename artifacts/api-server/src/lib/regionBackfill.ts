import { db, sponsorLicencesTable } from "@workspace/db";
import { isNull, isNotNull, count, gt, and, asc } from "drizzle-orm";
import { countyToRegion } from "./countyToRegion";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 500;

export async function runRegionBackfill(): Promise<void> {
  const [countRow] = await db
    .select({ cnt: count(sponsorLicencesTable.id) })
    .from(sponsorLicencesTable)
    .where(and(isNull(sponsorLicencesTable.region), isNotNull(sponsorLicencesTable.county)));
  const total = Number(countRow?.cnt ?? 0);

  if (total === 0) {
    console.log("[region-backfill] All records already have region — skipping.");
    return;
  }

  console.log(`[region-backfill] Starting backfill for ${total} records with no region…`);

  let processed = 0;
  let matched = 0;
  let leftNull = 0;
  let lastId = 0;

  while (true) {
    const rows = await db
      .select({ id: sponsorLicencesTable.id, county: sponsorLicencesTable.county })
      .from(sponsorLicencesTable)
      .where(and(isNull(sponsorLicencesTable.region), isNotNull(sponsorLicencesTable.county), gt(sponsorLicencesTable.id, lastId)))
      .orderBy(asc(sponsorLicencesTable.id))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    lastId = rows[rows.length - 1]!.id;

    const toUpdate: { id: number; region: string }[] = [];

    for (const row of rows) {
      const region = countyToRegion(row.county);
      if (region !== null) {
        toUpdate.push({ id: row.id, region });
      } else {
        leftNull++;
      }
    }

    if (toUpdate.length > 0) {
      const caseExpr = sql.join(
        toUpdate.map((r) => sql`WHEN ${sql.raw(String(r.id))} THEN ${r.region}`),
        sql` `,
      );
      await db.execute(
        sql`UPDATE sponsor_licences SET region = CASE id ${caseExpr} END WHERE id = ANY(${sql.raw(`ARRAY[${toUpdate.map((r) => r.id).join(",")}]::int[]`)})`,
      );
    }

    processed += rows.length;
    matched += toUpdate.length;

    console.log(
      `[region-backfill] Progress: ${processed} processed, ${matched} matched, ${leftNull} left null`,
    );
  }

  console.log(
    `[region-backfill] Complete — ${processed} records processed, ${matched} regions assigned, ${leftNull} counties unmapped.`,
  );
}
