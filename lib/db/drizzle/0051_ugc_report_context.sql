ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS reported_context_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_reported_context_id_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_reported_context_id_check
      CHECK (reported_context_id IS NULL OR reported_context_id > 0);
  END IF;
END $$;
