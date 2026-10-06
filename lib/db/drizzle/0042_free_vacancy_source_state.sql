ALTER TABLE sponsor_licence_vacancies
  ADD COLUMN source_metadata jsonb;

CREATE TABLE vacancy_source_states (
  source_id text PRIMARY KEY,
  provider text NOT NULL,
  source_type text NOT NULL,
  board_name text NOT NULL,
  parser_version text NOT NULL,
  cursor text,
  sweep_started_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_exhausted_at timestamptz,
  last_outcome text,
  last_error text,
  reported_total integer,
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vacancy_source_observations (
  id serial PRIMARY KEY,
  vacancy_id integer NOT NULL REFERENCES sponsor_licence_vacancies(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  provider text NOT NULL,
  source_type text NOT NULL,
  board_name text NOT NULL,
  external_id text NOT NULL,
  url text NOT NULL,
  canonical_url text NOT NULL,
  application_url text,
  source_metadata jsonb,
  parser_version text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  missing_since timestamptz
);

CREATE UNIQUE INDEX vacancy_source_observations_source_external_uidx
  ON vacancy_source_observations (source_id, external_id);
CREATE INDEX vacancy_source_observations_url_idx
  ON vacancy_source_observations (canonical_url);
CREATE INDEX vacancy_source_observations_vacancy_idx
  ON vacancy_source_observations (vacancy_id);
CREATE INDEX vacancy_source_observations_source_seen_idx
  ON vacancy_source_observations (source_id, last_seen_at);

-- Give existing board rows stable provenance before the new feeds begin
-- recording per-source sightings. Company-site legacy rows receive a unique
-- key unless they contain an exact known-ATS mapping identity.
INSERT INTO vacancy_source_observations (
  vacancy_id, source_id, provider, source_type, board_name, external_id,
  url, canonical_url, application_url, source_metadata, parser_version,
  first_seen_at, last_seen_at, missing_since
)
SELECT
  v.id,
  CASE
    WHEN v.source_type = 'job_board'
      THEN 'job_board:' || lower(btrim(coalesce(nullif(v.board_name, ''), 'legacy')))
    WHEN v.source_type = 'company_site'
      AND v.company_vacancy_evidence->>'kind' = 'known_ats_posting'
      AND nullif(btrim(v.company_vacancy_evidence->>'provider'), '') IS NOT NULL
      AND nullif(btrim(v.company_vacancy_evidence->>'listingUrl'), '') IS NOT NULL
      THEN 'company_site:ats:' ||
        btrim(regexp_replace(lower(btrim(v.organisation_name)), '[^a-z0-9]+', ' ', 'g')) || ':' ||
        lower(btrim(v.company_vacancy_evidence->>'provider')) || ':' ||
        lower(regexp_replace(btrim(v.company_vacancy_evidence->>'listingUrl'), '/+$', ''))
    WHEN v.source_type = 'company_site'
      THEN 'company_site:' ||
        btrim(regexp_replace(lower(btrim(v.organisation_name)), '[^a-z0-9]+', ' ', 'g')) || ':' ||
        lower(coalesce(
          substring(coalesce(v.company_vacancy_evidence->>'listingUrl', v.url) from '^https?://([^/]+)'),
          'unknown'
        ))
    ELSE 'company_site:legacy:' || v.id::text
  END,
  CASE
    WHEN v.source_type = 'company_site'
      THEN coalesce(nullif(v.company_vacancy_evidence->>'provider', ''), 'legacy_company_site')
    ELSE coalesce(nullif(v.board_name, ''), 'legacy_board')
  END,
  v.source_type,
  coalesce(nullif(v.board_name, ''), 'Company Website'),
  coalesce(nullif(v.external_listing_id, ''), 'legacy:' || v.id::text),
  v.url,
  v.url,
  v.application_url,
  v.source_metadata,
  'legacy-backfill',
  coalesce(v.created_at, now()),
  coalesce(v.last_discovered_at, v.created_at, now()),
  v.source_missing_since
FROM sponsor_licence_vacancies v
WHERE v.source_type IS NOT NULL
  AND v.url IS NOT NULL
ON CONFLICT (source_id, external_id) DO NOTHING;
