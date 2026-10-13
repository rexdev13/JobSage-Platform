CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "account_hash" varchar(64) NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "outcome" varchar DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_deletion_account_hash_unique"
  ON "account_deletion_requests" ("account_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_deletion_tasks" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "request_id" varchar(36) NOT NULL,
  "kind" varchar NOT NULL,
  "state" varchar DEFAULT 'pending' NOT NULL,
  "resource_ciphertext" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "retry_at" timestamp with time zone NOT NULL,
  "lease_until" timestamp with time zone,
  "failure_code" varchar(80),
  CONSTRAINT "account_deletion_tasks_request_id_account_deletion_requests_id_fk"
    FOREIGN KEY ("request_id") REFERENCES "account_deletion_requests"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletion_tasks_claim_idx"
  ON "account_deletion_tasks" ("state", "retry_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_retention_records" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "request_id" varchar(36) NOT NULL,
  "category" varchar NOT NULL,
  "lawful_reason" text NOT NULL,
  "expires_at" timestamp with time zone,
  "hold_reference" text,
  "record_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "legal_retention_records_request_id_account_deletion_requests_id_fk"
    FOREIGN KEY ("request_id") REFERENCES "account_deletion_requests"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legal_retention_expiry_idx"
  ON "legal_retention_records" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deletion_tombstone_outbox" (
  "request_id" varchar(36) PRIMARY KEY NOT NULL,
  "acknowledged_at" timestamp with time zone,
  CONSTRAINT "deletion_tombstone_outbox_request_id_account_deletion_requests_id_fk"
    FOREIGN KEY ("request_id") REFERENCES "account_deletion_requests"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
