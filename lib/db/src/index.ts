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
  target.on("connect", (client: Pick<pg.PoolClient, "on">) => {
    // A checked-out client emits directly on itself when the database
    // terminates its connection. Keep a listener attached for the lifetime of
    // the client so that the rejected query can be handled without crashing
    // the process through EventEmitter's unhandled-error behavior.
    client.on("error", (error: Error) => {
      console.error("[database-pool] Checked-out client error:", error.message);
    });
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
