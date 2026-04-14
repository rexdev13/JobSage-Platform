import { pgTable, serial, varchar, integer, jsonb, timestamp, unique } from "drizzle-orm/pg-core";

export const smartApplyDraftsTable = pgTable(
  "smart_apply_drafts",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    roleId: integer("role_id").notNull(),
    answers: jsonb("answers").notNull().$type<Record<string, string>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("smart_apply_drafts_user_role_unique").on(t.userId, t.roleId)],
);

export type SmartApplyDraft = typeof smartApplyDraftsTable.$inferSelect;
