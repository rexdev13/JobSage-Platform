ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "target_regions" jsonb DEFAULT '[]'::jsonb;

ALTER TABLE "sponsor_licence_vacancies"
  ADD COLUMN IF NOT EXISTS "target_regions" jsonb DEFAULT '[]'::jsonb;