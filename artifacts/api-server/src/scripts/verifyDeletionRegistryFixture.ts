import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { objectStorageClient } from "../lib/objectStorage";
import { DeletionBlocked } from "../lib/accountDeletion/engine";
import { DELETION_REQUESTS_ENABLED } from "../lib/accountDeletion/releaseReadiness";
import { configuredRegistryBuckets } from "../lib/accountDeletion/registryConfiguration";
import {
  IndependentTombstoneRegistry,
  gcsTombstoneStorage,
  type TombstoneStorage,
} from "../lib/accountDeletion/tombstoneRegistry";

/**
 * Explicitly authorised development fixture check only. No database, user
 * records or real deletion-key material is loaded. Real registry writes stay
 * disabled; fixture writes are confined to a unique, non-registry namespace.
 *
 * NODE_ENV=development pnpm --filter @workspace/api-server exec tsx \
 *   src/scripts/verifyDeletionRegistryFixture.ts --run-fixture
 */
async function verify() {
  assert.equal(process.env.NODE_ENV, "development", "development_only");
  assert.deepEqual(process.argv.slice(2), ["--run-fixture"], "explicit_fixture_flag_required");
  assert.equal(DELETION_REQUESTS_ENABLED, false, "deletion_must_remain_disabled");
  const { appBucket, registryBucket: bucketId } = configuredRegistryBuckets();
  const reader = gcsTombstoneStorage(bucketId);
  // Constructor verifies the two configured buckets really differ.
  new IndependentTombstoneRegistry(reader, appBucket, bucketId);

  const runId = randomUUID();
  const prefix = `system/deletion-registry-fixtures/${runId}/`;
  const bucket = objectStorageClient.bucket(bucketId);
  const touched = new Set<string>();
  const report = {
    separateBucket: true,
    outsideApplicationFilePaths: true,
    releaseGateClosed: true,
    privateAuthenticatedRead: false,
    immutableRetry: false,
    conflictingRetryRejected: false,
    anonymousReadRejected: false,
    fixtureCleanupVerified: false,
  };
  const mapped = (name: string) => {
    assert.match(name, /^system\/deletion-tombstones\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\.json$/);
    return `${prefix}${name}`;
  };
  const fixtureStorage: TombstoneStorage = {
    async createOnce(name, bytes, signal) {
      signal?.throwIfAborted();
      const path = mapped(name);
      touched.add(path);
      try {
        await bucket.file(path).save(bytes, {
          resumable: false, timeout: 20_000, contentType: "application/json",
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { metadata: {
            "custom:aclPolicy": JSON.stringify({ owner: "jobsage-system", visibility: "private" }),
            fixtureRunId: runId,
          } },
        });
      } catch (error) {
        if (Number((error as { code?: unknown }).code) !== 412) throw error;
        const [metadata] = await bucket.file(path).getMetadata();
        assert.equal(metadata.metadata?.fixtureRunId, runId, "fixture_identity_mismatch");
      }
    },
    read: (name, signal) => reader.read(mapped(name), signal),
    async names(namePrefix, signal) {
      const paths = await reader.names(`${prefix}${namePrefix}`, signal);
      return paths.map(path => path.slice(prefix.length));
    },
  };
  const registry = new IndependentTombstoneRegistry(fixtureStorage, appBucket, bucketId);
  const fixture = {
    version: 1 as const,
    id: randomUUID(),
    accountHash: createHash("sha256").update(`synthetic-deletion-fixture:${runId}`).digest("hex"),
    requestedAt: new Date().toISOString(),
  };
  try {
    await assert.rejects(reader.createOnce(
      `system/deletion-tombstones/v1/${fixture.accountHash}/${fixture.id}.json`,
      Buffer.from(JSON.stringify(fixture)),
    ), /deletion_release_blocked/);
    await registry.publish(fixture);
    const path = [...touched][0];
    const [before] = await bucket.file(path).getMetadata();
    await registry.publish(fixture);
    const [after] = await bucket.file(path).getMetadata();
    assert.equal(after.generation, before.generation, "immutable_generation_changed");
    report.immutableRetry = true;
    await assert.rejects(registry.publish({
      ...fixture, requestedAt: new Date(Date.parse(fixture.requestedAt) + 1000).toISOString(),
    }), /registry_receipt_mismatch/);
    report.conflictingRetryRejected = true;
    assert.deepEqual(await registry.list(), [fixture]);
    report.privateAuthenticatedRead = true;

    const publicUrl = `https://storage.googleapis.com/${encodeURIComponent(bucketId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(publicUrl, { signal: AbortSignal.timeout(15_000), redirect: "error" });
    await response.body?.cancel();
    assert.ok([401, 403, 404].includes(response.status), "fixture_anonymously_readable_or_inconclusive");
    report.anonymousReadRejected = true;
  } finally {
    // Only this invocation's exact marked objects; never delete a bucket/prefix
    // or an object whose marker/generation has changed.
    for (const path of touched) {
      const file = bucket.file(path);
      let metadata;
      try { [metadata] = await file.getMetadata(); }
      catch (error) {
        if (Number((error as { code?: unknown }).code) === 404) continue;
        throw new DeletionBlocked("fixture_cleanup_not_verified");
      }
      assert.equal(metadata.metadata?.fixtureRunId, runId, "fixture_cleanup_identity_mismatch");
      const generation = String(metadata.generation ?? "");
      assert.match(generation, /^[0-9]+$/, "fixture_cleanup_generation_missing");
      await bucket.file(path, { preconditionOpts: { ifGenerationMatch: generation } }).delete();
    }
    const leftovers = await reader.names(prefix);
    assert.equal(leftovers.length, 0, "fixture_cleanup_incomplete");
    report.fixtureCleanupVerified = true;
    console.log(JSON.stringify({ check: "deletion-registry-fixture", ...report }));
  }
}

void verify().catch(error => {
  // Do not log transport responses, bucket identifiers, object paths or secrets.
  const code = error instanceof DeletionBlocked ? error.code : "fixture_verification_failed";
  console.error(JSON.stringify({ check: "deletion-registry-fixture", passed: false, code }));
  process.exitCode = 1;
});
