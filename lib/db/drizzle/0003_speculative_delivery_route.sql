-- Migration: Add delivery_route to speculative_applications
-- Records which lookup step resolved the employer recipient:
--   employer_account      – registered JOBSAGE employer
--   sponsor_contact_email – stored contactEmail on the sponsor licence record
--   ai_enrichment         – discovered on-demand via AI web search
--   ops_fallback          – no email found; routed to ops inbox

ALTER TABLE "speculative_applications"
  ADD COLUMN IF NOT EXISTS "delivery_route" varchar
    CHECK (
      "delivery_route" IS NULL
      OR "delivery_route" IN (
        'employer_account',
        'sponsor_contact_email',
        'ai_enrichment',
        'ops_fallback'
      )
    );
