# Healthcare sponsor website enrichment — batch 3

Generated: 2026-09-26T15:36:58.645Z

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

- Batch number: **3**
- Selection mode: **source-order**
- Start position within this selection: **1**
- Batch rows written: **500** (limit 500)
- Previously processed rows excluded: **1000**
- Duplicate sponsor IDs omitted: **0**
- Name/town fallback duplicates omitted: **0**
- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **156**
- Website confidence counts: `high` 91, `medium` 42, `none` 367
- Careers confidence counts: `high` 57, `medium` 21, `none` 422
- ATS mappings: `none` 500
- Lookup source counts: `CQC and cached public-source lookup` 154, `CQC fuzzy_name_town/medium lead` 10, `CQC fuzzy_name_town/medium lead; first-party page identity checked` 3, `CQC location_name/high lead` 18, `CQC location_name/high lead; first-party page identity checked` 3, `CQC provider_name/high lead` 109, `CQC provider_name/high lead; first-party page identity checked` 28, `SponsorList public directory lead` 76, `SponsorList public directory lead; first-party page identity checked` 99
- Lookup outcome categories: `identity_not_confirmed` 67, `robots_or_policy_block` 52, `sponsorlist_no_exact_match` 213, `website_and_careers_verified` 78, `website_unreachable` 35, `website_verified` 55
- Unresolved/failure categories: `identity_not_confirmed` 67, `robots_or_policy_block` 52, `sponsorlist_no_exact_match` 213, `website_unreachable` 35

The exact candidate industry values in this output were: `Healthcare`.

## Selection targeting

- Prior batch CSVs excluded: **2**
- Previous batch files: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch1.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch2.csv`

## Manual review samples

| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |
| --- | --- | --- | --- | --- | --- |
| 171297 | Biggs Beit Ltd TA Biggs Healthcare | https://www.biggshealthcare.co.uk/ | — | website high; careers none | https://www.biggshealthcare.co.uk/ |
| 171419 | BIN-SEENA HEALTHCARE LTD | https://bin-seena.co.uk/ | — | website high; careers none | https://bin-seena.co.uk/ |
| 171510 | Biomet UK Healthcare Ltd | https://www.zimmerbiomet.com/en | https://careers.zimmerbiomet.com/us/en | website medium; careers medium | https://www.zimmerbiomet.com/en |
| 171511 | Biomet UK Healthcare Ltd | https://www.zimmerbiomet.com/en | https://careers.zimmerbiomet.com/us/en | website medium; careers medium | https://www.zimmerbiomet.com/en |
| 171543 | Biotech Consultants Limited (BTCL) | https://www.biotechconsultants.co.uk/ | — | website medium; careers none | https://www.biotechconsultants.co.uk/ |
| 171561 | Birbeck Medical Group | https://www.birbeckmedicalgroup.co.uk/ | https://www.birbeckmedicalgroup.co.uk/jobs/ | website high; careers high | https://www.birbeckmedicalgroup.co.uk/ |
| 171243 | BIG HEALTHCARE LIMITED | — | — | website none; careers none | https://www.cqc.org.uk/location/1-4522373449 |
| 171463 | Bio Luminuex Health Care Limited | — | — | website none; careers none | https://www.cqc.org.uk/location/1-4054170060 |
| 171472 | Bioactive Pharma Ltd | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/bioactive-pharma-ltd/ |
| 171478 | Biocon Pharma UK Limited | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/biocon-pharma-uk-limited/ |
| 171585 | Birchwood Medical Practice | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/birchwood-medical-practice/ |
| 171715 | Birtley Medical Group | — | — | website none; careers none | https://www.cqc.org.uk/location/1-570812163 |

### Unresolved examples

- **171243 BIG HEALTHCARE LIMITED** (Stoke-On-Trent): candidate website could not be safely checked: HTTP 404; search lead: https://www.cqc.org.uk/location/1-4522373449
- **171463 Bio Luminuex Health Care Limited** (LONDON): candidate website could not be safely checked: robots.txt disallows this page; search lead: https://www.cqc.org.uk/location/1-4054170060
- **171472 Bioactive Pharma Ltd** (Chichester): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/bioactive-pharma-ltd/
- **171478 Biocon Pharma UK Limited** (London): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/biocon-pharma-uk-limited/
- **171585 Birchwood Medical Practice** (Norwich): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/birchwood-medical-practice/
- **171715 Birtley Medical Group** (Birtley): CQC match supplied no eligible employer website URL; SponsorList had no exact name/location match with an employer website; search lead: https://www.cqc.org.uk/location/1-570812163
- **171718 Birwood Dental Care Limited T/a The Gardens Dental Centre** (London): CQC match supplied no eligible employer website URL; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/birwood-dental-care-limited-ta-the-gardens-dental-centre/
- **171770 Bishopton Medical Practice** (Bishopton): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/bishopton-medical-practice/

## Common failure reasons

- `website_unreachable`: 35
- `robots_or_policy_block`: 52
- `identity_not_confirmed`: 67
- `sponsorlist_no_exact_match`: 213

Specific frequent unresolved notes from this run:

- no unambiguous CQC name/location match — 207
- CQC match supplied no eligible employer website URL — 82
- candidate website could not be safely checked: robots.txt disallows this page — 37
- employer identity was not corroborated on the candidate website — 16
- candidate website could not be safely checked: page exceeds size limit — 3
- candidate website could not be safely checked: HTTP 404 — 2
- candidate website could not be safely checked: getaddrinfo ENOTFOUND dentalcare.ltd.uk — 2
- candidate website could not be safely checked: redirect left the confirmed HTTPS employer domain — 2

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on `sponsor_licence_id`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch3.csv`
- Progress checkpoint (outside deliverables): `/home/runner/workspace/.local/state/healthcare-sponsor-website-batch/batch3-progress.json`
- The script processes exact-Healthcare rows, checkpoints every employer, and supports ranked batch-2 targeting plus prior-batch ID exclusions for later batches.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless `--overwrite` is supplied; in that case the old file is renamed to a timestamped backup first.
