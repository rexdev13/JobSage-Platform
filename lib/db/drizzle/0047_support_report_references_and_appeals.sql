ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS reported_message_id integer;
--> statement-breakpoint
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS appeal_of_ticket_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_reported_message_id_candidate_messages_id_fk'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_reported_message_id_candidate_messages_id_fk
      FOREIGN KEY (reported_message_id) REFERENCES candidate_messages(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_appeal_of_ticket_id_support_tickets_id_fk'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_appeal_of_ticket_id_support_tickets_id_fk
      FOREIGN KEY (appeal_of_ticket_id) REFERENCES support_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_reported_message_id_idx
  ON support_tickets (reported_message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_appeal_of_ticket_id_idx
  ON support_tickets (appeal_of_ticket_id);
