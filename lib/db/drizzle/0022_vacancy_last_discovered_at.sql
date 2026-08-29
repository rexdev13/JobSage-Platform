ALTER TABLE "sponsor_licence_vacancies"
  ADD COLUMN IF NOT EXISTS "last_discovered_at" timestamp with time zone;

UPDATE "sponsor_licence_vacancies"
SET "last_discovered_at" = "created_at"
WHERE "last_discovered_at" IS NULL;

ALTER TABLE "sponsor_licence_vacancies"
  ALTER COLUMN "last_discovered_at" SET DEFAULT now(),
  ALTER COLUMN "last_discovered_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "sponsor_licence_vacancies_discovered_idx"
  ON "sponsor_licence_vacancies" ("last_discovered_at");