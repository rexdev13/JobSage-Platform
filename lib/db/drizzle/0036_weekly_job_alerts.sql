-- Candidate job alerts are weekly at launch. Existing daily preferences are
-- migrated to the same weekly behavior; the enum remains readable for older
-- rows and API clients.
ALTER TABLE "profiles"
  ALTER COLUMN "alert_frequency" SET DEFAULT 'weekly';
--> statement-breakpoint
UPDATE "profiles"
SET "alert_frequency" = 'weekly'
WHERE "alert_frequency" = 'daily';