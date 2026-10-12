import { index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/** Independent of users: erasing an account must not erase its deletion tombstone. */
export const accountDeletionRequestsTable = pgTable("account_deletion_requests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  accountHash: varchar("account_hash", { length: 64 }).notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: varchar("outcome", { enum: ["pending", "blocked", "completed"] }).notNull().default("pending"),
}, t => [uniqueIndex("account_deletion_account_hash_unique").on(t.accountHash)]);

/** Temporary operational metadata only; ciphertext must be removed at completion. */
export const accountDeletionTasksTable = pgTable("account_deletion_tasks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  requestId: varchar("request_id", { length: 36 }).notNull()
    .references(() => accountDeletionRequestsTable.id, { onDelete: "restrict" }),
  kind: varchar("kind").notNull(),
  state: varchar("state", { enum: ["pending", "running", "blocked", "complete"] }).notNull().default("pending"),
  resourceCiphertext: text("resource_ciphertext"),
  attempts: integer("attempts").notNull().default(0),
  retryAt: timestamp("retry_at", { withTimezone: true }).notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  failureCode: varchar("failure_code", { length: 80 }),
}, t => [index("account_deletion_tasks_claim_idx").on(t.state, t.retryAt)]);

/** Access only through the retention service, never ordinary candidate/marketing selectors. */
export const legalRetentionRecordsTable = pgTable("legal_retention_records", {
  id: varchar("id", { length: 36 }).primaryKey(),
  requestId: varchar("request_id", { length: 36 }).notNull()
    .references(() => accountDeletionRequestsTable.id, { onDelete: "restrict" }),
  category: varchar("category", { enum: ["financial", "security", "complaint", "legal_hold"] }).notNull(),
  lawfulReason: text("lawful_reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  holdReference: text("hold_reference"),
  recordCiphertext: text("record_ciphertext").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("legal_retention_expiry_idx").on(t.expiresAt)]);

/** Outbox must be acknowledged by an independent restore registry before completion. */
export const deletionTombstoneOutboxTable = pgTable("deletion_tombstone_outbox", {
  requestId: varchar("request_id", { length: 36 }).primaryKey()
    .references(() => accountDeletionRequestsTable.id, { onDelete: "restrict" }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});
