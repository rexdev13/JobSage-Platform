ALTER TABLE "sponsor_licence_vacancies"
  ADD COLUMN IF NOT EXISTS "source_type" text,
  ADD COLUMN IF NOT EXISTS "board_name" text,
  ADD COLUMN IF NOT EXISTS "external_listing_id" text;

UPDATE "sponsor_licence_vacancies"
SET
  "source_type" = 'job_board',
  "board_name" = CASE
    WHEN lower("url") LIKE '%jobs.nhs.uk/%' THEN 'NHS Jobs'
    WHEN lower("url") LIKE '%trac.jobs/%' THEN 'Trac'
    WHEN lower("url") LIKE '%healthjobsuk.com/%' THEN 'HealthJobsUK'
    ELSE "board_name"
  END
WHERE "url" IS NOT NULL
  AND (
    lower("url") LIKE '%jobs.nhs.uk/%'
    OR lower("url") LIKE '%trac.jobs/%'
    OR lower("url") LIKE '%healthjobsuk.com/%'
  );

UPDATE "sponsor_licence_vacancies"
SET
  "source_type" = 'company_site',
  "board_name" = NULL,
  "external_listing_id" = NULL
WHERE "source_type" IS NULL
  AND "url" ~* '^https?://'
  AND "url" !~* '^https?://([^/]+\.)?(indeed\.com|reed\.co\.uk|linkedin\.com|lnkd\.in|cv-library\.co\.uk|totaljobs\.com|glassdoor\.(com|co\.uk)|monster\.(com|co\.uk)|jobsite\.co\.uk|fish4\.co\.uk|cwjobs\.co\.uk|adzuna\.(com|co\.uk)|simplyhired\.(com|co\.uk)|bebee\.com|jooble\.org|talent\.com|ziprecruiter\.(com|co\.uk)|careerjet\.co\.uk|jobijoba\.(com|co\.uk)|google\.com|bing\.com|yahoo\.com)(/|$)'
  AND lower(regexp_replace(split_part("url", '?', 1), '/+$', '')) !~ '/(careers?|jobs?|vacancies|search|apply|recruitment|work-for-us|work-with-us|join-us|all-jobs|open-positions|current-vacancies|job-vacancies)$'
  AND length(split_part("url", '?', 1)) - length(regexp_replace(split_part("url", '?', 1), '^https?://[^/]+', '')) >= 8;

ALTER TABLE "sponsor_licence_vacancies"
  DROP CONSTRAINT IF EXISTS "sponsor_licence_vacancies_source_type_check";

ALTER TABLE "sponsor_licence_vacancies"
  ADD CONSTRAINT "sponsor_licence_vacancies_source_type_check"
  CHECK ("source_type" IS NULL OR "source_type" IN ('job_board', 'company_site'));
