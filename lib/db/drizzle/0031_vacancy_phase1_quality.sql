ALTER TABLE vacancy_sync_log ADD COLUMN IF NOT EXISTS job_kind text;
ALTER TABLE vacancy_sync_log ADD COLUMN IF NOT EXISTS metrics jsonb;
ALTER TABLE sponsor_licence_company_site_checks
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_partial_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outcome text,
  ADD COLUMN IF NOT EXISTS last_pages_fetched integer,
  ADD COLUMN IF NOT EXISTS last_adverts_found integer,
  ADD COLUMN IF NOT EXISTS last_rejected_count integer;
ALTER TABLE sponsor_licence_vacancies
  ADD COLUMN IF NOT EXISTS closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text,
  ADD COLUMN IF NOT EXISTS company_vacancy_evidence jsonb,
  ADD COLUMN IF NOT EXISTS company_evidence_legacy_until timestamptz,
  ADD COLUMN IF NOT EXISTS source_missing_since timestamptz,
  ADD COLUMN IF NOT EXISTS source_missing_observations integer NOT NULL DEFAULT 0;

-- Safe deploy-time backfill: retain rows, but annotate already-expired records.
-- Candidate visibility derives expiry from closes_at/expires_at even when the
-- URL remains HTTP 200. The affected-row count is available from migration
-- execution logs without deleting historical application records.
UPDATE sponsor_licence_vacancies
SET liveness_reason = COALESCE(liveness_reason, 'expired closing date')
WHERE (closes_at IS NOT NULL AND closes_at < NOW())
   OR (expires_at IS NOT NULL AND expires_at < NOW());
DO $$
DECLARE hidden_count integer;
BEGIN
  SELECT count(*) INTO hidden_count
  FROM sponsor_licence_vacancies
  WHERE (closes_at IS NOT NULL AND closes_at < NOW())
     OR (expires_at IS NOT NULL AND expires_at < NOW());
  RAISE NOTICE 'vacancy phase1 expiry cleanup annotated % rows (no rows deleted)', hidden_count;
END $$;

-- Legacy rows receive a bounded 30-day re-verification window. New ingestion
-- never sets this field; it must provide positive evidence. This preserves
-- legitimate historical rows during rollout without waiving the rule forever.
UPDATE sponsor_licence_vacancies
SET company_evidence_legacy_until = NOW() + interval '30 days'
WHERE source_type = 'company_site'
  AND company_vacancy_evidence IS NULL
  AND company_evidence_legacy_until IS NULL;