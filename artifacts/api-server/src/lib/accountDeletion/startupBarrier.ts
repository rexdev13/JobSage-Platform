import { db, usersTable } from "@workspace/db";
import { asc, gt } from "drizzle-orm";
import { accountDeletionHash } from "./crypto";
import { DELETION_REQUESTS_ENABLED } from "./releaseReadiness";
import { DeletionBlocked } from "./engine";
import { IndependentTombstoneRegistry, gcsTombstoneStorage } from "./tombstoneRegistry";

/** No access, mail scheduler or startup backfill may run against a restored erased account.
 * Deliberately read-only: a separate reviewed replay operation must finish before startup.
 * This is a safety barrier, not an erasure adapter or evidence of completed restore replay.
 */
export async function verifyDeletionStartupBarrier() {
  if (!DELETION_REQUESTS_ENABLED) return;
  const appBucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
  const registryBucket = process.env.ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID ?? "";
  if (!appBucket || !registryBucket || appBucket === registryBucket) throw new DeletionBlocked("independent_registry_not_configured");
  // Require the dedicated pseudonym/encryption key even when the registry is currently empty.
  accountDeletionHash("startup-key-verification");
  const registry = new IndependentTombstoneRegistry(gcsTombstoneStorage(registryBucket), appBucket, registryBucket);
  const hashes = new Set((await registry.list()).map(record => record.accountHash));
  let cursor: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const accounts = await db.select({ id: usersTable.id }).from(usersTable)
      .where(cursor ? gt(usersTable.id, cursor) : undefined).orderBy(asc(usersTable.id)).limit(1000);
    for (const account of accounts) {
      if (hashes.has(accountDeletionHash(account.id))) throw new DeletionBlocked("restored_deleted_account_requires_replay");
    }
    if (accounts.length < 1000) return;
    cursor = accounts[accounts.length - 1].id;
  }
  throw new DeletionBlocked("restore_account_scan_requires_batched_orchestrator");
}
