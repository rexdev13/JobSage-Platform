-- Durable per-user deduplication for sponsor vacancy job alerts.
-- Vacancy snapshots are replaced during discovery, so URL is the stable
-- identity of an advert while the source row's serial ID is not.

CREATE TABLE IF NOT EXISTS "job_alert_vacancy_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL,
  "vacancy_id" integer,
  "vacancy_url" text NOT NULL,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_alert_vacancy_deliveries_user_url_idx"
  ON "job_alert_vacancy_deliveries" ("user_id", "vacancy_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_alert_vacancy_deliveries_sent_at_idx"
  ON "job_alert_vacancy_deliveries" ("sent_at");