import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";


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
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),

    // ── Qualifying questions (generic — all sectors) ─────────────────────
    /** Industry or sector the candidate works in / is interested in */
    industrySector: text("industry_sector"),
    /** The specific role or job title the candidate is targeting */
    desiredRole: text("desired_role"),
    /** Free-text message — anything additional the candidate wants to share */
    additionalMessage: text("additional_message"),

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
    /** 'chat' = captured mid-conversation before form submit; 'form' = full form submission */
    source: varchar("source", { enum: ["chat", "form"] }).notNull().default("form"),
    /** Set when the lead completes /register — closes the attribution loop */
    convertedUserId: varchar("converted_user_id"),
    /** Nullable CRM owner. Only users with role='marketing' may be assigned by the API. */
    marketingUserId: varchar("marketing_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    waitlistConfirmationSentAt: timestamp("waitlist_confirmation_sent_at", { withTimezone: true }),
    waitlistConfirmationProviderId: text("waitlist_confirmation_provider_id"),
    waitlistConfirmationLastError: text("waitlist_confirmation_last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_leads_email_idx").on(t.email),
    index("social_leads_status_idx").on(t.status),
    index("social_leads_utm_source_idx").on(t.utmSource),
    index("social_leads_created_at_idx").on(t.createdAt),
    index("social_leads_marketing_user_idx").on(t.marketingUserId),
  ],
);

export type SocialLead = typeof socialLeadsTable.$inferSelect;
export type InsertSocialLead = typeof socialLeadsTable.$inferInsert;
