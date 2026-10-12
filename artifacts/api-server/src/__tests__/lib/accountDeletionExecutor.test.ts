import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, legalRetentionRecordsTable: {} }));
import { AccountDeletionExecutor, type CleanupAdapters } from "../../lib/accountDeletion/executor";
import { archiveRetainedSummary, readRetainedSummary, retainedSummary } from "../../lib/accountDeletion/retention";
import type { DeletionTask } from "../../lib/accountDeletion/engine";

function adapters(): CleanupAdapters {
  return {
    revokeTokens: vi.fn().mockResolvedValue(undefined), eraseActiveData: vi.fn().mockResolvedValue(undefined),
    eraseObject: vi.fn().mockResolvedValue(undefined), eraseProcessor: vi.fn().mockResolvedValue("erased"),
    clearDeviceData: vi.fn().mockResolvedValue(undefined), sendCompletion: vi.fn().mockResolvedValue(undefined),
  };
}
function task(kind: DeletionTask["kind"]): DeletionTask {
  return { id: "fixture-task", requestId: "fixture-request", state: "running", attempts: 1, kind,
    resource: JSON.stringify({ version: 1, accountId: "fixture-candidate", reference: "fixture-controlled-resource" }) };
}
describe("controlled deletion adapters and retained data", () => {
  beforeEach(() => { vi.stubEnv("ACCOUNT_DELETION_MASTER_KEY", "fixture-only-key-not-a-production-secret-123456789"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it.each([
    ["token_revocation", "revokeTokens"], ["active_data", "eraseActiveData"], ["object", "eraseObject"],
    ["processor", "eraseProcessor"], ["device_data", "clearDeviceData"], ["completion_notice", "sendCompletion"],
  ] as const)("dispatches %s using a stable idempotency key", async (kind, operation) => {
    const ports = adapters();
    await new AccountDeletionExecutor(ports).run(task(kind));
    expect(ports[operation]).toHaveBeenCalledWith(expect.objectContaining({ accountId: "fixture-candidate" }), "fixture-task");
  });
  it.each(["dispatched", "unsupported"] as const)("never equates provider %s with confirmed erasure", async status => {
    const ports = adapters(); ports.eraseProcessor = vi.fn().mockResolvedValue(status);
    await expect(new AccountDeletionExecutor(ports).run(task("processor"))).rejects.toThrow(
      status === "dispatched" ? "provider_confirmation_pending" : "provider_erasure_unsupported");
  });
  it("rejects corrupt task payloads before invoking any provider", async () => {
    const ports = adapters();
    await expect(new AccountDeletionExecutor(ports).run({ ...task("processor"), resource: "{}" })).rejects.toThrow("resource_invalid");
    expect(ports.eraseProcessor).not.toHaveBeenCalled();
  });
  it("retains only explicitly allowlisted scalar summaries", () => {
    expect(retainedSummary({ amount: 100, currency: "GBP", cv: "private", profile: { phone: "private" } }, ["amount", "currency"]))
      .toEqual({ amount: 100, currency: "GBP" });
  });
  it.each(["passwordHash", "refreshToken", "cvText", "passportKey", "aiPrompt", "generatedContent", "document"])("rejects retained %s as deletion evidence", key => {
    expect(() => retainedSummary({ [key]: "private" }, [key])).toThrow("retained_sensitive_payload_forbidden");
  });
  it("rejects unreviewed nested containers", () => {
    expect(() => retainedSummary({ notes: { private: "profile" } }, ["notes"])).toThrow("retained_container_requires_review");
  });
  it.each(["candidate", "employer", "marketing", "admin"])("prevents %s access to the legal archive before database access", async role => {
    await expect(readRetainedSummary({ role, purpose: "legal_review", reauthenticated: true }, "fixture-record"))
      .rejects.toThrow("legal_archive_access_forbidden");
    await expect(archiveRetainedSummary({ role, purpose: "legal_review", reauthenticated: true }, {
      requestId: "fixture-request", basis: { kind: "security", recordedAt: new Date(), reason: "security" },
      fields: {}, allowlist: [],
    })).rejects.toThrow("legal_archive_access_forbidden");
  });
  it("requires reauthentication even for a super administrator", async () => {
    await expect(readRetainedSummary({ role: "super_admin", purpose: "legal_review", reauthenticated: false }, "fixture-record"))
      .rejects.toThrow("legal_archive_access_forbidden");
  });
});
