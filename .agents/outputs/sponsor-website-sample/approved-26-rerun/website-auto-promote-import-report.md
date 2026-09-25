# Sponsor website promotion import report

- Audit run: `sponsor-enrichment-dev-2026-09-25-audit-01`
- Mode: **Development-only apply run.**
- Sample scope: previously_auto_promote_26_mixed_sectors.
- Classification: 26 sampled employers; 26 were originally high confidence.
- Decisions: 26 auto-promote, 0 review required, 0 reject.
- Auto-promote rows: 26.
- Website rows updated from blank in development: 0.
- Concurrent website conflicts skipped: 0.
- Employer-site discovery runs: 26; completed successfully: 24; partial: 0; failed: 2.
- Careers URLs found or confirmed during discovery: 10.
- ATS providers detected during discovery: 1; verified ATS mappings after discovery: 0.
- New vacancies inserted: 0.
- Repeat-import verification: 1 non-empty vacancy batch(es) repeated; 0 duplicate inserts.

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
| Aldbourne Nursing Home Ltd. | complete | 5 | 0 | 0 | 0 | 0 | https://aldbournenursinghome.com/volunteer |  |
| Ashburton House Care Home Ltd | complete | 3 | 0 | 0 | 0 | 0 |  |  |
| Cumloden Manor Nursing Home Ltd | failed | 1 | 0 | 0 | 0 | 0 | https://cumlodenmanor.co.uk/careers |  |
| DENTAL BEAUTY GROUP LTD | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| Downside House Residential Care Home | complete | 3 | 0 | 0 | 0 | 0 | https://www.downsidehouseresidentialcarehome.co.uk/careers |  |
| EDWARD TAYLOR TEXTILES LTD | complete | 2 | 0 | 0 | 0 | 0 |  |  |
| HBC Construction Limited | complete | 3 | 0 | 0 | 0 | 0 | https://www.hbcconstruction.co.uk/careers |  |
| VIRUNDHU RESTAURANT LIMITED | complete | 1 | 0 | 0 | 0 | 0 |  |  |
| Waa Construction Ltd | failed | 5 | 0 | 0 | 0 | 0 |  |  |
| B3 Insurance Ltd | complete | 5 | 0 | 0 | 0 | 0 |  |  |
| Grand Finish Ltd | complete | 6 | 0 | 0 | 0 | 0 |  |  |
| INNOVATIVE IT SERVICES LIMITED | complete | 3 | 0 | 0 | 0 | 0 | https://innovativeitservices.co.uk/career |  |
| ASME Engineering Ltd | complete | 2 | 0 | 0 | 0 | 0 | https://www.asmeengineering.co.uk/contact/vacancies.html |  |
| Cortex Engineering Solutions Ltd | complete | 3 | 0 | 0 | 0 | 0 |  |  |
| Grove Automation | complete | 3 | 0 | 0 | 0 | 0 |  |  |
| KF TECH LTD | complete | 6 | 0 | 0 | 0 | 0 |  |  |
| ROCKFORT ENGINEERING LIMITED | complete | 2 | 2 | 0 | 2 | 0 | https://www.rockfortengineering.com/careers/vehicle-systems-engineer |  |
| Seaborn Software Ltd | complete | 5 | 0 | 0 | 0 | 0 |  |  |
| Solvo.ai Ltd. | complete | 3 | 0 | 0 | 0 | 0 | https://www.solvo.ai/careers.html |  |
| A5 Products Limited | complete | 1 | 0 | 0 | 0 | 0 |  |  |
| ABERDEEN DENTAL CARE LIMITED | complete | 3 | 0 | 0 | 0 | 0 |  |  |
| B&B Singh Construction Ltd | complete | 6 | 0 | 0 | 0 | 0 |  |  |
| BIZ CLEANERS LIMITED | complete | 5 | 0 | 0 | 0 | 0 |  |  |
| BLUE OCEAN RESTAURANT | complete | 1 | 0 | 0 | 0 | 0 |  |  |
| BLUE ORCHID ASPLEY GUISE LTD T/A BLUE ORCHID | complete | 1 | 0 | 0 | 0 | 0 |  |  |
| BLUE WATER FOOD LTD | complete | 2 | 0 | 0 | 0 | 0 |  |  |

## Per-employer site diagnosis

