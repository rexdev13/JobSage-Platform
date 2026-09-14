import { pgTable, serial, text, timestamp, varchar, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { socialLeadsTable } from "./socialLeads";

export const marketerEventsTable = pgTable(
  "marketer_events",
  {
    id: serial("id").primaryKey(),
    marketingUserId: varchar("marketing_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    leadId: integer("lead_id").references(() => socialLeadsTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    meetingUrl: text("meeting_url"),
    status: varchar("status", {
      enum: ["scheduled", "completed", "cancelled", "rescheduled", "no_show"],
    }).notNull().default("scheduled"),
    notes: text("notes"),
    source: varchar("source", { enum: ["manual", "calendly"] }).notNull().default("manual"),
    externalEventUri: text("external_event_uri"),
    externalInviteeUri: text("external_invitee_uri"),
    externalInviteeEmail: text("external_invitee_email"),
    calendlySyncedAt: timestamp("calendly_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("marketer_events_marketing_user_idx").on(table.marketingUserId),
    index("marketer_events_lead_idx").on(table.leadId),
    index("marketer_events_scheduled_at_idx").on(table.scheduledAt),
    uniqueIndex("marketer_events_external_event_uri_idx").on(table.externalEventUri),
  ],
);

export type MarketerEvent = typeof marketerEventsTable.$inferSelect;
export type InsertMarketerEvent = typeof marketerEventsTable.$inferInsert;