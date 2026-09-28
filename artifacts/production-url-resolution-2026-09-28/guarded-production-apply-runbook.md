# Guarded production URL migration — apply and verification

Generated from read-only snapshots; no production change was performed.

## Before apply

1. Confirm the staging-table schema has been published to production.
2. Confirm no one has changed the sponsor URL snapshots since the resolver report was generated.
3. Open the published JOBSAGE super-admin page, **Sponsor website and careers import**.
4. Upload `safe-auto-resolved.csv` and run Preview. Do not use a local CLI or direct SQL for writes.
5. Confirm the page reports `production`, the imported safe target-write count is exactly 459, and there are no collisions, unexpected identity conflicts, or existing-URL overwrites. The local resolver has 224 safe candidate rows; exact duplicate sponsor rows can make the target-write count larger.
6. If the preview differs, stop. Refresh production snapshots and rerun the read-only resolver; do not force the plan hash.

## Apply

After reviewing the preview and its plan hash, explicitly authorize the page's guarded apply button. The endpoint locks and rechecks target rows, writes only blank fields, and records an audit event. Preserve the event's plan hash, target-write count, and result.

To stage held candidates, upload the original full reconciliation CSV (not `safe-auto-resolved.csv`) and run Preview again. Confirm the published app reports `production`, then stage the rows the live preview classifies as held; the endpoint rechecks the exact plan hash and excludes safe and no-op rows. The offline resolver currently predicts 2860 held candidate rows, but the live production preview is authoritative. Stop and refresh the snapshots if its result differs unexpectedly. Staging stores candidate/evidence/identity snapshots in the dedicated review table and does not change sponsor URLs or vacancy-discovery data.

## Read-only verification

After apply succeeds, run `production-url-read-only-verification.sql` with authorized read-only production database access. It checks every prepared sponsor website and careers URL target against the exact expected URL and returns one `MATCH`/ `CHECK` row per target. Proceed only if every expected row is present and `MATCH`.

Historical source audit snapshot: `plan:f2484e940b2029c32f2aed5443e8c3a991f668c09832e463a83eca1044bdbffd` (created 2026-09-27T18:52:04.939521+00:00, covering 6007 rows). It records 1957 target writes from that earlier apply; those are not the 459 new writes prepared here. The resolver itself does not access production, deploy, or start vacancy ingestion.
