-- Migration: Add inbound email support columns to candidate_messages
-- Adds companyName (stored sender company for employer replies),
-- senderEmail (employer's actual email address), and
-- externalMessageId (Resend messageId for deduplication).

ALTER TABLE "candidate_messages"
  ADD COLUMN IF NOT EXISTS "company_name" text,
  ADD COLUMN IF NOT EXISTS "sender_email" text,
  ADD COLUMN IF NOT EXISTS "external_message_id" text;

-- Unique constraint for deduplication (idempotent: only added if absent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_messages_external_message_id_unique'
      AND conrelid = 'candidate_messages'::regclass
  ) THEN
    ALTER TABLE "candidate_messages"
      ADD CONSTRAINT "candidate_messages_external_message_id_unique"
      UNIQUE ("external_message_id");
  END IF;
END $$;
