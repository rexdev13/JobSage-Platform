# Healthcare sponsor website enrichment — batch 6

Generated: 2026-09-26T17:04:02.552Z

## Source and selection

- Canonical sponsor CSV: **not found** in the repository.
- Fallback input: `/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv` (25,349 exported rows).
- Source selection: existing `sponsor-enrichment-export` command ran with `NODE_ENV=development --confirm-development-db`; its own safeguards accepted the target and it reported a development-only, read-only transaction. No data was written.
- All source sponsor rows reported by the export: **142,918**; exported rows: **25,349**.
- Exact `industry=Healthcare` rows in the export: **4,808**. All such rows were present because the export's rule classifier selects Healthcare values.
- Exact-Healthcare rows already carrying a website, careers URL, or ATS signal: **42**.
- Deduplicated exact-Healthcare rows needing enrichment: **4,766**.
- Related source industry labels excluded from the candidate batch:
- `Social Care`: 1594 in exported source; excluded because the source industry is not exactly `Healthcare`.
- The selection is exact-case and exact-value only; Medical, Care, Dentistry, Pharmacy, Social Care, and other values are not eligible unless source industry equals `Healthcare`.
- Selection keeps sponsor IDs distinct; missing-ID fallback keys normalize employer name plus town/city. Remaining rows are source-ordered after excluding every prior batch ID.

## Enrichment sources and evidence rules

- CQC directory lead file: `/home/runner/workspace/scripts/data/cache/cqc-directory-2026-09-14.csv` (96,394 parsed records; cached source produced 2026-09-09, filename dated 2026-09-14). The CQC location page is recorded as a source lead, not as proof that the CQC listing is the employer website.
- SponsorList's published public sponsor-search API was queried for unresolved rows without a CQC website candidate. Results were matched on exact normalized employer name and town/county; its website field and profile URL remain leads only.
- Employer website claims are accepted only after a safe HTTPS fetch through the existing public-site fetcher and a direct first-party page identity check. The first-party page URL is the website evidence URL. CQC, SponsorList, and search results alone are never promoted.
- Careers URLs are accepted only when directly linked from the verified employer homepage or found at a conventional employer-hosted path, and the destination fetch succeeds. ATS mappings are limited to explicit Ashby, Greenhouse, or Lever board links and keep the employer-page link as mapping evidence.
- Web search was exercised on two initial records (ZVF PHARMA LTD / Slough and AZAAN HEALTHCARE (DUNDEE) LTD / Dundee). Results were directory/company-profile leads or unrelated similarly named organizations; no search result was accepted as an official URL. No Bing search API key was configured for the standalone resumable script; search-based discoveries remain available by supplying BING_SEARCH_API_KEY later.
- Public-site fetching honors HTTPS, public-DNS, same-site redirect, robots.txt, page-size, timeout, pacing, and bounded retry checks.

## Batch results

- Batch number: **6**
- Selection mode: **source-order**
- Start position within this selection: **1**
- Batch rows written: **500** (limit 500)
- Previously processed rows excluded: **2500**
- Duplicate sponsor IDs omitted: **0**
- Name/town fallback duplicates omitted: **0**
- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **156**
- Website confidence counts: `high` 73, `medium` 33, `none` 394
- Careers confidence counts: `high` 30, `medium` 11, `none` 459
- ATS mappings: `none` 500
- Lookup source counts: `CQC and cached public-source lookup` 143, `CQC fuzzy_name_town/medium lead` 5, `CQC location_name/high lead` 24, `CQC location_name/high lead; first-party page identity checked` 2, `CQC provider_name/high lead` 111, `CQC provider_name/high lead; first-party page identity checked` 19, `SponsorList public directory lead` 111, `SponsorList public directory lead; first-party page identity checked` 85
- Lookup outcome categories: `identity_not_confirmed` 91, `robots_or_policy_block` 72, `sponsorlist_no_exact_match` 206, `website_and_careers_verified` 41, `website_unreachable` 25, `website_verified` 65
- Unresolved/failure categories: `identity_not_confirmed` 91, `robots_or_policy_block` 72, `sponsorlist_no_exact_match` 206, `website_unreachable` 25

The exact candidate industry values in this output were: `Healthcare`.

## Selection targeting

