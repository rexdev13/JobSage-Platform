CREATE TABLE IF NOT EXISTS "candidate_readiness_claims" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL,
  "claim_key" varchar(255) NOT NULL,
  "claim_text" text NOT NULL,
  "source_role_id" integer,
  "source_vacancy_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_readiness_claims_user_key_idx"
  ON "candidate_readiness_claims" USING btree ("user_id","claim_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_readiness_claims_user_idx"
  ON "candidate_readiness_claims" USING btree ("user_id");