ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "apply_url" text;--> statement-breakpoint
ALTER TABLE "job_listings" ADD COLUMN IF NOT EXISTS "apply_url" text;
