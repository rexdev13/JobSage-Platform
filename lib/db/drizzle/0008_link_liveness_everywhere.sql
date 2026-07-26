-- Task: verify all job-application links everywhere.
-- Adds liveness tracking to roles and job_listings (mirroring the
-- sponsor_licence_vacancies pattern) plus supporting indexes.
-- Applied to the live dev database on 2026-07-26; kept here so any other
-- environment can be brought in sync.

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS liveness varchar NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS liveness_reason text;

ALTER TABLE job_listings
  ADD COLUMN IF NOT EXISTS liveness varchar NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS liveness_reason text;

-- Sweep selection + per-URL verdict propagation over ~100k snapshot rows.
CREATE INDEX IF NOT EXISTS idx_slv_url ON sponsor_licence_vacancies (url);
CREATE INDEX IF NOT EXISTS idx_slv_liveness_verified ON sponsor_licence_vacancies (liveness, last_verified_at);
