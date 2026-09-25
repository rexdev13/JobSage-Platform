CREATE TABLE "sponsor_licence_website_enrichment_audits" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "organisation_key" text NOT NULL,
  "organisation_name" text NOT NULL,
  "sample_group" text NOT NULL,
  "sector" text,
  "town_city" text,
  "existing_website_url" text,
  "existing_careers_url" text,
  "website_url" text,
  "website_confidence" varchar DEFAULT 'none' NOT NULL,
  "website_evidence_url" text,
  "careers_url" text,
  "careers_confidence" varchar DEFAULT 'none' NOT NULL,
  "careers_evidence_url" text,
  "ats_provider" text,
  "ats_board_id" text,
  "ats_mapping_status" varchar,
  "ats_mapping_evidence_url" text,
  "classifications" jsonb NOT NULL,
  "candidate_results" jsonb NOT NULL,
  "search_queries" jsonb NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sponsor_licence_website_audit_run_org_unique"
    UNIQUE ("run_id", "organisation_key")
);
--> statement-breakpoint
CREATE INDEX "sponsor_licence_website_audit_run_idx"
  ON "sponsor_licence_website_enrichment_audits" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "sponsor_licence_website_audit_group_idx"
  ON "sponsor_licence_website_enrichment_audits" USING btree ("sample_group");
--> statement-breakpoint
CREATE INDEX "sponsor_licence_website_audit_checked_idx"
  ON "sponsor_licence_website_enrichment_audits" USING btree ("checked_at");