/** Do not activate destructive endpoints until these integrations have concrete evidence.
 * This is intentionally not a secret/environment flag that alone could bypass missing safeguards. */
export const DELETION_RELEASE_BLOCKERS = [
  "Verified schema-wide row selectors, shared-record transfer/anonymisation and legal-hold manifests",
  "All dispatchers check account quarantine, and native/extension/device cleanup is verified",
  "Confirmed erasure/revocation adapters for every JOBSAGE-controlled processor",
  "Independent tombstone registry, automatic restore replay and encrypted-backup expiry evidence",
  "Dedicated deletion encryption/pseudonym key provisioned through secure configuration",
  "Signed-in reauthentication, durable request receipt and end-to-end fixture validation",
] as const;
export const DELETION_REQUESTS_ENABLED = false;
