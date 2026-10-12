ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS is_content_report boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS severity varchar NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS assigned_moderator_id varchar;
--> statement-breakpoint
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_severity_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_severity_check
      CHECK (severity IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_assigned_moderator_id_users_id_fk'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_assigned_moderator_id_users_id_fk
      FOREIGN KEY (assigned_moderator_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_moderation_queue_idx
  ON support_tickets (is_content_report, status, severity, created_at);
