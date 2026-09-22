ALTER TABLE "marketer_events"
  ADD COLUMN IF NOT EXISTS "google_synced_at" timestamp with time zone;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_booking_slug" varchar,
  ADD COLUMN IF NOT EXISTS "google_booking_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "google_booking_timezone" varchar NOT NULL DEFAULT 'Europe/London';

CREATE UNIQUE INDEX IF NOT EXISTS "users_google_booking_slug_idx"
  ON "users" ("google_booking_slug");