# Healthcare sponsor website enrichment — batch 1

Generated: 2026-09-26T09:44:44.831Z

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
- Selection keeps sponsor IDs distinct; missing-ID fallback keys normalize employer name plus town/city. Source order (the export's ID order) is retained.

## Enrichment sources and evidence rules

- CQC directory lead file: `/home/runner/workspace/scripts/data/cache/cqc-directory-2026-09-14.csv` (96,394 parsed records; cached source produced 2026-09-09, filename dated 2026-09-14). The CQC location page is recorded as a source lead, not as proof that the CQC listing is the employer website.
- SponsorList's published public sponsor-search API was queried for unresolved rows without a CQC website candidate. Results were matched on exact normalized employer name and town/county; its website field and profile URL remain leads only.
- Employer website claims are accepted only after a safe HTTPS fetch through the existing public-site fetcher and a direct first-party page identity check. The first-party page URL is the website evidence URL. CQC, SponsorList, and search results alone are never promoted.
- Careers URLs are accepted only when directly linked from the verified employer homepage or found at a conventional employer-hosted path, and the destination fetch succeeds. ATS mappings are limited to explicit Ashby, Greenhouse, or Lever board links and keep the employer-page link as mapping evidence.
- Web search was exercised on two initial records (ZVF PHARMA LTD / Slough and AZAAN HEALTHCARE (DUNDEE) LTD / Dundee). Results were directory/company-profile leads or unrelated similarly named organizations; no search result was accepted as an official URL. No Bing search API key was configured for the standalone resumable script; search-based discoveries remain available by supplying BING_SEARCH_API_KEY later.
- Public-site fetching honors HTTPS, public-DNS, same-site redirect, robots.txt, page-size, timeout, pacing, and bounded retry checks.

## Batch results

- Batch start offset among deduplicated exact-Healthcare rows needing enrichment: **1**
- Batch rows written: **500** (limit 500)
- Duplicate sponsor IDs omitted: **0**
- Name/town fallback duplicates omitted: **0**
- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **156**
- Website confidence counts: `high` 86, `medium` 49, `none` 365
- Careers confidence counts: `high` 59, `medium` 13, `none` 428
- ATS mappings: `none` 500
- Lookup source counts: `CQC and cached public-source lookup` 101, `CQC fuzzy_name_town/medium lead` 6, `CQC fuzzy_name_town/medium lead; first-party page identity checked` 2, `CQC location_name/high lead` 11, `CQC location_name/high lead; first-party page identity checked` 3, `CQC provider_name/high lead` 96, `CQC provider_name/high lead; first-party page identity checked` 30, `SponsorList public directory lead` 151, `SponsorList public directory lead; first-party page identity checked` 100
- Lookup outcome categories: `identity_not_confirmed` 107, `robots_or_policy_block` 62, `sponsorlist_no_exact_match` 156, `website_and_careers_verified` 72, `website_unreachable` 40, `website_verified` 63
- Unresolved/failure categories: `identity_not_confirmed` 107, `robots_or_policy_block` 62, `sponsorlist_no_exact_match` 156, `website_unreachable` 40

The exact candidate industry values in this output were: `Healthcare`.

## Manual review samples

| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |
| --- | --- | --- | --- | --- | --- |
| 156647 | Abbey Dale Medical Centre | https://www.abbey-dale.co.uk/ | https://www.abbey-dale.co.uk/jobs/ | website high; careers medium | https://www.abbey-dale.co.uk/ |
| 156651 | Abbey Equine Clinic LTD | https://www.abbeyequine.co.uk/ | https://www.abbeyequine.co.uk/careers | website high; careers high | https://www.abbeyequine.co.uk/ |
| 156654 | Abbey Healthcare (Aaron Court) Limited | https://www.abbeyhealthcare.org.uk/ | https://www.abbeyhealthcare.org.uk/careers/ | website medium; careers high | https://www.abbeyhealthcare.org.uk/ |
| 156655 | Abbey Healthcare (Cromwell) Ltd | https://www.abbeyhealthcare.org.uk/ | https://www.abbeyhealthcare.org.uk/careers/ | website medium; careers high | https://www.abbeyhealthcare.org.uk/ |
| 156656 | Abbey Healthcare (Hamilton) Ltd | https://www.abbeyhealthcare.org.uk/ | https://www.abbeyhealthcare.org.uk/careers/ | website medium; careers high | https://www.abbeyhealthcare.org.uk/ |
| 156657 | Abbey Healthcare (Hamilton) Ltd | https://www.abbeyhealthcare.org.uk/ | https://www.abbeyhealthcare.org.uk/careers/ | website medium; careers high | https://www.abbeyhealthcare.org.uk/ |
| 141526 | ZVF PHARMA LTD | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/zvf-pharma-ltd/ |
| 154039 | AZAAN HEALTHCARE (DUNDEE) LTD | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/azaan-healthcare-dundee-ltd/ |
| 154351 | B R PATEL T/As RIDDHI'S BEAUTY CLINIC | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/b-r-patel-tas-riddhis-beauty-clinic/ |
| 154434 | Brooke Healthcare Ltd | — | — | website none; careers none | https://www.cqc.org.uk/location/1-15753571350 |
| 154468 | Hilton Pharmacy Ltd T/A Hilton Pharmacy & Opticians | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/hilton-pharmacy-ltd-ta-hilton-pharmacy-opticians/ |
| 154533 | Riverside medical practice | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |

### Unresolved examples

- **141526 ZVF PHARMA LTD** (Slough): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/zvf-pharma-ltd/
- **154039 AZAAN HEALTHCARE (DUNDEE) LTD** (Dundee): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/azaan-healthcare-dundee-ltd/
- **154351 B R PATEL T/As RIDDHI'S BEAUTY CLINIC** (London): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/b-r-patel-tas-riddhis-beauty-clinic/
- **154434 Brooke Healthcare Ltd** (Nottingham): CQC match supplied no eligible employer website URL; SponsorList had no exact name/location match with an employer website; search lead: https://www.cqc.org.uk/location/1-15753571350
- **154468 Hilton Pharmacy Ltd T/A Hilton Pharmacy & Opticians** (Hilton): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/hilton-pharmacy-ltd-ta-hilton-pharmacy-opticians/
- **154533 Riverside medical practice** (Blackwood): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **154592 1 Kings Dental Limited** (London): CQC match supplied no eligible employer website URL; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/1-kings-dental-limited/
- **154714 18A Charing Cross Dental Surgery** (London): CQC match supplied no eligible employer website URL; SponsorList had no exact name/location match with an employer website; search lead: https://www.cqc.org.uk/location/1-215610365

## Common failure reasons

- `identity_not_confirmed`: 107
- `sponsorlist_no_exact_match`: 156
- `robots_or_policy_block`: 62
- `website_unreachable`: 40

Specific frequent unresolved notes from this run:

- no unambiguous CQC name/location match — 227
- CQC match supplied no eligible employer website URL — 80
- candidate website could not be safely checked: robots.txt disallows this page — 30
- employer identity was not corroborated on the candidate website — 8
- candidate website could not be safely checked: redirect left the confirmed HTTPS employer domain — 6
- candidate website could not be safely checked: page exceeds size limit — 2

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on `sponsor_licence_id`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch1.csv`
- Progress checkpoint (outside deliverables): `/home/runner/workspace/scripts/.local/state/healthcare-sponsor-website-batch/sponsorlist-batch1-progress.json`
- The script processes exact-Healthcare rows by source order and supports later batches with `--offset 500 --limit 500`.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless `--overwrite` is supplied; in that case the old file is renamed to a timestamped backup first.
