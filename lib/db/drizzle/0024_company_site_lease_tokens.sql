ALTER TABLE "company_site_host_states"
  ADD COLUMN IF NOT EXISTS "request_lease_token" text;