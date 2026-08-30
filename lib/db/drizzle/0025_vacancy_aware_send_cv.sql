ALTER TABLE "speculative_applications"
  ADD COLUMN IF NOT EXISTS "vacancy_ref" text,
  ADD COLUMN IF NOT EXISTS "role_id" integer,
  ADD COLUMN IF NOT EXISTS "vacancy_url" text,
  ADD COLUMN IF NOT EXISTS "source_type" varchar,
  ADD COLUMN IF NOT EXISTS "board_name" text,
  ADD COLUMN IF NOT EXISTS "delivery_status" varchar NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "delivery_error" text,
  ADD COLUMN IF NOT EXISTS "delivery_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_delivery_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "attachment_type" varchar;

UPDATE "speculative_applications"
SET
  "delivery_status" = CASE WHEN "email_sent" THEN 'delivered' ELSE 'failed' END,
  "delivery_attempts" = CASE WHEN "email_sent_at" IS NOT NULL OR "email_recipient" IS NOT NULL THEN 1 ELSE 0 END,
  "last_delivery_attempt_at" = COALESCE("email_sent_at", "created_at"),
  "attachment_type" = CASE WHEN "cv_document_id" IS NOT NULL AND "email_sent" THEN 'pdf' ELSE NULL END
WHERE "delivery_attempts" = 0;

ALTER TABLE "speculative_applications"
  DROP CONSTRAINT IF EXISTS "speculative_applications_delivery_status_check",
  DROP CONSTRAINT IF EXISTS "speculative_applications_source_type_check",
  DROP CONSTRAINT IF EXISTS "speculative_applications_attachment_type_check";

ALTER TABLE "speculative_applications"
  ADD CONSTRAINT "speculative_applications_delivery_status_check"
    CHECK ("delivery_status" IN ('pending', 'delivered', 'failed')),
  ADD CONSTRAINT "speculative_applications_source_type_check"
    CHECK ("source_type" IS NULL OR "source_type" IN ('job_board', 'company_site')),
  ADD CONSTRAINT "speculative_applications_attachment_type_check"
    CHECK ("attachment_type" IS NULL OR "attachment_type" = 'pdf');

CREATE INDEX IF NOT EXISTS "speculative_apps_user_vacancy_idx"
  ON "speculative_applications" ("user_id", "vacancy_ref");

CREATE TABLE IF NOT EXISTS "speculative_application_delivery_attempts" (
  "id" serial PRIMARY KEY,
  "speculative_application_id" integer NOT NULL,
  "user_id" varchar NOT NULL,
  "outcome" varchar NOT NULL DEFAULT 'pending'
    CHECK ("outcome" IN ('pending', 'delivered', 'failed')),
  "attempted_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "error" text
);

CREATE INDEX IF NOT EXISTS "speculative_delivery_attempts_user_time_idx"
  ON "speculative_application_delivery_attempts" ("user_id", "attempted_at");

CREATE INDEX IF NOT EXISTS "speculative_delivery_attempts_application_idx"
  ON "speculative_application_delivery_attempts" ("speculative_application_id");