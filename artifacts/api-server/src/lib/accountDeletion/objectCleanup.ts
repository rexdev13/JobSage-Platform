import { objectStorageClient, ObjectStorageService } from "../objectStorage";
import { getObjectAclPolicy } from "../objectAcl";
import { configuredRegistryBuckets } from "./registryConfiguration";
import { DeletionBlocked } from "./engine";
import { requireClaimedCleanup } from "./cleanupScope";
import { parseCleanupResource, type CleanupResource } from "./resource";

function ownedObject(reference: string, generation?: string, metageneration?: string) {
  const storage = new ObjectStorageService();
  const normalized = storage.normalizeObjectEntityPath(reference);
  if (!normalized.startsWith("/objects/") || /[%\\\x00-\x1f]/.test(normalized)) {
    throw new DeletionBlocked("object_path_unverified");
  }
  const parts = normalized.slice("/objects/".length).split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new DeletionBlocked("object_path_unverified");
  const { appBucket } = configuredRegistryBuckets();
  const dir = storage.getPrivateObjectDir().replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  if (dir.shift() !== appBucket || !dir.length || dir.some(part => !part || part === "." || part === "..")) {
    throw new DeletionBlocked("object_bucket_unverified");
  }
  const options = generation ? { generation, preconditionOpts: {
    ifGenerationMatch: generation, ...(metageneration ? { ifMetagenerationMatch: metageneration } : {}),
  } } : undefined;
  return {
    normalized,
    file: objectStorageClient.bucket(appBucket).file(`${dir.join("/")}/${parts.join("/")}`, options),
  };
}

/** Read-only preparation. Capture the exact owned generation before removing
 * database pointers; signed/raw URLs never enter the durable task payload. */
export async function snapshotOwnedObject(accountId: string, reference: string): Promise<CleanupResource> {
  const { normalized, file } = ownedObject(reference);
  const [metadata] = await file.getMetadata();
  const generation = String(metadata.generation ?? "");
  if (!/^[0-9]{1,40}$/.test(generation)) throw new DeletionBlocked("object_generation_unverified");
  const pinned = ownedObject(normalized, generation).file;
  const policy = await getObjectAclPolicy(pinned);
  if (policy?.owner !== accountId) throw new DeletionBlocked("object_ownership_unverified");
  return { version: 1, accountId, reference: normalized, provider: "app-storage", generation };
}

/** Concrete eraseObject adapter. Deletes only a previously captured generation,
 * never a whole object name, prefix or bucket, and never the registry bucket.
 * No endpoint or worker is enabled by this module. */
export async function eraseOwnedObject(resource: CleanupResource, taskId: string): Promise<void> {
  await requireClaimedCleanup(resource, taskId, "object");
  const parsed = parseCleanupResource(JSON.stringify(resource));
  if (!parsed?.reference || !parsed.generation || parsed.provider !== "app-storage") {
    throw new DeletionBlocked("object_snapshot_required");
  }
  const { normalized, file } = ownedObject(parsed.reference, parsed.generation);
  if (normalized !== parsed.reference) throw new DeletionBlocked("object_path_unverified");
  try {
    // Ownership metadata can change without changing the object generation.
    // Bind its check and the delete to the same metadata revision as well.
    const [metadata] = await file.getMetadata();
    const rawPolicy = metadata.metadata?.["custom:aclPolicy"];
    const policy = typeof rawPolicy === "string" ? JSON.parse(rawPolicy) : null;
    if (policy?.owner !== parsed.accountId) throw new DeletionBlocked("object_ownership_unverified");
    const metageneration = String(metadata.metageneration ?? "");
    if (!/^[0-9]{1,40}$/.test(metageneration)) throw new DeletionBlocked("object_metadata_unverified");
    await ownedObject(normalized, parsed.generation, metageneration).file.delete();
    const [stillExists] = await file.exists();
    if (stillExists) throw new DeletionBlocked("object_cleanup_unconfirmed");
  } catch (error) {
    // Only an exact, claim-bound generation's absence is an idempotent success.
    if (Number((error as { code?: unknown }).code) === 404) return;
    if (Number((error as { code?: unknown }).code) === 412) throw new DeletionBlocked("object_generation_changed");
    if (error instanceof DeletionBlocked) throw error;
    throw new DeletionBlocked("object_cleanup_failed");
  }
}
