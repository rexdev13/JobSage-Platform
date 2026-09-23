ALTER TABLE "sponsor_licence_company_site_checks"
  ADD COLUMN IF NOT EXISTS "probe_status" text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "last_probed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "probe_reason" text;

UPDATE "sponsor_licence_company_site_checks"
SET
  "probe_status" = CASE
    WHEN "last_outcome" = 'ok_for_crawl' THEN 'ok_for_crawl'
    WHEN "last_outcome" IN ('temporary_bad', 'permanent_bad') THEN 'bad'
    ELSE 'unknown'
  END,
  "last_probed_at" = CASE
    WHEN "last_outcome" IN ('ok_for_crawl', 'temporary_bad', 'permanent_bad')
      THEN COALESCE("updated_at", now())
    ELSE "last_probed_at"
  END,
  "probe_reason" = CASE
    WHEN "last_outcome" = 'ok_for_crawl' THEN 'legacy probe approval'
    WHEN "last_outcome" IN ('temporary_bad', 'permanent_bad')
      THEN COALESCE("last_error", 'legacy probe failure')
    ELSE "probe_reason"
  END
WHERE "probe_status" = 'unknown';

CREATE INDEX IF NOT EXISTS "company_site_checks_probe_due_idx"
  ON "sponsor_licence_company_site_checks" ("probe_status", "last_probed_at");