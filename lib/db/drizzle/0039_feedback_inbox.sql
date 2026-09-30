CREATE TABLE "feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "category" varchar NOT NULL,
  "message" text NOT NULL,
  "email" varchar(254),
  "page_url" text NOT NULL,
  "screen_resolution" varchar(64) NOT NULL,
  "user_id" varchar,
  "user_agent" text,
  "status" varchar DEFAULT 'new' NOT NULL,
  "admin_notes" text,
  "reviewed_by" varchar,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_reviewed_by_users_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "feedback_category_idx" ON "feedback" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "feedback_status_created_at_idx" ON "feedback" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "feedback_user_id_idx" ON "feedback" USING btree ("user_id");