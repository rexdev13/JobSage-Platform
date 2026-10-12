import { ACCOUNT_DELETION_POLICY, addCalendarDays } from "@workspace/mobile-core";

export type DeletionTaskKind = "token_revocation" | "active_data" | "object" | "processor" | "device_data" | "completion_notice";
export type DeletionTaskState = "pending" | "running" | "blocked" | "complete";
export interface DeletionTask {
  id: string;
  requestId: string;
  kind: DeletionTaskKind;
  state: DeletionTaskState;
  attempts: number;
  /** Ciphertext only in persistent implementations; never include payloads in audit/error output. */
  resource: string;
}
export interface DeletionRequest {
  id: string;
  accountHash: string;
  requestedAt: Date;
  deadline: Date;
  completedAt: Date | null;
  outcome: "pending" | "blocked" | "completed";
}
export interface DeletionActor {
  id: string; role: string; impersonating: boolean;
  /** A password/provider challenge verified now, NOT session/capability issuance time. */
  reauthenticatedAt: Date | null; confirmed: boolean;
}
export interface OwnershipCheck {
  organisationId: number;
  ownsSharedRecords: boolean;
  transferRequired: boolean;
}
export interface AcceptancePlan {
  actor: DeletionActor;
  accountHash: string;
  ownership: OwnershipCheck[];
  tasks: Array<Pick<DeletionTask, "kind" | "resource">>;
}
export class DeletionBlocked extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface DeletionStore {
  /** Must atomically lock account, enforce preflight, quarantine it, revoke all local credentials,
   * stop delivery/application work, save tasks and publish a recoverable tombstone outbox. */
  accept(plan: AcceptancePlan, now: Date): Promise<DeletionRequest>;
  /** Durable, exclusive claim; expired claims are eligible for retry after a process crash. */
  claim(requestId: string, now: Date): Promise<DeletionTask | null>;
  taskComplete(task: DeletionTask): Promise<void>;
  taskBlocked(task: DeletionTask, code: string, retryAt: Date): Promise<void>;
  /** Completion is conditional on every non-notice task and backup registry acknowledgement. */
  completeIfReady(requestId: string, now: Date): Promise<boolean>;
  get(requestId: string): Promise<DeletionRequest>;
}
export interface DeletionExecutor {
  run(task: DeletionTask): Promise<void>;
}

export function checkAcceptance(plan: AcceptancePlan, now: Date) {
  const { actor } = plan;
  if (actor.impersonating) throw new DeletionBlocked("impersonation_forbidden");
  if (actor.confirmed !== true) throw new DeletionBlocked("confirmation_required");
  const age = actor.reauthenticatedAt && now.getTime() - actor.reauthenticatedAt.getTime();
  if (age === null || !Number.isFinite(age) || age < 0 || age > 5 * 60_000) throw new DeletionBlocked("recent_reauthentication_required");
  if (!actor.id || !plan.accountHash) throw new DeletionBlocked("account_required");
  if (plan.ownership.some(org => org.ownsSharedRecords && org.transferRequired)) {
    throw new DeletionBlocked("organisation_ownership_transfer_required");
  }
  if (!plan.tasks.some(task => task.kind === "active_data")) throw new DeletionBlocked("erasure_plan_required");
}

export async function acceptDeletion(store: DeletionStore, plan: AcceptancePlan, now = new Date()) {
  checkAcceptance(plan, now);
  return store.accept(plan, now);
}

/** One bounded work unit. Failures remain durable/retryable, never synthetic successes.
 * External operations MUST support idempotency: a process may die between remote success and acknowledgement. */
export async function processDeletion(store: DeletionStore, executor: DeletionExecutor, requestId: string, now = new Date()) {
  const task = await store.claim(requestId, now);
  if (task) {
    try {
      await executor.run(task);
      await store.taskComplete(task);
    } catch (error) {
      const code = error instanceof DeletionBlocked ? error.code : "cleanup_failed";
      const safeCode = /^[a-z_]{1,80}$/.test(code) ? code : "cleanup_failed";
      const retry = addCalendarDays(now, 0);
      retry.setTime(retry.getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(task.attempts, 7)));
      await store.taskBlocked(task, safeCode, retry);
    }
  }
  const completed = await store.completeIfReady(requestId, now);
  const request = await store.get(requestId);
  return { completed, deadlineExceeded: !completed && now > request.deadline, outcome: request.outcome };
}

export function deletionDeadline(requestedAt: Date) {
  return addCalendarDays(requestedAt, ACCOUNT_DELETION_POLICY.activeSystemDays);
}

/** Restore orchestrators must finish replay before resuming access, mail or scheduled work.
 * The registry must be outside the restored application's database/backup lineage. */
export async function replayDeletionTombstones(
  registry: { list(): Promise<Pick<DeletionRequest, "id" | "accountHash">[]> },
  restored: { eraseByAccountHash(hash: string, requestId: string): Promise<void> },
) {
  const tombstones = await registry.list(); // Registry failure must fail restore closed.
  for (const tombstone of tombstones) await restored.eraseByAccountHash(tombstone.accountHash, tombstone.id);
}
