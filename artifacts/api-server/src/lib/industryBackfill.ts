import { db, sponsorLicencesTable } from "@workspace/db";
import { isNull, count, sql } from "drizzle-orm";
import { classifyByKeyword, classifyBatchWithAI } from "./industryClassifier";

const FETCH_BATCH = 500;
const AI_BATCH = 100;

/**
 * One-time backfill: classify all sponsor_licences rows where industry IS NULL.
 * Uses keyword patterns first, then GPT-4o for the remainder.
 * Safe to call multiple times — skips already-classified rows.
 */
export async function runIndustryBackfill(): Promise<void> {
  const [countRow] = await db
    .select({ cnt: count(sponsorLicencesTable.id) })
    .from(sponsorLicencesTable)
    .where(isNull(sponsorLicencesTable.industry));
  const total = Number(countRow?.cnt ?? 0);

  if (total === 0) {
    console.log("[industry-backfill] All records already classified — skipping.");
    return;
  }

  console.log(`[industry-backfill] Starting backfill for ${total} unclassified records…`);

  let processed = 0;

  while (true) {
    const rows = await db
      .select({ id: sponsorLicencesTable.id, name: sponsorLicencesTable.organisationName })
      .from(sponsorLicencesTable)
      .where(isNull(sponsorLicencesTable.industry))
      .limit(FETCH_BATCH);

    if (rows.length === 0) break;

    const kwResults = rows.map((r) => ({
      id: r.id,
      name: r.name,
      industry: classifyByKeyword(r.name),
    }));

    // Rows that keyword matched — batch-update immediately
    const kwMatched = kwResults.filter((r) => r.industry !== null);
    if (kwMatched.length > 0) {
      for (let i = 0; i < kwMatched.length; i += 200) {
        const slice = kwMatched.slice(i, i + 200);
        await buildAndRunCaseUpdate(slice as { id: number; industry: string }[]);
      }
    }

    // Rows needing AI classification
    const aiNeeded = kwResults.filter((r) => r.industry === null);
    for (let i = 0; i < aiNeeded.length; i += AI_BATCH) {
      const slice = aiNeeded.slice(i, i + AI_BATCH);
      const labels = await classifyBatchWithAI(slice.map((r) => r.name));
      const updates = slice.map((r, j) => ({ id: r.id, industry: labels[j] ?? "Other" }));
      await buildAndRunCaseUpdate(updates);
    }

    processed += rows.length;
    console.log(`[industry-backfill] Progress: ${processed} / ${total}`);
  }

  console.log(`[industry-backfill] Complete — classified ${processed} records.`);
}

async function buildAndRunCaseUpdate(rows: { id: number; industry: string }[]): Promise<void> {
  if (rows.length === 0) return;

  const ids = rows.map((r) => r.id);
  const caseExpr = sql.join(
    rows.map((r) => sql`WHEN ${sql.raw(String(r.id))} THEN ${r.industry}`),
    sql` `,
  );

  await db.execute(
    sql`UPDATE sponsor_licences SET industry = CASE id ${caseExpr} END WHERE id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})`,
  );
}
