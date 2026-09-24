# Company-site vacancy pilot — 24 September 2026

## Initial five batches
- Batch logs record 50 employer selections. Current per-employer state reconstructs 49 unique names; the batch logs did not retain employer rosters, so the remaining slot cannot be distinguished as a duplicate or a lost/overwritten record. The CSV does not invent a name.
- Reconstructed industry labels: 11 (Construction, Engineering, Finance, Hospitality, Legal & Professional, Manufacturing, Other, Retail, Social Care, Technology, Transport).
- Totals: 171 pages; 87 extracted adverts; 3771 rejected; 65 inserted; 22 updated; 0 revived. Persisted changes total 87.
- Outcomes: 24 complete, 20 partial, 6 failed. Total batch runtime 115.3 seconds. ATS providers found: 0.
- Per-employer elapsed time was not recorded for the initial run; the CSV marks it unavailable. For 10 resumed employers, original per-employer counts were overwritten and are marked accordingly.

## One bounded resume batch
- Selected 10 due partials: 31 pages, 48 raw adverts, 21 accepted, 221 rejected; 9 inserted, 11 updated, 0 revived. Runtime 74119 ms. 4 partial and 6 complete outcomes.
- All 21 accepted adverts had unknown UK-location classification (0 known, 21 unknown). No ATS provider was identified.
- Nine new BMC Software URLs were checked individually after the short-lived CLI run; all nine were inconclusive and are not counted as live.

## Candidate-visible result
- Exact sponsor-vacancy feed gates returned one unique live, relevant, non-editorial company-site role before and after the resume: BMC Software Ltd, Technical Support. It overlaps Engineering and IT categories but is one role. Its location text is United Kingdom, targetRegions is empty, and salary is absent.
- The resumed BMC URLs remain inconclusive and do not increase the candidate-visible total.
- The pilot does not pass the gate for expansion to 200: one candidate-visible role, no tested Ashby/Greenhouse/Lever source, and incomplete outcomes remain. No production backfill, alert, or application was run.

## Instrumentation
- Opt-in per-employer telemetry uses COMPANY_SITE_PILOT_TELEMETRY=1 and records source, industry, elapsed time, extraction/persistence counts, UK-location classification, and outcome.
- Batch upserted totals now include inserts, updates, and revivals; earlier summaries omitted updates.