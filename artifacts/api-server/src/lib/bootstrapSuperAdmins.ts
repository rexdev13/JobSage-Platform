/**
 * One-time bootstrap: promote specific accounts to super_admin on server
 * startup if they are not already.  Safe to run on every start — idempotent.
 */
import { db, usersTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import { writeAuditEvent } from "./audit";

/**
 * Hard-coded bootstrap list.  Add emails here only when there is no existing
 * super_admin who can promote via the UI.  Remove entries after the first
 * successful deploy so the list does not grow indefinitely.
 */
const BOOTSTRAP_SUPER_ADMIN_EMAILS: string[] = [
  "exco@gammaqualitymark.com",
  "corporate@gammaqualitymark.com",
];

export async function bootstrapSuperAdmins(): Promise<void> {
  if (BOOTSTRAP_SUPER_ADMIN_EMAILS.length === 0) return;

  const rows = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.email, BOOTSTRAP_SUPER_ADMIN_EMAILS));

  const toPromote = rows.filter((r) => r.role !== "super_admin");

  if (toPromote.length === 0) {
    console.log("[bootstrap-super-admin] All bootstrap accounts already super_admin — skipping.");
    return;
  }

  for (const user of toPromote) {
    await db
      .update(usersTable)
      .set({ role: "super_admin" })
      .where(eq(usersTable.id, user.id));

    writeAuditEvent(
      "system:bootstrap",
      "bootstrap_super_admin",
      user.id,
      { email: user.email, fromRole: user.role },
    ).catch(() => {});

    console.log(`[bootstrap-super-admin] Promoted ${user.email} → super_admin`);
  }

  const missing = BOOTSTRAP_SUPER_ADMIN_EMAILS.filter(
    (e) => !rows.some((r) => r.email === e),
  );
  if (missing.length) {
    console.warn(
      `[bootstrap-super-admin] Warning: the following bootstrap emails were not found in the DB: ${missing.join(", ")}`,
    );
  }
}
