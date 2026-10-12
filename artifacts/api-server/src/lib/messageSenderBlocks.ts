import { db, messageSenderBlocksTable } from "@workspace/db";
import { and, eq, notExists, or, sql } from "drizzle-orm";
import { z } from "zod/v4";

export type MessageSender = { senderEmployerProfileId?: number | null; senderEmail?: string | null };
export function messageSenderKey(sender: MessageSender): string | null {
  if (Number.isSafeInteger(sender.senderEmployerProfileId) && sender.senderEmployerProfileId! > 0) {
    return `employer:${sender.senderEmployerProfileId}`;
  }
  const email = sender.senderEmail?.trim().toLowerCase();
  return email && email.length <= 254 && z.email().safeParse(email).success ? `email:${email}` : null;
}
/** Deliberately exact account/address identity, never a company-name or domain match. */
export async function isMessageSenderBlocked(userId: string, sender: MessageSender): Promise<boolean> {
  const key = messageSenderKey(sender);
  if (!key) return false;
  const [block] = await db.select({ id: messageSenderBlocksTable.id }).from(messageSenderBlocksTable)
    .where(and(eq(messageSenderBlocksTable.userId, userId), eq(messageSenderBlocksTable.senderKey, key))).limit(1);
  return !!block;
}
/** Explicit outer qualification prevents correlated-column binding to the inner table. */
export function visibleMessageSender(userId: string) {
  const unblocked = notExists(db.select({ id: messageSenderBlocksTable.id }).from(messageSenderBlocksTable).where(and(
    eq(messageSenderBlocksTable.userId, userId),
    or(
      eq(messageSenderBlocksTable.senderKey, sql`'employer:' || "candidate_messages"."sender_employer_profile_id"::text`),
      eq(messageSenderBlocksTable.senderKey, sql`'email:' || lower(trim("candidate_messages"."sender_email"))`),
    ),
  )));
  return sql`("candidate_messages"."message_type" = 'support' OR "candidate_messages"."support_ticket_id" IS NOT NULL OR ${unblocked})`;
}
