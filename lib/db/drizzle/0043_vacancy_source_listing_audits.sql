CREATE TABLE vacancy_source_listing_audits (
  id serial PRIMARY KEY,
  source_id text NOT NULL,
  provider text NOT NULL,
  board_name text NOT NULL,
  external_id text NOT NULL,
  employer_name text NOT NULL,
  title text NOT NULL,
  listing_url text NOT NULL,
  match_reason text NOT NULL,
  parser_version text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vacancy_source_listing_audits_source_external_uidx
  ON vacancy_source_listing_audits (source_id, external_id);
CREATE INDEX vacancy_source_listing_audits_source_seen_idx
  ON vacancy_source_listing_audits (source_id, last_seen_at);
CREATE INDEX vacancy_source_listing_audits_employer_idx
  ON vacancy_source_listing_audits (employer_name);
