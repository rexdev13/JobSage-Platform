# Healthcare sponsor website enrichment — batch 4

Generated: 2026-09-26T16:08:46.249Z

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

- Batch number: **4**
- Selection mode: **source-order**
- Start position within this selection: **1**
- Batch rows written: **500** (limit 500)
- Previously processed rows excluded: **1500**
- Duplicate sponsor IDs omitted: **0**
- Name/town fallback duplicates omitted: **0**
- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **156**
- Website confidence counts: `high` 102, `medium` 46, `none` 352
- Careers confidence counts: `high` 74, `medium` 13, `none` 413
- ATS mappings: `none` 500
- Lookup source counts: `CQC and cached public-source lookup` 95, `CQC fuzzy_name_town/medium lead` 8, `CQC fuzzy_name_town/medium lead; first-party page identity checked` 4, `CQC location_name/high lead` 10, `CQC location_name/high lead; first-party page identity checked` 1, `CQC provider_name/high lead` 100, `CQC provider_name/high lead; first-party page identity checked` 26, `SponsorList public directory lead` 139, `SponsorList public directory lead; first-party page identity checked` 117
- Lookup outcome categories: `identity_not_confirmed` 90, `robots_or_policy_block` 96, `sponsorlist_no_exact_match` 136, `website_and_careers_verified` 87, `website_unreachable` 30, `website_verified` 61
- Unresolved/failure categories: `identity_not_confirmed` 90, `robots_or_policy_block` 96, `sponsorlist_no_exact_match` 136, `website_unreachable` 30

The exact candidate industry values in this output were: `Healthcare`.

## Selection targeting

- Prior batch CSVs excluded: **3**
- Previous batch files: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch1.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch2.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch3.csv`

## Manual review samples

| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |
| --- | --- | --- | --- | --- | --- |
| 189444 | DIDCOT DENTAL GROUP LTD | https://www.didcotdentalstudio.co.uk/ | — | website medium; careers none | https://www.didcotdentalstudio.co.uk/ |
| 189654 | Dignus Healthcare Limited | https://dignus.group/ | — | website high; careers none | https://dignus.group/ |
| 190057 | Divine Health Services Limited | https://www.divinehealthservices.co.uk/ | https://www.divinehealthservices.co.uk/careers | website high; careers medium | https://www.divinehealthservices.co.uk/ |
| 190742 | Double Crown Healthcare Ltd | https://dccare.uk/ | https://dccare.uk/vacancies | website high; careers high | https://dccare.uk/ |
| 190788 | Dove Dental & Wellbeing Spa | https://dovedentalspa.co.uk/ | — | website high; careers none | https://dovedentalspa.co.uk/ |
| 190846 | Downend Health Group | https://www.downendhealthgroup.com/ | https://www.downendhealthgroup.com/jobs | website high; careers medium | https://www.downendhealthgroup.com/ |
| 189432 | DICE Healthcare LTD | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/dice-healthcare-ltd/ |
| 189434 | Dicefore ltd t/a village pharmacy | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/dicefore-ltd-ta-village-pharmacy/ |
| 189652 | DIGNITY EXPRESS HEALTH CARE LTD | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/dignity-express-health-care-ltd/ |
| 189847 | Direct Healthcare 24 Ltd | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/direct-healthcare-24-ltd/ |
| 189848 | Direct Healthcare Group | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |
| 189969 | Diss Dental Health Centre Limited | — | — | website none; careers none | https://www.cqc.org.uk/location/1-213799036 |

### Unresolved examples

- **189432 DICE Healthcare LTD** (Mansfield): CQC match supplied no eligible employer website URL; candidate website could not be safely checked: robots.txt disallows this page; search lead: https://sponsorlist.co.uk/sponsors/dice-healthcare-ltd/
- **189434 Dicefore ltd t/a village pharmacy** (Pinner): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/dicefore-ltd-ta-village-pharmacy/
- **189652 DIGNITY EXPRESS HEALTH CARE LTD** (COVENTRY): CQC match supplied no eligible employer website URL; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/dignity-express-health-care-ltd/
- **189847 Direct Healthcare 24 Ltd** (London): CQC match supplied no eligible employer website URL; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/direct-healthcare-24-ltd/
- **189848 Direct Healthcare Group** (Caerphilly): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **189969 Diss Dental Health Centre Limited** (Diss): CQC match supplied no eligible employer website URL; SponsorList had no exact name/location match with an employer website; search lead: https://www.cqc.org.uk/location/1-213799036
- **189970 Diss Dental Health Centre Limited** (Diss): CQC match supplied no eligible employer website URL; SponsorList had no exact name/location match with an employer website; search lead: https://www.cqc.org.uk/location/1-213799036
- **190011 DIVAS PHARMA LTD** (,London): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/divas-pharma-ltd/

## Common failure reasons

- `robots_or_policy_block`: 96
- `identity_not_confirmed`: 90
- `sponsorlist_no_exact_match`: 136
- `website_unreachable`: 30

Specific frequent unresolved notes from this run:

- no unambiguous CQC name/location match — 197
- CQC match supplied no eligible employer website URL — 78
- candidate website could not be safely checked: robots.txt disallows this page — 49
- employer identity was not corroborated on the candidate website — 12
- candidate website could not be safely checked: page exceeds size limit — 4
- candidate website could not be safely checked: HTTP 403 — 2
- candidate website could not be safely checked: redirect left the confirmed HTTPS employer domain — 2

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on `sponsor_licence_id`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch4.csv`
- Progress checkpoint (outside deliverables): `/home/runner/workspace/.local/state/healthcare-sponsor-website-batch/batch4-progress.json`
- The script processes exact-Healthcare rows, checkpoints every employer, and supports ranked batch-2 targeting plus prior-batch ID exclusions for later batches.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless `--overwrite` is supplied; in that case the old file is renamed to a timestamped backup first.
