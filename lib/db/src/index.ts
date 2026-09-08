import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export function attachUnexpectedPoolErrorHandler(
  target: Pick<pg.Pool, "on">,
): void {
  target.on("error", (error: Error) => {
    // node-postgres emits errors from idle clients on the Pool. EventEmitter
    // treats an unhandled "error" event as fatal, so install this beside pool
    // construction for every API, worker, and bundled entry point.
    console.error("[database-pool] Idle client error:", error.message);
  });
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
attachUnexpectedPoolErrorHandler(pool);
export const db = drizzle(pool, { schema });

export * from "./schema";
