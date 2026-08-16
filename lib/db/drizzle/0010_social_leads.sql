-- Social leads table: captures waitlist sign-ups from /get-started
-- Includes both AI-chat partial leads (source='chat') and full form submissions (source='form').
-- This migration is idempotent — safe to run on a DB that already has the table.

CREATE TABLE IF NOT EXISTS "social_leads" (
  "id"                serial PRIMARY KEY NOT NULL,
  "first_name"        text NOT NULL,
  "last_name"         text NOT NULL,
  "email"             text NOT NULL,
  "phone"             text NOT NULL,
  "industry_sector"   text,
  "desired_role"      text,
  "additional_message" text,
  "utm_source"        text,
  "utm_medium"        text,
  "utm_campaign"      text,
  "utm_content"       text,
  "landing_path"      text,
  "referrer_url"      text,
  "ip_hash"           text,
  "gdpr_consent"      boolean NOT NULL,
  "gdpr_consented_at" timestamp with time zone NOT NULL,
  "status"            varchar NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','registered','unqualified')),
  "source"            varchar NOT NULL DEFAULT 'form' CHECK (source IN ('chat','form')),
  "converted_user_id" varchar,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Add source column on existing DBs that were created before this migration
ALTER TABLE "social_leads" ADD COLUMN IF NOT EXISTS "source" varchar NOT NULL DEFAULT 'form' CHECK (source IN ('chat','form'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_leads_email_idx"      ON "social_leads" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_leads_status_idx"     ON "social_leads" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_leads_utm_source_idx" ON "social_leads" ("utm_source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_leads_created_at_idx" ON "social_leads" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_leads_source_idx"     ON "social_leads" ("source");
