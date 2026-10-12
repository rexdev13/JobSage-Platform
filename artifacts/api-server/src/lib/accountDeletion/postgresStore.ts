import { randomUUID } from "node:crypto";
import { db, accountDeletionRequestsTable as requests, accountDeletionTasksTable as tasks,
  deletionTombstoneOutboxTable as outbox, usersTable, sessionsTable, employerProfilesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { accountDeletionHash, encryptDeletionResource, decryptDeletionResource } from "./crypto";
import { checkAcceptance, deletionDeadline, DeletionBlocked,
  type AcceptancePlan, type DeletionRequest, type DeletionStore, type DeletionTask } from "./engine";

export class PostgresDeletionStore implements DeletionStore {
  async accept(plan: AcceptancePlan, now: Date): Promise<DeletionRequest> {
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
      await tx.update(usersTable).set({
        suspendedAt: now, passwordHash: null, passwordResetToken: null, passwordResetTokenExpires: null,
        emailVerifyToken: null, emailVerifyTokenExpires: null, googleBookingEnabled: false,
      }).where(eq(usersTable.id, account.id));
      await tx.delete(sessionsTable).where(sql`
        ${sessionsTable.sess}->'user'->>'id' = ${account.id}
        OR ${sessionsTable.sess}->>'userId' = ${account.id}
        OR ${sessionsTable.sess}->>'adminId' = ${account.id}
        OR ${sessionsTable.sess}->>'impersonatingUserId' = ${account.id}`);
      return { ...request, deadline: deletionDeadline(request.requestedAt) };
    });
  }

  async claim(requestId: string, now: Date): Promise<DeletionTask | null> {
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
          AND (kind <> 'completion_notice' OR (
            NOT EXISTS (SELECT 1 FROM ${tasks} AS other WHERE other.request_id = ${requestId}
              AND other.kind <> 'completion_notice' AND other.state <> 'complete')
            AND EXISTS (SELECT 1 FROM ${outbox} WHERE request_id = ${requestId} AND acknowledged_at IS NOT NULL)
          ))
        ORDER BY CASE kind WHEN 'token_revocation' THEN 0 WHEN 'active_data' THEN 1
          WHEN 'completion_notice' THEN 9 ELSE 2 END, id
        LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const row = selected.rows[0] as Record<string, unknown> | undefined;
      if (!row || typeof row.resource_ciphertext !== "string") return null;
      const id = String(row.id);
      const attempts = Number(row.attempts) + 1;
      await tx.update(tasks).set({
        state: "running", attempts, leaseUntil: new Date(now.getTime() + 300_000),
      }).where(eq(tasks.id, id));
      return { id, requestId, kind: String(row.kind) as DeletionTask["kind"], state: "running", attempts,
        resource: decryptDeletionResource(row.resource_ciphertext) };
    });
  }

  async taskComplete(task: DeletionTask) {
    await db.update(tasks).set({ state: "complete", resourceCiphertext: null, failureCode: null, leaseUntil: null })
      .where(and(eq(tasks.id, task.id), eq(tasks.attempts, task.attempts), eq(tasks.state, "running")));
  }
  async taskBlocked(task: DeletionTask, code: string, retryAt: Date) {
    await db.transaction(async tx => {
      const changed = await tx.update(tasks).set({ state: "blocked", failureCode: code, retryAt, leaseUntil: null })
        .where(and(eq(tasks.id, task.id), eq(tasks.attempts, task.attempts), eq(tasks.state, "running"))).returning({ id: tasks.id });
      if (changed.length) await tx.update(requests).set({ outcome: "blocked" }).where(and(
        eq(requests.id, task.requestId), sql`${requests.completedAt} IS NULL`,
      ));
    });
  }
  async completeIfReady(requestId: string, now: Date) {
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
  async get(requestId: string): Promise<DeletionRequest> {
    const [request] = await db.select().from(requests).where(eq(requests.id, requestId));
    if (!request) throw new DeletionBlocked("request_not_found");
    return { ...request, deadline: deletionDeadline(request.requestedAt) };
  }
}