| Employer | Homepage | Careers evidence | Robots / sitemap | ATS evidence | Vacancy signals | Rejected careers links |
| --- | --- | --- | --- | --- | --- | --- |
| Aldbourne Nursing Home Ltd. | fetched (200) | https://aldbournenursinghome.com/careers (200) | allowed for fetched URL paths (robots policy passed); 2 sitemap document(s) | none detected | no structured vacancy evidence | Work with us — non-vacancy careers utility or policy page; Become a Volunteer — non-vacancy careers utility or policy page |
| Ashburton House Care Home Ltd | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 2 sitemap document(s) | none detected | no structured vacancy evidence | none |
| Cumloden Manor Nursing Home Ltd | fetched (200) | https://cumlodenmanor.co.uk/careers (not fetched / timeout) | allowed for fetched URL paths (robots policy passed); sitemap not checked | none detected | no structured vacancy evidence | none |
| DENTAL BEAUTY GROUP LTD | fetched (200) | https://careers.dentalbeautypartners.co.uk/ (not fetched) | allowed for fetched URL paths (robots policy passed); 1 sitemap document(s) | Pinpoint: unsupported Pinpoint platform recorded but not crawled or imported | no structured vacancy evidence | none |
| Downside House Residential Care Home | fetched (200) | https://www.downsidehouseresidentialcarehome.co.uk/careers (200) | allowed for fetched URL paths (robots policy passed); 1 sitemap document(s) | none detected | no structured vacancy evidence | none |
| EDWARD TAYLOR TEXTILES LTD | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 1 sitemap document(s) | none detected | no structured vacancy evidence | none |
| HBC Construction Limited | fetched (200) | https://www.hbcconstruction.co.uk/careers (200) | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | Job description — news, blog, press, or other editorial destination; Job description — news, blog, press, or other editorial destination; Job description — news, blog, press, or other editorial destination |
| VIRUNDHU RESTAURANT LIMITED | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | none |
| Waa Construction Ltd | fetched (200) | https://waaconstructionltd.co.uk/career (200) | allowed for fetched URL paths (robots policy passed); 2 sitemap document(s) | none detected | no structured vacancy evidence | Job Application — non-vacancy careers utility or policy page; Job Application — non-vacancy careers utility or policy page; Job Application — non-vacancy careers utility or policy page |
| B3 Insurance Ltd | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 4 sitemap document(s) | none detected | no structured vacancy evidence | none |
| Grand Finish Ltd | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 5 sitemap document(s) | none detected | no structured vacancy evidence | none |
| INNOVATIVE IT SERVICES LIMITED | fetched (200) | https://innovativeitservices.co.uk/career (200) | allowed for fetched URL paths (robots policy passed); 1 sitemap document(s) | none detected | no structured vacancy evidence | none |
| ASME Engineering Ltd | fetched (200) | https://www.asmeengineering.co.uk/compliance/equal-opportunities.html (200) | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | none |
| Cortex Engineering Solutions Ltd | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 2 sitemap document(s) | none detected | no structured vacancy evidence | none |
| Grove Automation | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 2 sitemap document(s) | none detected | no structured vacancy evidence | none |
| KF TECH LTD | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 5 sitemap document(s) | none detected | no structured vacancy evidence | none |
| ROCKFORT ENGINEERING LIMITED | fetched (200) | https://www.rockfortengineering.com/careers (200) | allowed for fetched URL paths (robots policy passed); sitemap not checked | none detected | 1 vacancy-like page(s) | none |
| Seaborn Software Ltd | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 4 sitemap document(s) | none detected | no structured vacancy evidence | none |
| Solvo.ai Ltd. | fetched (200) | https://www.solvo.ai/careers (200) | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | none |
| A5 Products Limited | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | none |
| ABERDEEN DENTAL CARE LIMITED | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 2 sitemap document(s) | none detected | no structured vacancy evidence | none |
| B&B Singh Construction Ltd | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 5 sitemap document(s) | none detected | no structured vacancy evidence | none |
| BIZ CLEANERS LIMITED | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 4 sitemap document(s) | none detected | no structured vacancy evidence | none |
| BLUE OCEAN RESTAURANT | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | none |
| BLUE ORCHID ASPLEY GUISE LTD T/A BLUE ORCHID | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 0 sitemap document(s) | none detected | no structured vacancy evidence | none |
| BLUE WATER FOOD LTD | fetched (200) | not found | allowed for fetched URL paths (robots policy passed); 1 sitemap document(s) | none detected | no structured vacancy evidence | none |

Full fetch/link/ATS diagnostics are included in the classification JSON output.



## Failed or partial discovery attempts

- **Cumloden Manor Nursing Home Ltd (failed):** [temporary] request timed out
- **Waa Construction Ltd (failed):** [temporary] hostname is paced or in backoff