- Prior batch CSVs excluded: **5**
- Previous batch files: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch1.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch2.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch3.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch4.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch5.csv`

## Manual review samples

| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |
| --- | --- | --- | --- | --- | --- |
| 229747 | Lyndhurst Dental Practice Ltd | https://www.thelyndhurstpractice.co.uk/ | https://www.thelyndhurstpractice.co.uk/careers | website medium; careers medium | https://www.thelyndhurstpractice.co.uk/ |
| 230270 | MAA Trading LTD T/A Drayton Prime Pharmacy | https://draytonprime.co.uk/ | https://draytonprime.co.uk/careers | website high; careers medium | https://draytonprime.co.uk/ |
| 230323 | Mac Dental Centre Limited | https://www.macdental.co.uk/ | — | website medium; careers none | https://www.macdental.co.uk/ |
| 230627 | Magawell Ltd T/A Evans Pharmacy | https://www.evanspharmacy.wales/ | — | website medium; careers none | https://www.evanspharmacy.wales/ |
| 230897 | Maidstone Clinic Ltd | https://www.maidstonedental.co.uk/ | — | website medium; careers none | https://www.maidstonedental.co.uk/ |
| 231189 | Malmin Healthcare Ltd | https://malmin.co.uk/ | — | website high; careers none | https://malmin.co.uk/ |
| 229513 | Lupset Health Centre | — | — | website none; careers none | https://www.cqc.org.uk/location/1-584714639 |
| 229575 | LUU-BRIDGETS HEALTHCARE LIMITED | — | — | website none; careers none | https://www.cqc.org.uk/location/1-4432097706 |
| 229698 | LWT Health Care Limited T/A Streatfeild House | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/lwt-health-care-limited-ta-streatfeild-house/ |
| 229745 | Lynden Hill Clinic | — | — | website none; careers none | https://www.cqc.org.uk/location/1-108600680 |
| 229753 | Lyngold Ltd T/A Sinclairs Pharmacy | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |
| 229764 | Lynwood Healthcare Ltd | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |

### Unresolved examples

- **229513 Lupset Health Centre** (Wakefield): candidate website could not be safely checked: robots.txt disallows this page; search lead: https://www.cqc.org.uk/location/1-584714639
- **229575 LUU-BRIDGETS HEALTHCARE LIMITED** (London): candidate website could not be safely checked: robots.txt disallows this page; search lead: https://www.cqc.org.uk/location/1-4432097706
- **229698 LWT Health Care Limited T/A Streatfeild House** (St.Leonard on sea): CQC match supplied no eligible employer website URL; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/lwt-health-care-limited-ta-streatfeild-house/
- **229745 Lynden Hill Clinic** (Reading): candidate website could not be safely checked: robots.txt disallows this page; search lead: https://www.cqc.org.uk/location/1-108600680
- **229753 Lyngold Ltd T/A Sinclairs Pharmacy** (London): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **229764 Lynwood Healthcare Ltd** (Kilingworth): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **229765 LYNWOOD MEDICAL CENTRE** (Romford): candidate website could not be safely checked: robots.txt disallows this page; search lead: https://www.cqc.org.uk/location/1-14142908815
- **229795 Lytham St Annes Primary Care Network Limited** (Lytham St Annes): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none

## Common failure reasons

- `robots_or_policy_block`: 72
- `identity_not_confirmed`: 91
- `sponsorlist_no_exact_match`: 206
- `website_unreachable`: 25

Specific frequent unresolved notes from this run:

- no unambiguous CQC name/location match — 229
- CQC match supplied no eligible employer website URL — 88
- candidate website could not be safely checked: robots.txt disallows this page — 42
- employer identity was not corroborated on the candidate website — 14
- employer name has no distinctive identity token — 3
- candidate website could not be safely checked: redirect left the confirmed HTTPS employer domain — 3
- candidate website could not be safely checked: page exceeds size limit — 3

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on `sponsor_licence_id`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch6.csv`
- Progress checkpoint (outside deliverables): `/home/runner/workspace/.local/state/healthcare-sponsor-website-batch/batch6-progress.json`
- The script processes exact-Healthcare rows, checkpoints every employer, and supports ranked batch-2 targeting plus prior-batch ID exclusions for later batches.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless `--overwrite` is supplied; in that case the old file is renamed to a timestamped backup first.
