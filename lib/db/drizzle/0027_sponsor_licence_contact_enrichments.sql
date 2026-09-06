CREATE TABLE IF NOT EXISTS "sponsor_licence_contact_enrichments" (
  "id" serial PRIMARY KEY,
  "organisation_name" text NOT NULL,
  "stage" varchar NOT NULL DEFAULT 'website',
  "status" varchar NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "retry_after" timestamp with time zone,
  "website_url" text,
  "website_lookup_source" varchar,
  "website_lookup_at" timestamp with time zone,
  "website_cited_at" timestamp with time zone,
  "website_verified_at" timestamp with time zone,
  "website_evidence_url" text,
  "contact_email" text,
  "contact_source" varchar,
  "contact_evidence_url" text,
  "contact_extracted_at" timestamp with time zone,
  "stored_harvested_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);
ALTER TABLE "sponsor_licence_contact_enrichments"
  ADD COLUMN IF NOT EXISTS "website_lookup_source" varchar,
  ADD COLUMN IF NOT EXISTS "website_lookup_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "website_cited_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "website_verified_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "contact_source" varchar,
  ADD COLUMN IF NOT EXISTS "contact_extracted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "stored_harvested_at" timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS "contact_enrichments_org_unique"
  ON "sponsor_licence_contact_enrichments" ("organisation_name");
CREATE INDEX IF NOT EXISTS "contact_enrichments_due_idx"
  ON "sponsor_licence_contact_enrichments" ("status", "retry_after");
CREATE TABLE IF NOT EXISTS "contact_web_search_usage" (
  "id" serial PRIMARY KEY,
  "utc_date" date NOT NULL,
  "organisation_name" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "contact_web_search_usage_org_day_unique"
  ON "contact_web_search_usage" ("utc_date", "organisation_name");
CREATE INDEX IF NOT EXISTS "contact_web_search_usage_day_idx"
  ON "contact_web_search_usage" ("utc_date");