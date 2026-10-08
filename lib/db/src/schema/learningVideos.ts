import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const LEARNING_VIDEO_CATEGORIES = [
  "application",
  "sponsorship",
  "medical",
  "professional_registration",
  "relocation",
  "jobsage",
] as const;

export const LEARNING_VIDEO_STATUSES = ["draft", "published", "archived"] as const;

export const learningVideosTable = pgTable(
  "learning_videos",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 40, enum: LEARNING_VIDEO_CATEGORIES }).notNull(),
    videoEmbedUrl: text("video_embed_url"),
    storageKey: text("storage_key"),
    durationSeconds: integer("duration_seconds"),
    language: varchar("language", { length: 24 }).notNull().default("en"),
    applicability: text("applicability"),
    sourceLabel: varchar("source_label", { length: 160 }).notNull(),
    sourceUrl: text("source_url"),
    transcript: text("transcript"),
    reviewedBy: varchar("reviewed_by", { length: 160 }).notNull(),
    reviewedAt: date("reviewed_at", { mode: "string" }).notNull(),
    reviewDueAt: date("review_due_at", { mode: "string" }).notNull(),
    status: varchar("status", { length: 16, enum: LEARNING_VIDEO_STATUSES })
      .notNull()
      .default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: varchar("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    updatedBy: varchar("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "learning_videos_exactly_one_media_source",
      sql`(${table.videoEmbedUrl} IS NOT NULL AND ${table.storageKey} IS NULL) OR (${table.videoEmbedUrl} IS NULL AND ${table.storageKey} IS NOT NULL)`,
    ),
    check(
      "learning_videos_review_due_after_reviewed",
      sql`${table.reviewDueAt} >= ${table.reviewedAt}`,
    ),
    check(
      "learning_videos_category_valid",
      sql`${table.category} IN ('application', 'sponsorship', 'medical', 'professional_registration', 'relocation', 'jobsage')`,
    ),
    check(
      "learning_videos_status_valid",
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
    index("learning_videos_status_review_due_idx").on(table.status, table.reviewDueAt),
    index("learning_videos_category_sort_order_idx").on(table.category, table.sortOrder),
  ],
);

export const insertLearningVideoSchema = createInsertSchema(learningVideosTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLearningVideo = z.infer<typeof insertLearningVideoSchema>;
export type LearningVideo = typeof learningVideosTable.$inferSelect;
