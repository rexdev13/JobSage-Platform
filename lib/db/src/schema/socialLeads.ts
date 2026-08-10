import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Social media lead capture — stores incoming leads from Facebook, Instagram,
 * LinkedIn and other paid/organic social campaigns before they register.
 *
 * UTM columns provide full attribution from ad → lead → converted user.
 * converted_user_id is back-filled when a lead completes /register.
 */
export const socialLeadsTable = pgTable(
  "social_leads",
  {
    id: serial("id").primaryKey(),

    // ── Contact ──────────────────────────────────────────────────────────
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    email: text("email").notNull(),
    phone: text("phone"),

    // ── Qualifying questions ─────────────────────────────────────────────
    /** Q1 — e.g. "Doctor / Physician", "Nurse", "Allied Health Professional" */
    profession: text("profession"),
    /** Q2 — country where the candidate trained/qualified */
    qualificationCountry: text("qualification_country"),
    /** Q3 — "registered" | "in_progress" | "not_started" | "unsure" */
    registrationStatus: text("registration_status"),
    /** Q4 — "yes" | "no" | "unsure" (text not boolean to capture the unsure state) */
    requiresSponsorship: text("requires_sponsorship"),
    /** Q5 — free-text specialty or clinical area */
    specialty: text("specialty"),
    /** Q6 — "asap" | "6m" | "12m" | "2yr" | "exploring" */
    timeline: text("timeline"),
    /** Q7 — multi-select challenges (stored as text array) */
    biggestChallenge: text("biggest_challenge").array(),

    // ── Attribution / UTM ────────────────────────────────────────────────
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    landingPath: text("landing_path"),
    referrerUrl: text("referrer_url"),

    // ── Privacy ──────────────────────────────────────────────────────────
    /** SHA-256 of remote IP — same dedup pattern used in consent_logs */
    ipHash: text("ip_hash"),

    // ── Consent ──────────────────────────────────────────────────────────
    gdprConsent: boolean("gdpr_consent").notNull(),
    gdprConsentedAt: timestamp("gdpr_consented_at", { withTimezone: true }).notNull(),

    // ── CRM state ────────────────────────────────────────────────────────
    status: varchar("status", {
      enum: ["new", "contacted", "registered", "unqualified"],
    })
      .notNull()
      .default("new"),
    /** Set when the lead completes /register — closes the attribution loop */
    convertedUserId: varchar("converted_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_leads_email_idx").on(t.email),
    index("social_leads_status_idx").on(t.status),
    index("social_leads_utm_source_idx").on(t.utmSource),
    index("social_leads_created_at_idx").on(t.createdAt),
  ],
);

export type SocialLead = typeof socialLeadsTable.$inferSelect;
export type InsertSocialLead = typeof socialLeadsTable.$inferInsert;
