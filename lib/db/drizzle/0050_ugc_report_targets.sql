ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS reported_content_type varchar,
  ADD COLUMN IF NOT EXISTS reported_content_id text;
--> statement-breakpoint
UPDATE support_tickets
SET reported_content_type = CASE
  WHEN reported_message_id IS NOT NULL THEN 'inbox_message'
  ELSE 'ai_content'
END
WHERE is_content_report = true AND reported_content_type IS NULL;
--> statement-breakpoint
UPDATE support_tickets
SET reported_content_id = reported_message_id::text
WHERE reported_message_id IS NOT NULL AND reported_content_id IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_reported_content_type_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_reported_content_type_check
      CHECK (reported_content_type IS NULL OR reported_content_type IN (
        'ai_content', 'inbox_message', 'candidate_profile', 'job_listing',
        'attachment', 'support_request', 'employer_feedback', 'other'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_reported_content_id_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_reported_content_id_check
      CHECK (
        reported_content_type IS NULL
        OR reported_content_type IN ('ai_content', 'other')
        OR (reported_content_id IS NOT NULL AND char_length(reported_content_id) BETWEEN 1 AND 200)
      );
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_tickets_reported_content_idx
  ON support_tickets (is_content_report, reported_content_type, status, created_at);
