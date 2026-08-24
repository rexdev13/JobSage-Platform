-- Coordinate NHS Jobs outage probes and cooldowns across API workers.

CREATE TABLE IF NOT EXISTS "nhs_vacancy_outage_backoffs" (
  "id" serial PRIMARY KEY NOT NULL,
  "organisation_key" text NOT NULL,
  "probe_token" varchar,
  "probe_lease_until" timestamp with time zone,
  "retry_after" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nhs_vacancy_outage_backoffs_org_key_idx"
  ON "nhs_vacancy_outage_backoffs" ("organisation_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nhs_vacancy_outage_backoffs_retry_after_idx"
  ON "nhs_vacancy_outage_backoffs" ("retry_after");