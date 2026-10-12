import { randomUUID } from "node:crypto";
import { db, accountDeletionRequestsTable as requests, accountDeletionTasksTable as tasks,
  deletionTombstoneOutboxTable as outbox, usersTable, employerProfilesTable } from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { accountDeletionHash, encryptDeletionResource, decryptDeletionResource } from "./crypto";
import { checkAcceptance, deletionDeadline, DeletionBlocked,
  type AcceptancePlan, type DeletionRequest, type DeletionStore, type DeletionTask } from "./engine";
import { parseCleanupResource } from "./resource";
import { requireDeletionRelease } from "./writeGate";
import { revokeLocalCredentials } from "./localCredentials";

export class PostgresDeletionStore implements DeletionStore {
  async accept(plan: AcceptancePlan, now: Date): Promise<DeletionRequest> {
    requireDeletionRelease();
    checkAcceptance(plan, now);
    if (plan.accountHash !== accountDeletionHash(plan.actor.id)) throw new DeletionBlocked("account_hash_mismatch");
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`account-deletion:${plan.accountHash}`}))`);
      const [existing] = await tx.select().from(requests).where(eq(requests.accountHash, plan.accountHash));
      if (existing) return { ...existing, deadline: deletionDeadline(existing.requestedAt) };
      // Lock/re-read the account: cached sessions and an earlier preflight are not authoritative.
      const [account] = await tx.select().from(usersTable).where(eq(usersTable.id, plan.actor.id)).for("update");
      if (!account || account.suspendedAt) throw new DeletionBlocked("account_unavailable");
      if (account.role !== plan.actor.role) throw new DeletionBlocked("account_changed");
      // Current legacy schema has one organisation administrator (employer_profiles.user_id).
      // Never infer additional organisation membership from a global employer/admin role.
      const [ownedOrganisation] = await tx.select({ id: employerProfilesTable.id }).from(employerProfilesTable)
        .where(eq(employerProfilesTable.userId, account.id));
      if (ownedOrganisation) throw new DeletionBlocked("organisation_ownership_transfer_required");
      const id = randomUUID();
      const [request] = await tx.insert(requests).values({
        id, accountHash: plan.accountHash, requestedAt: now, outcome: "pending",
      }).returning();
      await tx.insert(tasks).values(plan.tasks.map(task => ({
        id: randomUUID(), requestId: id, kind: task.kind,
        resourceCiphertext: encryptDeletionResource(task.resource), retryAt: now,
      })));
      await tx.insert(outbox).values({ requestId: id });
      // Quarantine first, atomically with all local credential revocation. Workers must check
      // suspendedAt immediately before dispatch; already-in-flight remote deliveries cannot be recalled.
      await revokeLocalCredentials(tx, account.id, now);
      return { ...request, deadline: deletionDeadline(request.requestedAt) };
    });
  }

  async claim(requestId: string, now: Date): Promise<DeletionTask | null> {
    requireDeletionRelease();
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`deletion-work:${requestId}`}))`);
      const selected = await tx.execute(sql`
        SELECT * FROM ${tasks} WHERE request_id = ${requestId}
          AND state <> 'complete' AND retry_at <= ${now}
          AND (lease_until IS NULL OR lease_until <= ${now})
          AND (
            kind = 'token_revocation'
            OR NOT EXISTS (SELECT 1 FROM ${tasks} AS prior WHERE prior.request_id = ${requestId}
              AND prior.kind = 'token_revocation' AND prior.state <> 'complete')
          )
          AND (
            kind <> 'active_data'
            OR NOT EXISTS (SELECT 1 FROM ${tasks} AS prior WHERE prior.request_id = ${requestId}
              AND prior.kind IN ('object', 'processor', 'device_data') AND prior.state <> 'complete')
          )
          AND (kind <> 'completion_notice' OR (
            NOT EXISTS (SELECT 1 FROM ${tasks} AS other WHERE other.request_id = ${requestId}
              AND other.kind <> 'completion_notice' AND other.state <> 'complete')
            AND EXISTS (SELECT 1 FROM ${outbox} WHERE request_id = ${requestId} AND acknowledged_at IS NOT NULL)
          ))
        ORDER BY CASE kind WHEN 'token_revocation' THEN 0 WHEN 'object' THEN 1
          WHEN 'processor' THEN 2 WHEN 'device_data' THEN 3 WHEN 'active_data' THEN 4
          WHEN 'completion_notice' THEN 9 ELSE 5 END, id
        LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const row = selected.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      if (typeof row.resource_ciphertext !== "string") throw new DeletionBlocked("resource_invalid");
      let resourceText: string;
      try { resourceText = decryptDeletionResource(row.resource_ciphertext); }
      catch { throw new DeletionBlocked("resource_invalid"); }
      const resource = parseCleanupResource(resourceText);
      if (!resource) throw new DeletionBlocked("resource_invalid");
      const [request] = await tx.select({ accountHash: requests.accountHash }).from(requests)
        .where(eq(requests.id, requestId));
      if (!request) throw new DeletionBlocked("request_not_found");
      if (accountDeletionHash(resource.accountId) !== request.accountHash) throw new DeletionBlocked("task_account_mismatch");
      const id = String(row.id);
      const attempts = Number(row.attempts) + 1;
      await tx.update(tasks).set({
        state: "running", attempts, leaseUntil: new Date(now.getTime() + 300_000),
      }).where(eq(tasks.id, id));
      return { id, requestId, kind: String(row.kind) as DeletionTask["kind"], state: "running", attempts,
        resource: resourceText };
    });
  }

  async taskComplete(task: DeletionTask) {
    requireDeletionRelease();
    await db.update(tasks).set({ state: "complete", resourceCiphertext: null, failureCode: null, leaseUntil: null })
      .where(and(eq(tasks.id, task.id), eq(tasks.attempts, task.attempts), eq(tasks.state, "running")));
  }
  async taskBlocked(task: DeletionTask, code: string, retryAt: Date) {
    requireDeletionRelease();
    await db.transaction(async tx => {
      const changed = await tx.update(tasks).set({ state: "blocked", failureCode: code, retryAt, leaseUntil: null })
        .where(and(eq(tasks.id, task.id), eq(tasks.attempts, task.attempts), eq(tasks.state, "running"))).returning({ id: tasks.id });
      if (changed.length) await tx.update(requests).set({ outcome: "blocked" }).where(and(
        eq(requests.id, task.requestId), sql`${requests.completedAt} IS NULL`,
      ));
    });
  }
  async completeIfReady(requestId: string, now: Date) {
    requireDeletionRelease();
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`deletion-work:${requestId}`}))`);
      const [request] = await tx.select().from(requests).where(eq(requests.id, requestId));
      if (!request) throw new DeletionBlocked("request_not_found");
      if (request.completedAt) return true;
      const [pending] = await tx.select({ id: tasks.id }).from(tasks).where(and(
        eq(tasks.requestId, requestId), sql`${tasks.state} <> 'complete'`,
      )).limit(1);
      const [registry] = await tx.select().from(outbox).where(eq(outbox.requestId, requestId));
      if (pending || !registry?.acknowledgedAt) return false;
      await tx.update(requests).set({ completedAt: now, outcome: "completed" }).where(eq(requests.id, requestId));
      // Keep only the permitted minimal tombstone, not operational resources/error trails.
      await tx.delete(tasks).where(eq(tasks.requestId, requestId));
      await tx.delete(outbox).where(eq(outbox.requestId, requestId));
      return true;
    });
  }
  /** Claim by ordered read: only one minimal pseudonymous receipt is published per worker cycle. */
  async nextPendingTombstone() {
    const [row] = await db.select({
      id: requests.id,
      accountHash: requests.accountHash,
      requestedAt: requests.requestedAt,
    }).from(outbox)
      .innerJoin(requests, eq(outbox.requestId, requests.id))
      .where(isNull(outbox.acknowledgedAt))
      .orderBy(asc(requests.requestedAt), asc(requests.id))
      .limit(1);
    return row ?? null;
  }
  /** A remote write may succeed before this acknowledgement; retries must be safe. */
  async acknowledgeTombstone(requestId: string, at: Date) {
    requireDeletionRelease();
    const [updated] = await db.update(outbox).set({ acknowledgedAt: at })
      .where(and(eq(outbox.requestId, requestId), isNull(outbox.acknowledgedAt)))
      .returning({ requestId: outbox.requestId });
    if (updated) return;
    const [existing] = await db.select({ acknowledgedAt: outbox.acknowledgedAt })
      .from(outbox).where(eq(outbox.requestId, requestId));
    if (!existing?.acknowledgedAt) throw new DeletionBlocked("outbox_entry_missing");
  }
  async get(requestId: string): Promise<DeletionRequest> {
    const [request] = await db.select().from(requests).where(eq(requests.id, requestId));
    if (!request) throw new DeletionBlocked("request_not_found");
    return { ...request, deadline: deletionDeadline(request.requestedAt) };
  }
}
