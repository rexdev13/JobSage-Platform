ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS ai_cv_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_cv_source_document_id integer;