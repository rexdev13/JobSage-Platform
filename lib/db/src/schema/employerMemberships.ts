import {
  pgTable, serial, integer, varchar, text, timestamp, uniqueIndex, index, check, foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { employerProfilesTable, jobListingsTable } from "./employer";
import { usersTable } from "./auth";
import { applicationsTable } from "./applications";

export const employerStaffRoles = [
  "employer_owner",
  "employer_admin",
  "recruiter",
  "hiring_manager",
  "employer_viewer",
] as const;
export const employerInvitationRoles = [
  "employer_admin",
  "recruiter",
  "hiring_manager",
  "employer_viewer",
] as const;

export const employerMembershipsTable = pgTable("employer_memberships", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull()
    .references(() => employerProfilesTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: varchar("role", { enum: employerStaffRoles }).notNull(),
  status: varchar("status", { enum: ["active", "suspended", "removed"] }).notNull().default("active"),
  invitedByUserId: varchar("invited_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("employer_memberships_profile_user_unique").on(table.employerProfileId, table.userId),
  index("employer_memberships_user_status_idx").on(table.userId, table.status),
  index("employer_memberships_profile_status_idx").on(table.employerProfileId, table.status),
  check("employer_memberships_role_check", sql`${table.role} IN ('employer_owner','employer_admin','recruiter','hiring_manager','employer_viewer')`),
]);

export const employerInvitationsTable = pgTable("employer_invitations", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull()
    .references(() => employerProfilesTable.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 254 }).notNull(),
  role: varchar("role", { enum: employerInvitationRoles }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  invitedByUserId: varchar("invited_by_user_id").notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("employer_invitations_profile_created_idx").on(table.employerProfileId, table.createdAt),
  index("employer_invitations_email_idx").on(table.email),
]);

export const employerJobAssignmentsTable = pgTable("employer_job_assignments", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull()
    .references(() => employerProfilesTable.id, { onDelete: "cascade" }),
  jobListingId: integer("job_listing_id").notNull(),
  userId: varchar("user_id").notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  assignedByUserId: varchar("assigned_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("employer_job_assignments_job_user_unique").on(table.jobListingId, table.userId),
  index("employer_job_assignments_org_user_idx").on(table.employerProfileId, table.userId),
  foreignKey({
    name: "employer_job_assignments_job_org_fk",
    columns: [table.jobListingId, table.employerProfileId],
    foreignColumns: [jobListingsTable.id, jobListingsTable.employerProfileId],
  }).onDelete("cascade"),
]);

export const employerCandidateFeedbackTable = pgTable("employer_candidate_feedback", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull()
    .references(() => employerProfilesTable.id, { onDelete: "cascade" }),
  jobListingId: integer("job_listing_id").notNull(),
  applicationId: integer("application_id").notNull()
    .references(() => applicationsTable.id, { onDelete: "cascade" }),
  authorUserId: varchar("author_user_id").notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  feedback: text("feedback").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("employer_candidate_feedback_application_author_unique").on(table.applicationId, table.authorUserId),
  index("employer_candidate_feedback_org_job_idx").on(table.employerProfileId, table.jobListingId),
  foreignKey({
    name: "employer_candidate_feedback_job_org_fk",
    columns: [table.jobListingId, table.employerProfileId],
    foreignColumns: [jobListingsTable.id, jobListingsTable.employerProfileId],
  }).onDelete("cascade"),
]);

export const employerInterviewParticipantsTable = pgTable("employer_interview_participants", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull()
    .references(() => employerProfilesTable.id, { onDelete: "cascade" }),
  jobListingId: integer("job_listing_id").notNull(),
  applicationId: integer("application_id").notNull()
    .references(() => applicationsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  invitedByUserId: varchar("invited_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: varchar("status", { enum: ["invited", "accepted", "declined", "removed"] }).notNull().default("invited"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  uniqueIndex("employer_interview_participants_application_user_unique").on(table.applicationId, table.userId),
  index("employer_interview_participants_org_job_idx").on(table.employerProfileId, table.jobListingId),
  foreignKey({
    name: "employer_interview_participants_job_org_fk",
    columns: [table.jobListingId, table.employerProfileId],
    foreignColumns: [jobListingsTable.id, jobListingsTable.employerProfileId],
  }).onDelete("cascade"),
]);

export type EmployerMembership = typeof employerMembershipsTable.$inferSelect;
export type EmployerInvitation = typeof employerInvitationsTable.$inferSelect;
export type EmployerJobAssignment = typeof employerJobAssignmentsTable.$inferSelect;
export type EmployerCandidateFeedback = typeof employerCandidateFeedbackTable.$inferSelect;
export type EmployerInterviewParticipant = typeof employerInterviewParticipantsTable.$inferSelect;
