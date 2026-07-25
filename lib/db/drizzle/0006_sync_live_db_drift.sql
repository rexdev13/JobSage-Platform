-- Task: apply missing schema DDL to the live database (drift repair).
-- A full drizzle-vs-live diff found these columns/constraints/indexes missing.
-- This DDL was applied to the live dev database on 2026-07-24; kept here so any
-- other environment can be brought in sync. `drizzle-kit push` reports
-- "No changes detected" after applying.

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS apply_url text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_website text;

ALTER TABLE job_listings
  ADD COLUMN IF NOT EXISTS apply_url text;

ALTER TABLE sponsor_licence_vacancies
  ADD COLUMN IF NOT EXISTS liveness varchar NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS liveness_reason text;

CREATE INDEX IF NOT EXISTS sponsor_licence_vacancies_liveness_idx
  ON sponsor_licence_vacancies (liveness, last_verified_at);

ALTER TABLE speculative_applications
  ADD COLUMN IF NOT EXISTS delivery_route varchar;

ALTER TABLE candidate_messages
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS sender_email text,
  ADD COLUMN IF NOT EXISTS external_message_id text;

-- Unique constraints drizzle-kit push prompts for interactively
-- (duplicate checks returned zero rows before adding each).
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_jobsage_email_unique UNIQUE (jobsage_email);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE candidate_messages ADD CONSTRAINT candidate_messages_external_message_id_unique UNIQUE (external_message_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_jobsage_email_unique UNIQUE (jobsage_email);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- Type change push hard-fails on (needs USING cast): single region -> array.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'preferred_region' AND data_type = 'text'
  ) THEN
    ALTER TABLE profiles
      ALTER COLUMN preferred_region TYPE text[]
      USING CASE WHEN preferred_region IS NULL OR preferred_region = '' THEN NULL ELSE ARRAY[preferred_region] END;
  END IF;
END $$;
