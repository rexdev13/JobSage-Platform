import { randomUUID } from "node:crypto";
import { db, legalRetentionRecordsTable } from "@workspace/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { retentionExpiry, type RetentionBasis } from "@workspace/mobile-core";
import { encryptDeletionResource, decryptDeletionResource } from "./crypto";
import { DeletionBlocked } from "./engine";

export interface RetentionAuthority {
  /** Server-derived authority only; never deserialize this object from an HTTP request body. */
  role: string;
  purpose: "legal_review" | "hold_release" | "expiry";
  reauthenticated: boolean;
}
function checkAuthority(authority: RetentionAuthority) {
  if (authority.role !== "super_admin" || !authority.reauthenticated
    || !["legal_review", "hold_release", "expiry"].includes(authority.purpose)) {
    throw new DeletionBlocked("legal_archive_access_forbidden");
  }
}
const prohibited = /password|auth.*token|refresh.*token|recovery.*token|cv|passport|selfie|prompt|conversation|generated|attachment|document/i;
/** Retained summaries only. Legally required source documents need a separately reviewed hold manifest;
 * never dump a profile/AI/CV or credential into an archive to prove deletion. */
export function retainedSummary(fields: Record<string, unknown>, allowlist: readonly string[]) {
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of allowlist) {
    if (prohibited.test(key)) throw new DeletionBlocked("retained_sensitive_payload_forbidden");
    const value = fields[key];
    if (value === undefined) continue;
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new DeletionBlocked("retained_container_requires_review");
    }
    result[key] = value as string | number | boolean | null;
  }
  return result;
}
export async function archiveRetainedSummary(authority: RetentionAuthority, input: {
  requestId: string; basis: RetentionBasis; fields: Record<string, unknown>;
  allowlist: readonly string[]; holdReference?: string;
}) {
  checkAuthority(authority);
  if (input.basis.kind === "legal_hold" && !input.holdReference?.trim()) throw new DeletionBlocked("legal_hold_reference_required");
  const summary = retainedSummary(input.fields, input.allowlist);
  const [row] = await db.insert(legalRetentionRecordsTable).values({
    id: randomUUID(), requestId: input.requestId, category: input.basis.kind,
    lawfulReason: input.basis.reason, expiresAt: retentionExpiry(input.basis),
    holdReference: input.holdReference ?? null, recordCiphertext: encryptDeletionResource(JSON.stringify(summary)),
  }).returning({ id: legalRetentionRecordsTable.id });
  return row;
}
export async function readRetainedSummary(authority: RetentionAuthority, id: string) {
  checkAuthority(authority);
  const [record] = await db.select().from(legalRetentionRecordsTable).where(eq(legalRetentionRecordsTable.id, id));
  if (!record) return null;
  return { category: record.category, lawfulReason: record.lawfulReason, expiresAt: record.expiresAt,
    summary: JSON.parse(decryptDeletionResource(record.recordCiphertext)) as Record<string, unknown> };
}
/** No public route or startup scheduler invokes this while implementation/testing is in progress. */
export async function expireRetainedSummaries(authority: RetentionAuthority, now: Date) {
  checkAuthority(authority);
  if (authority.purpose !== "expiry") throw new DeletionBlocked("expiry_authority_required");
  return db.delete(legalRetentionRecordsTable).where(and(
    isNotNull(legalRetentionRecordsTable.expiresAt), lte(legalRetentionRecordsTable.expiresAt, now),
  )).returning({ id: legalRetentionRecordsTable.id });
}
