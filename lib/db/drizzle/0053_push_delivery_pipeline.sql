CREATE TABLE IF NOT EXISTS "push_notification_outbox" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "event_key" varchar(180) NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" varchar NOT NULL,
  "destination" varchar(128) NOT NULL,
  "state" varchar DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_until" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "last_error_code" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_outbox_category_check"
    CHECK ("category" IN ('messages','interviews','applications','eligibility','documents','jobAlerts')),
  CONSTRAINT "push_outbox_state_check"
    CHECK ("state" IN ('queued','sending','sent','retry','skipped','failed')),
  CONSTRAINT "push_notification_outbox_event_key_unique" UNIQUE ("event_key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_outbox_claim_idx"
  ON "push_notification_outbox" ("state", "available_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_outbox_user_idx"
  ON "push_notification_outbox" ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_notification_deliveries" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "notification_id" varchar(36) NOT NULL REFERENCES "push_notification_outbox"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "receipt_id" varchar(128),
  "state" varchar DEFAULT 'retry' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_at" timestamp with time zone,
  "last_error_code" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_delivery_state_check"
    CHECK ("state" IN ('retry','receipt_pending','delivered','invalid','failed')),
  CONSTRAINT "push_delivery_event_token_unique" UNIQUE ("notification_id", "token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_delivery_receipt_idx"
  ON "push_notification_deliveries" ("state", "available_at");
