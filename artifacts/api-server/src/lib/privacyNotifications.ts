import { db, privacyPreferencesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type NotificationCategory } from "@workspace/mobile-core";

/** Call immediately before dispatch, not only when planning a batch. Essential account/support notices
 * are separate; preference withdrawal must not remove access to support or security notifications. */
export async function mayNotifyAccount(userId: string, category: NotificationCategory | "marketing") {
  const [user] = await db.select({ suspendedAt: usersTable.suspendedAt }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.suspendedAt) return false;
  const [preference] = await db.select().from(privacyPreferencesTable).where(eq(privacyPreferencesTable.userId, userId));
  return category === "marketing" ? preference?.marketing === true : preference?.notifications[category] !== false;
}
