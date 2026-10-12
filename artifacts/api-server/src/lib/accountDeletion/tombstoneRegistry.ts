import { z } from "zod/v4";
import { objectStorageClient } from "../objectStorage";
import { getObjectAclPolicy } from "../objectAcl";
import type { File, GetFilesOptions } from "@google-cloud/storage";
import { DeletionBlocked } from "./engine";
import { DELETION_REQUESTS_ENABLED } from "./releaseReadiness";

const PREFIX = "system/deletion-tombstones/v1/";
async function registryDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DeletionBlocked("independent_registry_timeout")), 60_000);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  try { return await Promise.race([operation(controller.signal), aborted]); }
  finally { clearTimeout(timeout); }
}
const tombstone = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  accountHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestedAt: z.string().datetime(),
}).strict();
export type IndependentTombstone = z.infer<typeof tombstone>;
export interface TombstoneStorage {
  createOnce(name: string, bytes: Buffer, signal?: AbortSignal): Promise<void>;
  read(name: string, signal?: AbortSignal): Promise<Buffer>;
  names(prefix: string, signal?: AbortSignal): Promise<string[]>;
}

/** Separate bucket, immutable pseudonymous records. Never store account IDs, email or operational resources here. */
export class IndependentTombstoneRegistry {
  constructor(private storage: TombstoneStorage, appBucket: string, registryBucket: string) {
    if (!appBucket || !registryBucket || appBucket === registryBucket
      || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(registryBucket)) {
      throw new DeletionBlocked("independent_registry_not_configured");
    }
  }
  async publish(input: IndependentTombstone): Promise<void> {
    return registryDeadline(async signal => {
      const record = tombstone.parse(input);
      const path = `${PREFIX}${record.accountHash}/${record.id}.json`;
      const bytes = Buffer.from(JSON.stringify(record));
      await this.storage.createOnce(path, bytes, signal);
      signal.throwIfAborted();
      // Creation or a retry is not acknowledged until the stored immutable record is checked.
      const confirmed = tombstone.parse(JSON.parse((await this.storage.read(path, signal)).toString("utf8")));
      if (JSON.stringify(confirmed) !== JSON.stringify(record)) throw new DeletionBlocked("registry_receipt_mismatch");
    });
  }
  async list(): Promise<IndependentTombstone[]> {
    return registryDeadline(async signal => {
      const names = await this.storage.names(PREFIX, signal);
      if (names.length > 50_000) throw new DeletionBlocked("registry_replay_requires_batched_orchestrator");
      const records: IndependentTombstone[] = [];
      for (const name of names) {
        signal.throwIfAborted();
        const match = /^system\/deletion-tombstones\/v1\/([a-f0-9]{64})\/([a-f0-9-]{36})\.json$/.exec(name);
        if (!match) throw new DeletionBlocked("registry_path_invalid");
        const record = tombstone.parse(JSON.parse((await this.storage.read(name, signal)).toString("utf8")));
        if (record.accountHash !== match[1] || record.id !== match[2]) throw new DeletionBlocked("registry_identity_mismatch");
        records.push(record);
      }
      signal.throwIfAborted();
      return records;
    });
  }
}

/** Real storage implementation, deliberately unable to write while the release gate is closed. */
export function gcsTombstoneStorage(bucketName: string): TombstoneStorage {
  const bucket = objectStorageClient.bucket(bucketName);
  return {
    async createOnce(name, bytes, signal) {
      signal?.throwIfAborted();
      if (!DELETION_REQUESTS_ENABLED) throw new DeletionBlocked("deletion_release_blocked");
      try {
        await bucket.file(name).save(bytes, {
          resumable: false, contentType: "application/json",
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { metadata: { "custom:aclPolicy": JSON.stringify({ owner: "jobsage-system", visibility: "private" }) } },
        });
      } catch (error) {
        // Immutable create can race or be retried after a network acknowledgement is lost.
        if (Number((error as { code?: unknown }).code) !== 412) throw error;
      }
    },
    async read(name, signal) {
      signal?.throwIfAborted();
      const file = bucket.file(name);
      const policy = await getObjectAclPolicy(file);
      if (policy?.owner !== "jobsage-system" || policy.visibility !== "private") throw new DeletionBlocked("registry_privacy_invalid");
      const [metadata] = await file.getMetadata();
      signal?.throwIfAborted();
      const size = Number(metadata.size);
      const generation = String(metadata.generation ?? "");
      if (!Number.isSafeInteger(size) || size < 1 || size > 4096 || !/^[0-9]+$/.test(generation)) throw new DeletionBlocked("registry_record_invalid");
      const [bytes] = await file.bucket.file(file.name, { generation }).download();
      if (bytes.length > 4096) throw new DeletionBlocked("registry_record_invalid");
      return bytes;
    },
    async names(prefix, signal) {
      const names: string[] = [];
      let options: GetFilesOptions | undefined = { prefix, maxResults: 1000, autoPaginate: false };
      while (options) {
        signal?.throwIfAborted();
        const [files, next]: [File[], GetFilesOptions | null | undefined, unknown?] = await bucket.getFiles(options);
        signal?.throwIfAborted();
        names.push(...files.map(file => file.name));
        if (names.length > 50_000) throw new DeletionBlocked("registry_replay_requires_batched_orchestrator");
        options = next ? { ...next, autoPaginate: false } : undefined;
      }
      return names;
    },
  };
}

/** A restore cannot serve accounts whose erasure has not been replayed. Registry outage also fails closed. */
export async function assertDeletionRestoreBarrier(
  registry: Pick<IndependentTombstoneRegistry, "list">,
  accountIds: Iterable<string>,
  hashAccount: (id: string) => string,
) {
  const records = await registry.list();
  const erasedHashes = new Set(records.map(record => record.accountHash));
  for (const accountId of accountIds) {
    if (erasedHashes.has(hashAccount(accountId))) throw new DeletionBlocked("restored_deleted_account_requires_replay");
  }
}
