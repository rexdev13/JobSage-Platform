CREATE TABLE IF NOT EXISTS "sponsor_licence_company_site_checks" (
  "id" serial PRIMARY KEY,
  "organisation_name" text NOT NULL,
  "generic_checked_at" timestamp with time zone,
  "ats_checked_at" timestamp with time zone,
  "careers_url" text,
  "ats_provider" text,
  "retry_after" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_site_checks_org_unique"
  ON "sponsor_licence_company_site_checks" ("organisation_name");
CREATE INDEX IF NOT EXISTS "company_site_checks_generic_idx"
  ON "sponsor_licence_company_site_checks" ("generic_checked_at");
CREATE INDEX IF NOT EXISTS "company_site_checks_ats_idx"
  ON "sponsor_licence_company_site_checks" ("ats_checked_at");
CREATE INDEX IF NOT EXISTS "company_site_checks_retry_idx"
  ON "sponsor_licence_company_site_checks" ("retry_after");

CREATE TABLE IF NOT EXISTS "company_site_host_states" (
  "id" serial PRIMARY KEY,
  "hostname" text NOT NULL,
  "robots_body" text,
  "robots_checked_at" timestamp with time zone,
  "last_request_at" timestamp with time zone,
  "request_lease_until" timestamp with time zone,
  "failure_count" integer NOT NULL DEFAULT 0,
  "retry_after" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_site_host_states_hostname_unique"
  ON "company_site_host_states" ("hostname");
CREATE INDEX IF NOT EXISTS "company_site_host_states_retry_idx"
  ON "company_site_host_states" ("retry_after");