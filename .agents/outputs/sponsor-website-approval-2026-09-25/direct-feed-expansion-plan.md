# Plan: expand verified direct-feed mappings toward 100 employers

## Gate status

The 29-employer control test passed in development: the identical cohort was processed twice, all three verified ATS feeds completed both times, there were no failed or rejected adverts, 26 no-source employers were explicitly skipped, and the repeat pass inserted zero rows. This authorizes planning the next mapping phase only; it does not authorize a broad crawler, production writes, or deployment.

Current coverage is **3 verified direct mappings out of 29 employers**. The 26 skips are not mappings and must not be counted toward the 100-mapping target. No schema.org pages were approved in this cohort.

## Expansion steps

1. **Build a 100-employer candidate manifest.** Start from the next approved sponsor set and reconcile each row by exact sponsor ID and organisation name. Track the target as 100 verified mappings, not merely 100 employers selected.
2. **Verify each direct source before enabling it.** Record the first-party careers evidence URL, supported ATS provider and exact board ID. Accept only supported direct-feed providers, or a separately approved exact careers page containing JobPosting JSON-LD/microdata. Keep ambiguous identities, unsupported providers, and unverified pages out of the eligible set.
3. **Review duplicate employer identities.** Where multiple sponsor IDs share an organisation name, accept direct-only processing only when their website and all source-mapping fields agree; otherwise hold for manual resolution. Preserve exact ID/name matching.
4. **Preflight in development.** Confirm the 100 candidate IDs against the development database, show counts for verified supported mappings, explicitly approved schema pages, unsupported mappings, and no-source skips, then independently confirm the development database fingerprint. Do not start a run if the fingerprint or cohort count differs.
5. **Run bounded direct-only batches.** Use the direct-only runner with website filling and generic page crawling disabled. Apply in capped batches (for example, 20–25 employers) so a failure is attributable and easy to stop. Persist only approved ATS-posting or approved schema.org evidence; keep existing SSRF, URL safety, liveness, and candidate visibility gates.
6. **Audit each batch.** Report per employer/provider: found, inserted, updated, rejected, failed, skipped-no-source, runtime, and candidate-visible samples. Investigate every failure or rejection before moving to the next batch; do not turn a no-source skip into generic vacancy extraction.
7. **Run the repeat guard after all batches.** Re-run the same 100 IDs with the existing-repeat guard. Require zero inserts, no failed approved feeds, no rejected adverts, and stable candidate visibility for the same sources before treating the 100-mapping phase as complete.

## Release criteria

- Exactly 100 unique employer mappings are verified against exact sponsor IDs, or the report explicitly states that fewer than 100 could be verified; do not pad the set with unverified or generic sources.
- Every new vacancy is attributable to a supported ATS feed or an individually approved schema.org careers page.
- First-pass failures/rejections are resolved or explicitly excluded before expansion continues.
- The repeat run inserts zero rows.
- Candidate visibility samples show only rows that pass the existing candidate-list gates; pre-existing legacy rows are labeled separately from this phase's writes.
- Development-only database fingerprint is confirmed for every execution. Production writes and deployment require separate authorization.

## Out of scope

No generic website crawl as a vacancy-insertion source, no broad 100-employer crawl, no production database writes, and no deployment.
