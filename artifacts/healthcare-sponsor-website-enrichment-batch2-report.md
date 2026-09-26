# Healthcare sponsor website enrichment — batch 2

Generated: 2026-09-26T15:06:41.521Z

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
- Selection keeps sponsor IDs distinct; missing-ID fallback keys normalize employer name plus town/city. Batch 2 ranks unique employer names, town/city presence, care-home/clinic/medical/dental/surgery terms, and town/county clues. Employer names associated with a batch-1 robots block or unreachable-site error are excluded. Source order is the final tie-breaker.

## Enrichment sources and evidence rules

- CQC directory lead file: `/home/runner/workspace/scripts/data/cache/cqc-directory-2026-09-14.csv` (96,394 parsed records; cached source produced 2026-09-09, filename dated 2026-09-14). The CQC location page is recorded as a source lead, not as proof that the CQC listing is the employer website.
- SponsorList's published public sponsor-search API was queried for unresolved rows without a CQC website candidate. Results were matched on exact normalized employer name and town/county; its website field and profile URL remain leads only.
- Employer website claims are accepted only after a safe HTTPS fetch through the existing public-site fetcher and a direct first-party page identity check. The first-party page URL is the website evidence URL. CQC, SponsorList, and search results alone are never promoted.
- Careers URLs are accepted only when directly linked from the verified employer homepage or found at a conventional employer-hosted path, and the destination fetch succeeds. ATS mappings are limited to explicit Ashby, Greenhouse, or Lever board links and keep the employer-page link as mapping evidence.
- Web search was exercised on two initial records (ZVF PHARMA LTD / Slough and AZAAN HEALTHCARE (DUNDEE) LTD / Dundee). Results were directory/company-profile leads or unrelated similarly named organizations; no search result was accepted as an official URL. No Bing search API key was configured for the standalone resumable script; search-based discoveries remain available by supplying BING_SEARCH_API_KEY later.
- Public-site fetching honors HTTPS, public-DNS, same-site redirect, robots.txt, page-size, timeout, pacing, and bounded retry checks.

## Batch results

- Batch number: **2**
- Selection mode: **targeted-healthcare-location**
- Start position within this selection: **1**
- Batch rows written: **500** (limit 500)
- Previously processed rows excluded: **500**
- Duplicate sponsor IDs omitted: **0**
- Name/town fallback duplicates omitted: **0**
- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **156**
- Website confidence counts: `high` 98, `medium` 22, `none` 380
- Careers confidence counts: `high` 25, `medium` 9, `none` 466
- ATS mappings: `none` 500
- Lookup source counts: `CQC and cached public-source lookup` 96, `CQC fuzzy_name_town/medium lead` 8, `CQC fuzzy_name_town/medium lead; first-party page identity checked` 4, `CQC location_name/high lead` 44, `CQC location_name/high lead; first-party page identity checked` 12, `CQC provider_name/high lead` 120, `CQC provider_name/high lead; first-party page identity checked` 18, `SponsorList public directory lead` 112, `SponsorList public directory lead; first-party page identity checked` 86
- Lookup outcome categories: `identity_not_confirmed` 103, `robots_or_policy_block` 73, `sponsorlist_no_exact_match` 178, `website_and_careers_verified` 34, `website_unreachable` 26, `website_verified` 86
- Unresolved/failure categories: `identity_not_confirmed` 103, `robots_or_policy_block` 73, `sponsorlist_no_exact_match` 178, `website_unreachable` 26

The exact candidate industry values in this output were: `Healthcare`.

## Selection targeting

- Remaining rows after excluding processed IDs: **4266**
- Rows excluded because their normalized employer name had a batch-1 robots/unreachable result: **0**
- Prior failure employer names excluded: **97**
- Remaining unique employer-name rows: **4007**
- Remaining rows with a town/city: **4266**
- Care-home/clinic/medical/dental/surgery name rows: **1212**
- Employer names containing their town or county: **421**
- Rows meeting all four focus signals: **131**
- Selected rows meeting all four focus signals: **131**

## Manual review samples

| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |
| --- | --- | --- | --- | --- | --- |
| 173513 | Bourne Dental Practice | https://www.bournedentalpractice.co.uk/ | — | website high; careers none | https://www.bournedentalpractice.co.uk/ |
| 174436 | Brighton Implant Clinic Limited | https://www.brightonimplantclinic.co.uk/ | — | website high; careers none | https://www.brightonimplantclinic.co.uk/ |
| 174818 | Brixham Dental Practice Ltd | https://www.brixhamdental.co.uk/ | — | website high; careers none | https://www.brixhamdental.co.uk/ |
| 176565 | Caistor Health Centre | https://www.caistorhealthcentre.co.uk/ | — | website high; careers none | https://www.caistorhealthcentre.co.uk/ |
| 178145 | CARRICKMORE HEALTH CENTRE | https://www.carrickmorehealthcentre.co.uk/ | — | website high; careers none | https://www.carrickmorehealthcentre.co.uk/ |
| 180635 | Chiropractic Clinic Eastcote | https://www.healthyspine.co.uk/ | https://www.healthyspine.co.uk/Page.aspx?I=1053 | website high; careers high | https://www.healthyspine.co.uk/ |
| 171193 | Bideford Medical Centre | — | — | website none; careers none | https://www.cqc.org.uk/location/1-553978509 |
| 172143 | Blairgowrie Physiotherapy and Sports Injury Clinic Ltd | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/blairgowrie-physiotherapy-and-sports-injury-clinic-ltd/ |
| 174313 | Bridport Medical Centre | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/bridport-medical-centre/ |
| 174330 | Brigg and Bargate chiropractic clinic Ltd | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/brigg-and-bargate-chiropractic-clinic-ltd/ |
| 174437 | BRIGHTON IMPLANT CLINIC LIMITED (WORTHING) | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/brighton-implant-clinic-limited-worthing/ |
| 174444 | Brighton Physiotherapy Clinic | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/brighton-physiotherapy-clinic/ |

### Unresolved examples

- **171193 Bideford Medical Centre** (Bideford): candidate website could not be safely checked: page exceeds size limit; search lead: https://www.cqc.org.uk/location/1-553978509
- **172143 Blairgowrie Physiotherapy and Sports Injury Clinic Ltd** (Blairgowrie): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/blairgowrie-physiotherapy-and-sports-injury-clinic-ltd/
- **174313 Bridport Medical Centre** (Bridport): CQC match supplied no eligible employer website URL; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/bridport-medical-centre/
- **174330 Brigg and Bargate chiropractic clinic Ltd** (Brigg): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/brigg-and-bargate-chiropractic-clinic-ltd/
- **174437 BRIGHTON IMPLANT CLINIC LIMITED (WORTHING)** (Worthing): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/brighton-implant-clinic-limited-worthing/
- **174444 Brighton Physiotherapy Clinic** (Brighton): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/brighton-physiotherapy-clinic/
- **174571 Bristol Fertility Clinic** (BRISTOL): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/bristol-fertility-clinic/
- **175198 Brundall Dental Practice** (Brundall): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none

## Common failure reasons

- `website_unreachable`: 26
- `identity_not_confirmed`: 103
- `sponsorlist_no_exact_match`: 178
- `robots_or_policy_block`: 73

Specific frequent unresolved notes from this run:

- no unambiguous CQC name/location match — 158
- CQC match supplied no eligible employer website URL — 132
- candidate website could not be safely checked: robots.txt disallows this page — 52
- employer identity was not corroborated on the candidate website — 18
- candidate website could not be safely checked: redirect left the confirmed HTTPS employer domain — 4

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on `sponsor_licence_id`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch2.csv`
- Progress checkpoint (outside deliverables): `/home/runner/workspace/.local/state/healthcare-sponsor-website-batch/batch2-progress.json`
- The script processes exact-Healthcare rows, checkpoints every employer, and supports ranked batch-2 targeting plus prior-batch ID exclusions for later batches.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless `--overwrite` is supplied; in that case the old file is renamed to a timestamped backup first.
