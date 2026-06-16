import { pgTable, serial, text, varchar, timestamp, unique } from "drizzle-orm/pg-core";

export const BADGE_DEFINITIONS = {
  profile_complete: { name: "Profile Champion", description: "Completed your full professional profile", iconName: "UserCheck" },
  documents_ready: { name: "Document Master", description: "Uploaded 2 or more verification documents", iconName: "Files" },
  eligibility_checked: { name: "Compliance Ready", description: "Ran your first eligibility assessment", iconName: "ShieldCheck" },
  first_application: { name: "First Step", description: "Submitted your first job application", iconName: "Send" },
  shortlisted: { name: "Standing Out", description: "Shortlisted by a UK employer", iconName: "Star" },
  interview_ready: { name: "Interview Ace", description: "Reached the interview stage", iconName: "MessageSquare" },
  offer_received: { name: "Offer Winner", description: "Received a job offer", iconName: "Trophy" },
} as const;

export type BadgeKey = keyof typeof BADGE_DEFINITIONS;

export const candidateBadgesTable = pgTable("candidate_badges", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  badgeKey: varchar("badge_key", { length: 50 }).notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("candidate_badges_user_badge_unique").on(t.userId, t.badgeKey)]);

export type CandidateBadge = typeof candidateBadgesTable.$inferSelect;
