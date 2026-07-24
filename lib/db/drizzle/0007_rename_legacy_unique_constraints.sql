-- Drift repair follow-up (applied to the live dev database on 2026-07-24).
-- drizzle-kit matches unique constraints by name (<table>_<col>_unique);
-- legacy Postgres-default "_key" constraints read as missing drift.
-- Drop the duplicate on users (the _unique version already exists) and
-- rename the profiles constraint to the drizzle name.
-- Idempotent: safe to re-run in any environment.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_jobsage_email_key')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_jobsage_email_unique') THEN
    ALTER TABLE users DROP CONSTRAINT users_jobsage_email_key;
  ELSIF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_jobsage_email_key') THEN
    ALTER TABLE users RENAME CONSTRAINT users_jobsage_email_key TO users_jobsage_email_unique;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_jobsage_email_key')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_jobsage_email_unique') THEN
    ALTER TABLE profiles RENAME CONSTRAINT profiles_jobsage_email_key TO profiles_jobsage_email_unique;
  END IF;
END $$;
