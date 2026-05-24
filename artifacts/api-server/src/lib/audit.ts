import { db, auditEventsTable } from "@workspace/db";

export async function writeAuditEvent(
  actor: string,
  action: string,
  target?: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({ actor, action, target, details: details ?? {} });
  } catch (err) {
    console.error("[audit] event write failed:", err);
  }
}
