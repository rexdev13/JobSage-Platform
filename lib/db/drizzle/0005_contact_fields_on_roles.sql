ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "contact_email" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "contact_phone" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "contact_website" text;
