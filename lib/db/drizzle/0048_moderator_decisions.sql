ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS moderation_decision varchar NOT NULL DEFAULT 'pending';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_moderation_decision_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_moderation_decision_check
      CHECK (moderation_decision IN ('pending', 'no_action', 'escalated'));
  END IF;
END $$;
