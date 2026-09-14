ALTER TABLE "marketer_events"
  ADD COLUMN IF NOT EXISTS "external_event_uri" text,
  ADD COLUMN IF NOT EXISTS "external_invitee_uri" text,
  ADD COLUMN IF NOT EXISTS "external_invitee_email" text,
  ADD COLUMN IF NOT EXISTS "calendly_synced_at" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "marketer_events_external_event_uri_idx"
  ON "marketer_events" ("external_event_uri");