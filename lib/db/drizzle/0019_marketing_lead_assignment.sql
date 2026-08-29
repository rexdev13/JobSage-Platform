ALTER TABLE "social_leads"
  ADD COLUMN IF NOT EXISTS "marketing_user_id" varchar
  REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_leads_marketing_user_idx"
  ON "social_leads" ("marketing_user_id");