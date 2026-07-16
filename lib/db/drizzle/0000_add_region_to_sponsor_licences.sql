ALTER TABLE "sponsor_licences" ADD COLUMN "region" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sponsor_licences_region_idx" ON "sponsor_licences" USING btree ("region");
