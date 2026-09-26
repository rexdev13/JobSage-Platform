# Healthcare sponsor website batches 1–6 — final reconciliation

Generated 2026-09-26. This report reconciles the six 500-row discovery batches and the approved high-confidence imports into the development database.

## Source and selection

- The canonical sponsor CSV was not present. The existing sponsor export command was used as the fallback only after its development-only safeguards confirmed a read-only development database source.
- Export input: `.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`; 25,349 exported rows from 142,918 source sponsors.
- Exact `industry=Healthcare`: 4,808 rows. Of these, 42 already had an enrichment signal and 4,766 needed enrichment. Only exact `Healthcare` rows were selected.
- `Social Care` (1,594 rows in the exported source) and other non-exact industry values were excluded. The appearance of terms such as Medical, Care, Dentistry, or Pharmacy in an organisation name did not make a non-Healthcare industry row eligible.
- Batch 1 and batches 3–6 used source order. Batch 2 used the requested ranking: unique employer name, town/city present, care-home/clinic/medical/dental/surgery name, and a town/county clue; source order broke ties. Its 500 selected rows had 500 unique names, a town/city, and a facility/clinic term; 131 had a name/location clue and met all four focus signals. Ninety-seven names from batch-1 robots/unreachable notes were considered, but none remained in the candidate set.
- Batches 3–6 excluded every preceding batch by sponsor ID. Each output contains 500 rows; the six files contain 3,000 unique sponsor IDs with no cross-batch overlap.

## Discovery and evidence

CQC records and the public SponsorList API were used as leads. Neither a directory nor a search result was accepted as an official employer website by itself. Website claims required a safe HTTPS fetch and first-party employer identity evidence. Careers claims required a verified employer site and a checked employer-hosted or directly linked destination. No ATS mappings were identified.

Across the six batches, 755 website claims and 362 careers claims were recorded. Each claim has a confidence label and HTTPS evidence URL. The remaining 2,245 rows had no accepted official website claim; the individual batch reports document failure reasons, unresolved examples, and manual-review samples.

## Batch results

Website/careers claim counts below are sponsor-row evidence counts, split by confidence. Careers writes are grouped by employer name into the company-site record, so duplicate sponsor rows can share one careers update.

| Batch | Selection | Rows | Website claims high / medium | Careers claims high / medium | Website writes | Careers employer-row writes | Medium sponsor rows held | Audit rows |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Source order | 500 | 86 / 49 | 59 / 13 | 86 | 51 | 54 | 500 |
| 2 | Targeted healthcare/location | 500 | 98 / 22 | 25 / 9 | 98 | 25 | 31 | 500 |
| 3 | Source order | 500 | 91 / 42 | 57 / 21 | 91 | 56 | 51 | 500 |
| 4 | Source order | 500 | 102 / 46 | 74 / 13 | 102 | 71 | 52 | 500 |
| 5 | Source order | 500 | 83 / 30 | 40 / 10 | 83 | 38 | 40 | 500 |
| 6 | Source order | 500 | 73 / 33 | 30 / 11 | 73 | 29 | 40 | 500 |
| **Total** |  | **3,000** | **533 / 222** | **285 / 77** | **533** | **270** | **268** | **3,000** |

## Development import reconciliation

- Development database: `heliumdb`. Each batch was dry-run, its diff was checked, and only high-confidence values with blank targets were applied using the reviewed plan hash and exact sponsor identity checks.
- Website fields filled: **533**. The exact-Healthcare sponsor table changed from **4,766 blank / 42 populated** websites before the first import to **4,233 blank / 575 populated** after batch 6.
- Careers fields filled: **270** company-site employer rows. Existing website and careers values were not overwritten.
- All **3,000** batch rows were stored in the website-enrichment audit table. **268** distinct sponsor rows with medium-confidence evidence remain pending in the combined review CSV; medium-confidence values were not promoted.
- **2,245** rows had no accepted official website claim. Common primary unresolved outcomes across the six batches: no exact SponsorList match **1,098**; identity not confirmed **549**; robots/policy block **416**; website unreachable **182**.
- ATS mappings held for later review: **0**.
- Reconciled actions: **3,000** processed; **803** high-confidence database writes (533 websites plus 270 grouped careers records); **268** sponsor rows held for review (299 medium-confidence field claims); **0** high-confidence claims skipped because a target was already populated; **2,245** unresolved and not promoted for lack of an accepted website claim.
- No production database was accessed or written, and no deployment was performed.

## Review and deliverables

- Combined medium-confidence review file: `artifacts/healthcare-sponsor-website-medium-review-batches-1-6.csv` — 268 unique sponsor IDs, all marked `pending`.
- Discovery CSVs and detailed reports: `artifacts/healthcare-sponsor-website-enrichment-batch{1..6}.csv` and matching `-report.md` files. Each report contains source counts, confidence and failure totals, evidence rules, and manual-review examples.
- Import diffs and applied reports: `artifacts/healthcare-sponsor-website-import-batch{1..6}-diff.csv` and matching `-applied.md` files. Dry-run reports are retained as `-dry-run.md`.
- Resumable discovery and development-only importer: `scripts/src/healthcareSponsorWebsiteBatch.ts` and `scripts/src/healthcareSponsorWebsiteImport.ts`. Checkpoints are stored outside the deliverables under `.local/state/healthcare-sponsor-website-batch/`.

**Recommendation:** manually review the 268 medium-confidence rows and any unresolved claims before considering further promotion. Do not import directory/search leads or infer ATS mappings.