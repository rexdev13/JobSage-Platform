# Healthcare sponsor website enrichment — batch 5

Generated: 2026-09-26T16:36:27.424Z

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

- Batch number: **5**
- Selection mode: **source-order**
- Start position within this selection: **1**
- Batch rows written: **500** (limit 500)
- Previously processed rows excluded: **2000**
- Duplicate sponsor IDs omitted: **0**
- Name/town fallback duplicates omitted: **0**
- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **156**
- Website confidence counts: `high` 83, `medium` 30, `none` 387
- Careers confidence counts: `high` 40, `medium` 10, `none` 450
- ATS mappings: `none` 500
- Lookup source counts: `CQC and cached public-source lookup` 140, `CQC fuzzy_name_town/medium lead` 7, `CQC fuzzy_name_town/medium lead; first-party page identity checked` 5, `CQC location_name/high lead` 28, `CQC location_name/high lead; first-party page identity checked` 4, `CQC provider_name/high lead` 98, `CQC provider_name/high lead; first-party page identity checked` 20, `SponsorList public directory lead` 114, `SponsorList public directory lead; first-party page identity checked` 84
- Lookup outcome categories: `identity_not_confirmed` 91, `robots_or_policy_block` 61, `sponsorlist_no_exact_match` 209, `website_and_careers_verified` 50, `website_unreachable` 26, `website_verified` 63
- Unresolved/failure categories: `identity_not_confirmed` 91, `robots_or_policy_block` 61, `sponsorlist_no_exact_match` 209, `website_unreachable` 26

The exact candidate industry values in this output were: `Healthcare`.

## Selection targeting

- Prior batch CSVs excluded: **4**
- Previous batch files: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch1.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch2.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch3.csv`, `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch4.csv`

## Manual review samples

| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |
| --- | --- | --- | --- | --- | --- |
| 210063 | Heart Link Health Care Services Ltd | https://heart-link.co.uk/ | https://heart-link.co.uk/join-us/ | website high; careers high | https://heart-link.co.uk/ |
| 210224 | Hebe Healthcare Limited | https://hebecare.co.uk/ | https://hebecare.co.uk/careers/ | website high; careers high | https://hebecare.co.uk/ |
| 210342 | Hellesdon Medical Practice | https://hellesdonmedicalpractice.co.uk/ | — | website high; careers none | https://hellesdonmedicalpractice.co.uk/ |
| 210621 | Heronsgate Dental & Facial | https://www.heronsgatedental.co.uk/ | — | website medium; careers none | https://www.heronsgatedental.co.uk/ |
| 210723 | Hexagon Pharma Limited | https://hexagonpharma.co.uk/ | — | website high; careers none | https://hexagonpharma.co.uk/ |
| 210735 | HEXPRESS HEALTHCARE LIMITED | https://www.hexpresshealthcare.com/ | https://www.hexpresshealthcare.com/career.html | website high; careers high | https://www.hexpresshealthcare.com/ |
| 209991 | HEALTHCARE-2-U LIMITED | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |
| 210009 | Healthside Pharmacy | — | — | website none; careers none | https://sponsorlist.co.uk/sponsors/healthside-pharmacy/ |
| 210018 | Healthxchange Pharmacy UK Limited | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |
| 210026 | HEALTHY CHOICE PHARMA LTD | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |
| 210045 | heanor dental care | — | — | website none; careers none | no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website |
| 210091 | Hearts First Ambulance Medical Limited | — | — | website none; careers none | https://www.cqc.org.uk/location/1-25530342628 |

### Unresolved examples

- **209991 HEALTHCARE-2-U LIMITED** (Edinburgh): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **210009 Healthside Pharmacy** (LONDON): no unambiguous CQC name/location match; employer identity was not corroborated on the candidate website; search lead: https://sponsorlist.co.uk/sponsors/healthside-pharmacy/
- **210018 Healthxchange Pharmacy UK Limited** (London): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **210026 HEALTHY CHOICE PHARMA LTD** (Dewsbury): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **210045 heanor dental care** (derby): no unambiguous CQC name/location match; SponsorList had no exact name/location match with an employer website; search lead: none
- **210091 Hearts First Ambulance Medical Limited** (Radlett): candidate website could not be safely checked: page exceeds size limit; search lead: https://www.cqc.org.uk/location/1-25530342628
- **210092 Hearts First Ambulance Service Ltd** (RADLETT): candidate website could not be safely checked: page exceeds size limit; search lead: https://www.cqc.org.uk/location/1-3888336330
- **210099 Heartwood Medical Practice** (Swadlincote): candidate website could not be safely checked: robots.txt disallows this page; search lead: https://www.cqc.org.uk/location/1-606200657

## Common failure reasons

- `sponsorlist_no_exact_match`: 209
- `identity_not_confirmed`: 91
- `website_unreachable`: 26
- `robots_or_policy_block`: 61

Specific frequent unresolved notes from this run:

- no unambiguous CQC name/location match — 223
- CQC match supplied no eligible employer website URL — 100
- candidate website could not be safely checked: robots.txt disallows this page — 34
- employer identity was not corroborated on the candidate website — 13
- candidate website could not be safely checked: page exceeds size limit — 3
- candidate website could not be safely checked: redirect left the confirmed HTTPS employer domain — 2
- employer name has no distinctive identity token — 2

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on `sponsor_licence_id`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch5.csv`
- Progress checkpoint (outside deliverables): `/home/runner/workspace/.local/state/healthcare-sponsor-website-batch/batch5-progress.json`
- The script processes exact-Healthcare rows, checkpoints every employer, and supports ranked batch-2 targeting plus prior-batch ID exclusions for later batches.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless `--overwrite` is supplied; in that case the old file is renamed to a timestamped backup first.
