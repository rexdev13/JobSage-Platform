-- Persist the daily OpenAI web-search allowance by London calendar date.

CREATE TABLE IF NOT EXISTS "vacancy_ai_usage" (
  "id" serial PRIMARY KEY NOT NULL,
  "london_date" date NOT NULL,
  "used_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vacancy_ai_usage_london_date_idx"
  ON "vacancy_ai_usage" ("london_date");