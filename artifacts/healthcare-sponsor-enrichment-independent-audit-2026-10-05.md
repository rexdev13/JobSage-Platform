# JOBSAGE Healthcare sponsor-enrichment audit

**Audit date:** 2026-10-05  
**Overall result:** **PARTIALLY CONFIRMED**

## Conclusion

The six source batches contain 3,000 distinct Healthcare sponsor rows, and the development audit table contains one audit record for each. The batch import artifacts report 533 website writes and 270 employer-level careers writes to development.

The current development state supports 532 of the 533 proposed website values: every extant matching sponsor row has the proposed value, but the sponsor record for one candidate is absent. All 270 grouped careers targets currently match their proposed URLs. These are URL and sponsor-record counts, not vacancy counts.

The source workflow records high-confidence websites and careers destinations as checked using first-party evidence. This audit did not revisit those pages, so it does not establish that they are live or unchanged today. No vacancy records were queried; no vacancy total is confirmed here.

## Recalculated batch and audit totals

| Measure | Recalculated result |
|---|---:|
| Source batch rows | 3,000 |
| Distinct sponsor IDs across batches | 3,000 |
| Rows with exact `industry=Healthcare` | 3,000 |
| Sponsor IDs also present in the sponsor-base export | 3,000 |
| Sponsor-base export rows | 25,349 |
| Exact-Healthcare rows in the sponsor-base export | 4,808 |
| Development enrichment audit rows | 3,000 |
| Distinct development audit keys | 3,000 |
| Development audit runs | 6, with 500 rows in each |

The 3,000 audit records demonstrate that sponsor rows were processed and recorded. They do not mean that 3,000 websites or vacancies were found.

## Website URLs

| Confidence | Sponsor-row claims | Distinct URL strings | Evidence URL populated |
|---|---:|---:|---:|
| High | 533 | 505 | 533 / 533 |
| Medium, held for review | 222 | 201 | Not used as a promotion count |
| All confidence levels above | 755 | 702 | — |

All 533 high-confidence claims appear as `update_blank` rows in the import diffs, and the six applied summaries report 533 website updates in total.

The current development check matched 532 proposed URLs exactly. The remaining candidate is for **Murray Health Care Ltd** (internal sponsor ID `238842`): its corresponding audit candidate exists, but no current development sponsor row was found by either that ID or employer name. No surviving row with a different website value was found. The records reviewed do not establish why the sponsor row is absent or whether it was later removed; therefore the current database does not substantiate all 533 values as presently stored.

## Careers-page URLs

| Confidence | Sponsor-row claims | Distinct URL strings |
|---|---:|---:|
| High | 285 | 255 |
| Medium, held for review | 77 | 69 |
| All confidence levels above | 362 | 324 |

The 285 high-confidence sponsor-row claims group to **270 employer-level targets**. There is one selected URL per target; the 270 targets contain 255 distinct URL strings. All 285 high-confidence claims have a careers evidence URL recorded.

The six applied summaries report 270 careers employer rows written. A read-only development comparison found all **270 of 270** grouped employer careers values matching the proposed target URLs.

## Medium-confidence review set

The combined review file contains **268 pending rows for 268 distinct sponsor IDs**. Those rows contain 222 medium-confidence website claims and 77 medium-confidence careers claims: 299 field-level claims, with 31 sponsor rows carrying both. The review rows match the corresponding source-batch field values. Medium-confidence values were held for review, not promoted as high-confidence writes.

## What “checked” and “verified” mean here

The batch implementation describes website claims as accepted after a safe HTTPS fetch and first-party page identity check. Its high-confidence identity rule requires employer-name tokens and location evidence on the page. Careers destinations are accepted when linked from the employer homepage or found at a conventional employer-hosted path, with a successful destination fetch. The high-confidence batch rows also have their evidence URL fields populated.

This supports describing these as **historically workflow-checked, high-confidence candidates**. It does not support claiming that this audit independently verified every employer identity, or that each URL is live now: no external pages were re-fetched for this audit.

## Vacancies

No vacancy table or vacancy records were queried in this audit. The count of vacancies found or saved is therefore **not audited**, not zero. Website and careers-page URLs are not evidence that a vacancy record exists.

## Evidence and method

- Recalculated the six source CSVs: `artifacts/healthcare-sponsor-website-enrichment-batch1.csv` through `batch6.csv`.
- Matched batch IDs against `.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`.
- Recalculated high-confidence, medium-confidence, distinct-URL, and grouped-target counts from the source CSVs, medium-review CSV, and import diff CSVs.
- Cross-checked the six applied summaries and the development tables `sponsor_licence_website_enrichment_audits`, `sponsor_licences`, and `sponsor_licence_company_site_checks` using SELECT-only queries.
- Reviewed the evidence rules in `scripts/src/healthcareSponsorWebsiteBatch.ts` and the grouping/write logic in `scripts/src/healthcareSponsorWebsiteImport.ts`.

No database data, code, schema, configuration, scheduler, infrastructure, or deployment was changed. This report is a new output; existing evidence files were left untouched.
