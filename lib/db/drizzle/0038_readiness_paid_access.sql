ALTER TABLE "users"
  ADD COLUMN "plan" varchar DEFAULT 'free' NOT NULL,
  ADD COLUMN "bonus_readiness_checks" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "subscription_expires_at" timestamp with time zone,
  ADD COLUMN "stripe_customer_id" text,
  ADD COLUMN "stripe_payment_intent_id" text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_bonus_readiness_checks_nonnegative"
  CHECK ("bonus_readiness_checks" >= 0);
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_plan_valid"
  CHECK ("plan" IN ('free', 'pro'));