import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DELETION_POLICY, addCalendarDays, retentionExpiry } from "@workspace/mobile-core";
import { acceptDeletion, checkAcceptance, deletionDeadline, DeletionBlocked, processDeletion,
  replayDeletionTombstones, type AcceptancePlan, type DeletionRequest, type DeletionStore, type DeletionTask } from "../../lib/accountDeletion/engine";
import { accountDeletionHash, decryptDeletionResource, encryptDeletionResource } from "../../lib/accountDeletion/crypto";

const now = new Date("2026-10-12T10:00:00Z");
/** Isolated fixtures only. No db/HTTP/storage/provider clients imported or real identifiers used. */
class Fixtures implements DeletionStore {
  users = new Map([
    ["fixture-candidate", { role: "candidate", enabled: true, marketing: true, notifications: true, automaticApply: true }],
    ["fixture-other", { role: "candidate", enabled: true, marketing: true, notifications: true, automaticApply: true }],
  ]);
  credentials = new Map([["fixture-candidate", ["cookie", "native", "exchange", "refresh", "push", "apple", "recovery"]]]);
  ownData = new Map([["fixture-candidate", ["profile", "cv", "passport", "ai", "draft", "answers", "calendar"]], ["fixture-other", ["other-cv"]]]);
  organisations = [{ id: 1, job: "org-job", campaign: "org-campaign", application: "other-application", author: "fixture-staff" }];
  requests = new Map<string, DeletionRequest>();
  tasks: DeletionTask[] = [];
  retries = new Map<string, Date>();
  registryAcknowledged = false;
  notices: string[] = [];
  blockedCodes: string[] = [];
  acceptCalls = 0;
  async accept(plan: AcceptancePlan, at: Date) {
    const existing = [...this.requests.values()].find(r => r.accountHash === plan.accountHash);
    if (existing) return existing;
    this.acceptCalls++;
    const user = this.users.get(plan.actor.id)!;
    Object.assign(user, { enabled: false, marketing: false, notifications: false, automaticApply: false });
    this.credentials.delete(plan.actor.id);
    const record: DeletionRequest = { id: `fixture-request-${this.acceptCalls}`, accountHash: plan.accountHash,
      requestedAt: at, deadline: deletionDeadline(at), completedAt: null, outcome: "pending" };
    this.requests.set(record.id, record);
    this.tasks.push(...plan.tasks.map((task, index): DeletionTask => ({
      ...task, id: `fixture-task-${index}`, requestId: record.id, state: "pending", attempts: 0,
    })));
    return record;
  }
  async claim(requestId: string, at: Date) {
    const eligible = this.tasks.filter(t => t.requestId === requestId && t.state !== "complete" && t.state !== "running"
      && (!this.retries.has(t.id) || this.retries.get(t.id)! <= at));
    const hasRevocations = this.tasks.some(t => t.requestId === requestId && t.kind === "token_revocation" && t.state !== "complete");
    const task = eligible.find(t => (!hasRevocations || t.kind === "token_revocation")
      && (t.kind !== "completion_notice" || (this.registryAcknowledged
        && !this.tasks.some(other => other.requestId === requestId && other.kind !== "completion_notice" && other.state !== "complete"))));
    if (!task) return null;
    task.state = "running"; task.attempts++;
    return { ...task };
  }
  async taskComplete(claim: DeletionTask) {
    const task = this.tasks.find(t => t.id === claim.id)!;
    if (task.attempts !== claim.attempts || task.state !== "running") return;
    task.state = "complete"; task.resource = "";
  }
  async taskBlocked(claim: DeletionTask, code: string, retryAt: Date) {
    const task = this.tasks.find(t => t.id === claim.id)!;
    if (task.attempts !== claim.attempts || task.state !== "running") return;
    task.state = "blocked"; this.retries.set(task.id, retryAt); this.blockedCodes.push(code);
    this.requests.get(claim.requestId)!.outcome = "blocked";
  }
  async completeIfReady(id: string, at: Date) {
    if (!this.registryAcknowledged || this.tasks.some(t => t.requestId === id && t.state !== "complete")) return false;
    const request = this.requests.get(id)!;
    request.completedAt ??= at; request.outcome = "completed";
    this.tasks = this.tasks.filter(t => t.requestId !== id);
    return true;
  }
  async get(id: string) { return this.requests.get(id)!; }
}
function plan(id = "fixture-candidate", role = "candidate"): AcceptancePlan {
  return { actor: { id, role, impersonating: false, reauthenticatedAt: now, confirmed: true },
    accountHash: `fixture-hash-${id}`, ownership: [],
    tasks: [{ kind: "token_revocation", resource: id }, { kind: "active_data", resource: id },
      { kind: "processor", resource: "fixture-controlled-processor" }, { kind: "completion_notice", resource: "fixture-notice" }] };
}
function executor(store: Fixtures) {
  return { run: vi.fn(async (task: DeletionTask) => {
    if (task.kind === "active_data") {
      store.ownData.delete(task.resource); store.users.delete(task.resource);
      for (const org of store.organisations) if (org.author === task.resource) org.author = "Deleted User";
    }
    if (task.kind === "completion_notice") store.notices.push(task.requestId);
  }) };
}
describe("owner-approved account deletion, isolated fixtures", () => {
  beforeEach(() => {
    vi.stubEnv("ACCOUNT_DELETION_MASTER_KEY", "fixture-only-key-not-a-production-secret-123456789");
  });
  it("quarantines a candidate and revokes all local credential classes immediately", async () => {
    const store = new Fixtures();
    await acceptDeletion(store, plan(), now);
    expect(store.users.get("fixture-candidate")).toMatchObject({ enabled: false, marketing: false, notifications: false, automaticApply: false });
    expect(store.credentials.has("fixture-candidate")).toBe(false);
    expect(store.users.get("fixture-other")!.enabled).toBe(true);
  });
  it("deletes candidate-owned personal data, preserves other people and confirms only after cleanup", async () => {
    const store = new Fixtures(); store.registryAcknowledged = true;
    const request = await acceptDeletion(store, plan(), now);
    const run = executor(store);
    for (let i = 0; i < 4; i++) await processDeletion(store, run, request.id, now);
    expect(store.ownData.has("fixture-candidate")).toBe(false);
    expect(store.ownData.get("fixture-other")).toEqual(["other-cv"]);
    expect(store.organisations[0].job).toBe("org-job");
    expect((await store.get(request.id)).outcome).toBe("completed");
    expect(store.notices).toEqual([request.id]);
    expect(store.tasks).toHaveLength(0);
    expect(Object.keys(await store.get(request.id)).sort()).toEqual(
      ["id", "accountHash", "requestedAt", "deadline", "completedAt", "outcome"].sort());
  });
  it.each(["employer", "admin", "super_admin", "marketing"])("preserves organisation records for a departing %s", async role => {
    const store = new Fixtures(); store.registryAcknowledged = true;
    store.users.set("fixture-staff", { role, enabled: true, marketing: true, notifications: true, automaticApply: true });
    store.ownData.set("fixture-staff", ["staff-contact", "staff-photo"]);
    const input = plan("fixture-staff", role);
    input.ownership = [{ organisationId: 1, ownsSharedRecords: true, transferRequired: false }];
    const request = await acceptDeletion(store, input, now);
    for (let i = 0; i < 4; i++) await processDeletion(store, executor(store), request.id, now);
    expect(store.organisations).toEqual([{ id: 1, job: "org-job", campaign: "org-campaign", application: "other-application", author: "Deleted User" }]);
    expect(store.users.has("fixture-staff")).toBe(false);
  });
  it("blocks sole-organisation-owner deletion before changing credentials or shared records", async () => {
    const store = new Fixtures(); const input = plan();
    input.ownership = [{ organisationId: 1, ownsSharedRecords: true, transferRequired: true }];
    await expect(acceptDeletion(store, input, now)).rejects.toThrow("organisation_ownership_transfer_required");
    expect(store.users.get("fixture-candidate")!.enabled).toBe(true);
    expect(store.credentials.has("fixture-candidate")).toBe(true);
    expect(store.acceptCalls).toBe(0);
  });
  it("accepts repeated requests idempotently", async () => {
    const store = new Fixtures();
    const first = await acceptDeletion(store, plan(), now);
    const second = await acceptDeletion(store, plan(), now);
    expect(second.id).toBe(first.id); expect(store.acceptCalls).toBe(1); expect(store.tasks).toHaveLength(4);
  });
  it.each(["confirmation", "old", "future", "missing", "invalid_date", "impersonation"])("fails closed for invalid %s proof", kind => {
    const input = plan();
    if (kind === "confirmation") input.actor.confirmed = false;
    if (kind === "old") input.actor.reauthenticatedAt = new Date(now.getTime() - 300_001);
    if (kind === "future") input.actor.reauthenticatedAt = new Date(now.getTime() + 1);
    if (kind === "missing") input.actor.reauthenticatedAt = null;
    if (kind === "invalid_date") input.actor.reauthenticatedAt = new Date(Number.NaN);
    if (kind === "impersonation") input.actor.impersonating = true;
    expect(() => checkAcceptance(input, now)).toThrow(DeletionBlocked);
  });
  it("does not let a newly issued session substitute for explicit reauthentication", () => {
    expect(() => checkAcceptance({ ...plan(), actor: { ...plan().actor, reauthenticatedAt: null } }, now))
      .toThrow("recent_reauthentication_required");
  });
  it("dispatches provider jobs, keeps failures retryable and does not send premature completion", async () => {
    const store = new Fixtures(); store.registryAcknowledged = true;
    const request = await acceptDeletion(store, plan(), now);
    const run = executor(store);
    await processDeletion(store, run, request.id, now); await processDeletion(store, run, request.id, now);
    const remote = { run: vi.fn().mockRejectedValue(new Error("private provider details should not persist")) };
    const result = await processDeletion(store, remote, request.id, now);
    expect(remote.run).toHaveBeenCalledWith(expect.objectContaining({ kind: "processor" }));
    expect(result.completed).toBe(false); expect(store.blockedCodes).toEqual(["cleanup_failed"]); expect(store.notices).toHaveLength(0);
    await processDeletion(store, run, request.id, addCalendarDays(now, 1));
    await processDeletion(store, run, request.id, addCalendarDays(now, 1));
    expect((await store.get(request.id)).outcome).toBe("completed");
  });
  it("does not complete without an independent backup-registry acknowledgement", async () => {
    const store = new Fixtures();
    const request = await acceptDeletion(store, plan(), now);
    for (let i = 0; i < 6; i++) await processDeletion(store, executor(store), request.id, now);
    expect((await store.get(request.id)).completedAt).toBeNull(); expect(store.notices).toHaveLength(0);
  });
  it("flags an overdue request instead of claiming 30-day success", async () => {
    const store = new Fixtures(); const request = await acceptDeletion(store, plan(), now);
    const result = await processDeletion(store, { run: async () => { throw new DeletionBlocked("provider_unavailable"); } },
      request.id, addCalendarDays(now, 31));
    expect(result).toMatchObject({ completed: false, deadlineExceeded: true, outcome: "blocked" });
  });
  it("fences stale acknowledgements from an expired worker claim", async () => {
    const store = new Fixtures(); const request = await acceptDeletion(store, plan(), now);
    const old = await store.claim(request.id, now);
    store.tasks[0].state = "pending"; // Simulated lease expiry, isolated fixture.
    const current = await store.claim(request.id, now);
    await store.taskComplete(old!);
    expect(store.tasks[0].state).toBe("running");
    await store.taskComplete(current!); expect(store.tasks[0].state).toBe("complete");
  });
  it("replays restore tombstones using pseudonyms, never archived CV/profile payloads", async () => {
    const store = new Fixtures(); const request = await acceptDeletion(store, plan(), now);
    const eraseByAccountHash = vi.fn().mockResolvedValue(undefined);
    await replayDeletionTombstones({ list: async () => [request] }, { eraseByAccountHash });
    expect(eraseByAccountHash).toHaveBeenCalledWith(request.accountHash, request.id);
  });
  it("fails a restore closed if its registry or cleanup fails", async () => {
    await expect(replayDeletionTombstones({ list: async () => { throw new Error("registry unavailable"); } },
      { eraseByAccountHash: vi.fn() })).rejects.toThrow("registry unavailable");
    const store = new Fixtures(); const request = await acceptDeletion(store, plan(), now);
    await expect(replayDeletionTombstones({ list: async () => [request] },
      { eraseByAccountHash: async () => { throw new Error("erasure incomplete"); } })).rejects.toThrow("erasure incomplete");
  });
  it("uses 30 calendar days and exposes the 90-day encrypted backup policy", () => {
    expect(deletionDeadline(now).toISOString()).toBe("2026-11-11T10:00:00.000Z");
    expect(ACCOUNT_DELETION_POLICY.encryptedBackupDays).toBe(90);
  });
  it("requires a documented basis for retained records", () => {
    expect(() => retentionExpiry({ kind: "security", recordedAt: now, reason: "" })).toThrow("documented lawful reason");
  });
  it("retains financial records from the actual company financial-year end, not request time", () => {
    expect(retentionExpiry({ kind: "financial", companyFinancialYearEnd: new Date("2026-03-31T23:59:59Z"), reason: "statutory tax record" })?.toISOString())
      .toBe("2032-03-31T23:59:59.000Z");
  });
  it("calculates security and closed-complaint retention, clamping leap dates", () => {
    expect(retentionExpiry({ kind: "security", recordedAt: new Date("2024-02-29T12:00:00Z"), reason: "access security" })?.toISOString())
      .toBe("2025-02-28T12:00:00.000Z");
    expect(retentionExpiry({ kind: "complaint", closedAt: now, reason: "closed complaint" })?.toISOString())
      .toBe("2028-10-12T10:00:00.000Z");
  });
  it("retains legal holds only until their documented obligation ends", () => {
    expect(retentionExpiry({ kind: "legal_hold", obligationEndsAt: null, reason: "active court hold" })).toBeNull();
    expect(retentionExpiry({ kind: "legal_hold", obligationEndsAt: now, reason: "court hold released" })).toEqual(now);
  });
  it("encrypts operational resources and rejects tampering", () => {
    const plain = JSON.stringify({ accountId: "fixture-candidate", object: "/fixture/cv" });
    const encrypted = encryptDeletionResource(plain);
    expect(encrypted).not.toContain("fixture-candidate"); expect(decryptDeletionResource(encrypted)).toBe(plain);
    const parts = encrypted.split("."); const bytes = Buffer.from(parts[3], "base64"); bytes[0] ^= 1; parts[3] = bytes.toString("base64");
    expect(() => decryptDeletionResource(parts.join("."))).toThrow();
  });
  it("uses stable domain-separated pseudonyms, without exposing a plain account identifier", () => {
    const hash = accountDeletionHash("fixture-candidate");
    expect(hash).toMatch(/^[a-f0-9]{64}$/); expect(hash).toBe(accountDeletionHash("fixture-candidate"));
    expect(hash).not.toBe(accountDeletionHash("fixture-other"));
  });
});
