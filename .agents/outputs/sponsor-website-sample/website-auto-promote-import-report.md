# Sponsor website promotion import report

- Audit run: `sponsor-enrichment-dev-2026-09-25-audit-01`
- Mode: **Development-only apply run.**
- Classification: 100 sampled employers; 70 were originally high confidence.
- Decisions: 26 auto-promote, 41 review required, 33 reject.
- Auto-promote rows: 26.
- Website rows updated from blank in development: 19.
- Concurrent website conflicts skipped: 0.
- Employer-site discovery runs: 26; completed successfully: 19; partial: 0; failed: 7.
- Careers URLs found or confirmed during discovery: 2.
- ATS providers detected during discovery: 0; verified ATS mappings after discovery: 0.
- New vacancies inserted: 0.
- Repeat-import verification: not applicable — no vacancies were extracted; duplicate-insert count is 0.

## Guardrails applied

- Only `auto_promote` records were eligible for a website update and targeted discovery.
- `sponsor_licences.website` was updated only when blank; no existing website was overwritten.
- Existing careers URLs and verified ATS mappings were preserved during targeted discovery.
- Direct ATS feeds were only used through the existing verified-mapping discovery path.
- Review/reject records were not imported or crawled. No production data was read or written, and nothing was deployed.
- The existing website-enrichment audit remains the source for original confidence and protected-page evidence; the CSV/JSON classification files retain the decision and its evidence.

## Per-employer discovery

| Employer | Check | Pages | Adverts | Inserted | Updated | Repeat inserts | Careers URL | ATS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aldbourne Nursing Home Ltd. | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Ashburton House Care Home Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Cumloden Manor Nursing Home Ltd | complete | 3 | 0 | 0 | 0 | 0 |  |  |
| DENTAL BEAUTY GROUP LTD | failed | 2 | 0 | 0 | 0 | 0 |  |  |
| Downside House Residential Care Home | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| EDWARD TAYLOR TEXTILES LTD | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| HBC Construction Limited | failed | 1 | 0 | 0 | 0 | 0 |  |  |
| VIRUNDHU RESTAURANT LIMITED | failed | 1 | 0 | 0 | 0 | 0 |  |  |
| Waa Construction Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| B3 Insurance Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Grand Finish Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| INNOVATIVE IT SERVICES LIMITED | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| ASME Engineering Ltd | failed | 2 | 0 | 0 | 0 | 0 | https://www.asmeengineering.co.uk/contact/vacancies.html |  |
| Cortex Engineering Solutions Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Grove Automation | complete | 3 | 0 | 0 | 0 | 0 |  |  |
| KF TECH LTD | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| ROCKFORT ENGINEERING LIMITED | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Seaborn Software Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Solvo.ai Ltd. | complete | 3 | 0 | 0 | 0 | 0 | https://www.solvo.ai/careers.html |  |
| A5 Products Limited | failed | 1 | 0 | 0 | 0 | 0 |  |  |
| ABERDEEN DENTAL CARE LIMITED | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| B&B Singh Construction Ltd | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| BIZ CLEANERS LIMITED | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| BLUE OCEAN RESTAURANT | failed | 1 | 0 | 0 | 0 | 0 |  |  |
| BLUE ORCHID ASPLEY GUISE LTD T/A BLUE ORCHID | failed | 1 | 0 | 0 | 0 | 0 |  |  |
| BLUE WATER FOOD LTD | complete | 2 | 0 | 0 | 0 | 0 |  |  |

## Failed discovery attempts

- **A5 Products Limited:** `[permanent] HTTP 404`
- **ASME Engineering Ltd:** `[permanent] HTTP 404`
- **BLUE OCEAN RESTAURANT:** `[permanent] HTTP 404`
- **BLUE ORCHID ASPLEY GUISE LTD T/A BLUE ORCHID:** `[permanent] HTTP 404`
- **DENTAL BEAUTY GROUP LTD:** `[temporary] robots.txt could not be checked: HTTP 403`
- **HBC Construction Limited:** `[permanent] HTTP 404`
- **VIRUNDHU RESTAURANT LIMITED:** `[permanent] HTTP 404`


