import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { requireClaimedCleanup } from "./cleanupScope";
import { DeletionBlocked } from "./engine";
import type { CleanupResource } from "./resource";
import { requireDeletionRelease } from "./writeGate";

/** Only this non-shared candidate partition is executable here. It deliberately
 * excludes account/file pointers, staff-authored cases, complaint/feedback
 * threads, consent evidence, employer organisations and public catalogues.
 * Do not wire this alone as the full eraseActiveData adapter. */
export const CANDIDATE_DERIVED_TABLES = [
  "career_profiles", "candidate_badges", "candidate_match_scores", "match_dismissals",
  "cv_enhancement_usage", "candidate_readiness_claims", "role_gap_analyses", "smart_apply_drafts",
  "vacancy_favorites", "sponsor_licence_bookmarks", "sponsor_licence_vacancy_scores",
  "sponsor_licence_gap_analyses", "job_alert_vacancy_deliveries", "message_sender_blocks",
  "privacy_preferences", "push_devices",
] as const;
const OTHER_CANDIDATE_ROWS = [
  ["profiles", "user_id"], ["documents", "user_id"], ["identity_verifications", "user_id"],
  ["applications", "user_id"], ["speculative_applications", "user_id"],
  ["speculative_application_delivery_attempts", "user_id"], ["candidate_messages", "recipient_user_id"],
  ["decision_records", "user_id"], ["recommendation_letters", "candidate_user_id"],
  ["support_tickets", "user_id"], ["feedback", "user_id"], ["consent_logs", "user_id"],
] as const;
interface QueryClient { execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> }

function verifiedCount(raw: unknown) {
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^[0-9]+$/.test(raw))) {
    throw new DeletionBlocked("candidate_inventory_unverified");
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new DeletionBlocked("candidate_inventory_unverified");
  return n;
}

export function candidateOwnedSelections(accountId: string) {
  if (!accountId || accountId.length > 150) throw new DeletionBlocked("account_required");
  return [
    ...CANDIDATE_DERIVED_TABLES.map(table => ({ table, derivedOnly: true,
      predicate: sql`${sql.identifier("user_id")} = ${accountId}` })),
    ...OTHER_CANDIDATE_ROWS.map(([table, owner]) => ({ table, derivedOnly: false,
      predicate: sql`${sql.identifier(owner)} = ${accountId}` })),
    { table: "remediation_plans", derivedOnly: false, predicate: sql`user_id = ${accountId}` },
    { table: "remediation_steps", derivedOnly: false, predicate: sql`EXISTS (
      SELECT 1 FROM remediation_plans p WHERE p.id = remediation_steps.plan_id AND p.user_id = ${accountId})` },
    { table: "review_cases", derivedOnly: false, predicate: sql`user_id = ${accountId}` },
    { table: "review_annotations", derivedOnly: false, predicate: sql`EXISTS (
      SELECT 1 FROM review_cases c WHERE c.id = review_annotations.case_id AND c.user_id = ${accountId})` },
  ];
}

/** Read-only inventory of explicitly scoped rows, not an assertion that all
 * personal data or external/shared copies have been covered. No row contents,
 * credentials or document pointers leave this count-only preflight. */
export async function countCandidateOwnedRows(client: QueryClient, accountId: string) {
  const counts: Record<string, number> = {};
  for (const item of candidateOwnedSelections(accountId)) {
    const result = await client.execute(sql`SELECT count(*) AS n FROM ${sql.identifier(item.table)} WHERE ${item.predicate}`);
    const n = verifiedCount(result.rows[0]?.n);
    counts[item.table] = n;
  }
  return { counts, completeAccountCoverage: false as const };
}

/** Actual transactional adapter for the narrowly defined derived partition.
 * A caller must still complete pointer-bearing/shared/retained records and
 * final account erasure separately. Its result explicitly says so. */
export async function eraseCandidateDerivedRows(resource: CleanupResource, taskId: string) {
  requireDeletionRelease();
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`candidate-cleanup:${taskId}`}))`);
    await tx.execute(sql`SET LOCAL statement_timeout = '10000ms'`);
    const scope = await requireClaimedCleanup(resource, taskId, "active_data", tx);
    if (scope.role !== "candidate") throw new DeletionBlocked("candidate_role_required");
    // Do not choose an erasure policy for an unresolved court/regulatory hold.
    const held = await tx.execute(sql`SELECT id FROM legal_retention_records
      WHERE request_id = ${scope.requestId} AND category = 'legal_hold'
        AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`);
    if (held.rows.length) throw new DeletionBlocked("legal_hold_review_required");
    const changed: Record<string, number> = {};
    for (const item of candidateOwnedSelections(resource.accountId).filter(item => item.derivedOnly)) {
      const count = await tx.execute(sql`SELECT count(*) AS n FROM ${sql.identifier(item.table)} WHERE ${item.predicate}`);
      const n = verifiedCount(count.rows[0]?.n);
      if (n > 10_000) throw new DeletionBlocked("candidate_cleanup_requires_batching");
      await tx.execute(sql`DELETE FROM ${sql.identifier(item.table)} WHERE ${item.predicate}`);
      changed[item.table] = n;
    }
    return { changed, completeAccountErasure: false as const };
  });
}
