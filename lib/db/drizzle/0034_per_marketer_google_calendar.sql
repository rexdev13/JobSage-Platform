ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_calendar_refresh_token" text,
  ADD COLUMN IF NOT EXISTS "google_calendar_account_email" varchar,
  ADD COLUMN IF NOT EXISTS "google_calendar_connected_at" timestamp with time zone;