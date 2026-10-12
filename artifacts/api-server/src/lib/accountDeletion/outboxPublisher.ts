import { DeletionBlocked } from "./engine";
import { DELETION_REQUESTS_ENABLED } from "./releaseReadiness";
import { PostgresDeletionStore } from "./postgresStore";
import { IndependentTombstoneRegistry, gcsTombstoneStorage } from "./tombstoneRegistry";

export interface PendingTombstone {
  id: string;
  accountHash: string;
  requestedAt: Date;
}

export interface TombstoneOutboxStore {
  nextPendingTombstone(): Promise<PendingTombstone | null>;
  acknowledgeTombstone(requestId: string, at: Date): Promise<void>;
}

/**
 * Publish at most one durable deletion tombstone per call. Acknowledgement is
 * written only after the separate registry verifies the immutable record.
 * If the process stops between those steps, an exact retry is safe.
 */
export async function publishNextDeletionTombstone(
  store: TombstoneOutboxStore,
  registry: Pick<IndependentTombstoneRegistry, "publish">,
  now = new Date(),
) {
  if (!DELETION_REQUESTS_ENABLED) throw new DeletionBlocked("deletion_release_blocked");
  const pending = await store.nextPendingTombstone();
  if (!pending) return false;

  await registry.publish({
    version: 1,
    id: pending.id,
    accountHash: pending.accountHash,
    requestedAt: pending.requestedAt.toISOString(),
  });
  await store.acknowledgeTombstone(pending.id, now);
  return true;
}

async function publishFromPostgres() {
  if (!DELETION_REQUESTS_ENABLED) return;
  const appBucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
  const registryBucket = process.env.ACCOUNT_DELETION_TOMBSTONE_BUCKET_ID ?? "";
  const registry = new IndependentTombstoneRegistry(
    gcsTombstoneStorage(registryBucket),
    appBucket,
    registryBucket,
  );
  await publishNextDeletionTombstone(new PostgresDeletionStore(), registry);
}

/** Start only after the restore/startup barrier has succeeded. One item per
 * bounded cycle keeps registry calls non-overlapping and retries durable. */
export function startDeletionOutboxWorker() {
  if (!DELETION_REQUESTS_ENABLED) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await publishFromPostgres();
    } catch (error) {
      const code = error instanceof DeletionBlocked ? error.code : "outbox_publish_failed";
      console.error(`[deletion-outbox] publisher cycle failed: ${code}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
}
