-- Preserve the vacancy title for website applications created from JOBSAGE
-- outbound clicks and later upgraded by the Smart Apply extension.

ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "job_title" text;