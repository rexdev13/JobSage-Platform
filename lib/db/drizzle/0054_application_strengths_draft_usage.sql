CREATE TABLE IF NOT EXISTS "application_strengths_draft_usage" (
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "usage_date" date NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "application_strengths_draft_usage_user_date_idx" UNIQUE ("user_id", "usage_date")
);
