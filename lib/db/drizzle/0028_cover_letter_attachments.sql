ALTER TABLE "speculative_applications"
  ADD COLUMN IF NOT EXISTS "cover_letter_document_id" integer,
  ADD COLUMN IF NOT EXISTS "cover_letter_filename" text,
  ADD COLUMN IF NOT EXISTS "cover_letter_included" boolean NOT NULL DEFAULT false;