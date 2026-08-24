ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "dbs_clearance_level" varchar(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "safeguarding_training_level" varchar(16) NOT NULL DEFAULT 'unknown';

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "required_dbs_clearance_level" varchar(16),
  ADD COLUMN IF NOT EXISTS "required_safeguarding_level" varchar(16);

ALTER TABLE "job_listings"
  ADD COLUMN IF NOT EXISTS "required_dbs_clearance_level" varchar(16),
  ADD COLUMN IF NOT EXISTS "required_safeguarding_level" varchar(16);

ALTER TABLE "sponsor_licence_vacancies"
  ADD COLUMN IF NOT EXISTS "required_dbs_clearance_level" varchar(16),
  ADD COLUMN IF NOT EXISTS "required_safeguarding_level" varchar(16);