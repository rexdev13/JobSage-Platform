import { db, accountDeletionTasksTable as tasks, accountDeletionRequestsTable as requests, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { accountDeletionHash, decryptDeletionResource } from "./crypto";
import { DeletionBlocked, type DeletionTaskKind } from "./engine";
import { parseCleanupResource, type CleanupResource } from "./resource";
import { requireDeletionRelease } from "./writeGate";

/** A concrete adapter cannot trust a caller-supplied account/path. Bind it to
 * an unexpired durable claim and quarantine before any destructive operation.
 * Missing users are allowed for retries after active-data removal, but only
 * with a still-live account-bound request/task. */
export async function requireClaimedCleanup(
  resource: CleanupResource, taskId: string, kind: DeletionTaskKind,
  client: Pick<typeof db, "execute"> = db, now = new Date(),
) {
  requireDeletionRelease();
  const parsed = parseCleanupResource(JSON.stringify(resource));
  if (!parsed) throw new DeletionBlocked("resource_invalid");
  const claim = await client.execute(sql`
    SELECT t.request_id, t.resource_ciphertext, r.account_hash
    FROM ${tasks} AS t JOIN ${requests} AS r ON r.id = t.request_id
    WHERE t.id = ${taskId} AND t.kind = ${kind} AND t.state = 'running'
      AND t.lease_until > ${now} AND r.completed_at IS NULL`);
  const row = claim.rows[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.resource_ciphertext !== "string") throw new DeletionBlocked("cleanup_claim_required");
  let recorded: CleanupResource | null;
  try { recorded = parseCleanupResource(decryptDeletionResource(row.resource_ciphertext)); }
  catch { throw new DeletionBlocked("resource_invalid"); }
  if (!recorded || accountDeletionHash(parsed.accountId) !== row.account_hash
    || JSON.stringify(parsed) !== JSON.stringify(recorded)) {
    throw new DeletionBlocked("cleanup_claim_mismatch");
  }
  const account = await client.execute(sql`SELECT id, role, suspended_at FROM ${usersTable} WHERE id = ${parsed.accountId}`);
  const user = account.rows[0] as Record<string, unknown> | undefined;
  if (user && !user.suspended_at) throw new DeletionBlocked("account_not_quarantined");
  return { requestId: String(row.request_id), role: user?.role as string | undefined };
}
