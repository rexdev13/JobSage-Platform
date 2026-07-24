/**
 * schemaDriftCheck.ts
 *
 * Startup guard against schema drift between the Drizzle schema and the live
 * database. For every table exported from @workspace/db, runs a zero-row
 * SELECT of all Drizzle-declared columns. If a table or column is missing in
 * the database, the query fails and we log a loud, actionable warning naming
 * the drifted table — instead of every endpoint returning blanket 500s.
 */

import { db } from "@workspace/db";
import * as schema from "@workspace/db";
import { sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

export interface SchemaDriftResult {
  ok: boolean;
  driftedTables: Array<{ table: string; error: string }>;
}

export async function checkSchemaDrift(): Promise<SchemaDriftResult> {
  const driftedTables: Array<{ table: string; error: string }> = [];

  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;

    const config = getTableConfig(value);
    const tableName = config.name;
    const columnList = config.columns
      .map((c) => sql.identifier(c.name))
      .reduce((acc, id, i) => (i === 0 ? id : sql`${acc}, ${id}`) as ReturnType<typeof sql.identifier>);

    try {
      await db.execute(
        sql`SELECT ${columnList} FROM ${sql.identifier(tableName)} LIMIT 0`,
      );
    } catch (err) {
      driftedTables.push({
        table: tableName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: driftedTables.length === 0, driftedTables };
}

/**
 * Run the drift check at startup and log the outcome. Never throws — a drift
 * warning must not prevent the server from booting.
 */
export async function runStartupSchemaDriftCheck(): Promise<void> {
  try {
    const result = await checkSchemaDrift();
    if (result.ok) {
      console.log("[schema-drift] OK — database matches Drizzle schema");
      return;
    }
    console.error(
      "==================== SCHEMA DRIFT DETECTED ====================",
    );
    console.error(
      "[schema-drift] The live database does not match the Drizzle schema.",
    );
    console.error(
      "[schema-drift] API endpoints touching these tables will fail with 500s.",
    );
    for (const { table, error } of result.driftedTables) {
      console.error(`[schema-drift]   table "${table}": ${error}`);
    }
    console.error(
      '[schema-drift] Fix: run `pnpm --filter @workspace/db run push` to sync the database schema.',
    );
    console.error(
      "===============================================================",
    );
  } catch (err) {
    console.error("[schema-drift] Drift check itself failed:", err);
  }
}
