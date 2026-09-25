# Sponsor website approval candidate set

Generated from development-only read queries and existing review outputs on 2026-09-25. No database writes, production reads, deployment, or vacancy crawl were performed.

## Result

- Cumulative reviewable candidate sets: 100, 500, and 1,000 distinct employer names, with one canonical sponsor licence ID per name and sibling IDs retained in the related-ID field.
- High-confidence auto-approved employers: **29** (26 from the existing audited 26-employer set; 3 additional verified ATS mappings with same-host employer evidence).
- Review-required in the 1,000 set: **971**. Rejected candidates kept separate: **33**. Rejected candidates are excluded from all rollout cohorts.
- The 100-employer rollout was not run: 29 approved employers is below the required 100. Therefore 500/1,000 rollouts were also not run.

## Candidate-set summary

| Set | Employers | Auto-approved | Review-required | Careers URLs | Verified ATS mappings | Website-only | Employers with live verified company-site vacancies |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 29 | 71 | 48 | 4 | 52 | 30 |
| 500 | 500 | 29 | 471 | 275 | 4 | 219 | 151 |
| 1000 | 1000 | 29 | 971 | 434 | 4 | 523 | 188 |

## Auto-approved employers by sector

- Construction: 3
- Engineering: 5
- Finance: 1
- Healthcare / social care: 6
- Hospitality: 2
- Manufacturing: 1
- Other: 3
- Technology: 4
- Unclassified: 4

## Sector coverage in the 1,000 candidates

- Construction: 29
- Education: 9
- Engineering: 17
- Finance: 20
- Healthcare / social care: 63
- Hospitality: 29
- Legal & professional: 20
- Manufacturing: 11
- Other: 691
- Retail: 14
- Technology: 32
- Transport: 19
- Unclassified: 46

## Review-required reason categories in the 1,000 candidates

- no_current_identity_audit: 831
- multiple_licence_ids: 96
- prior_audit_review_required: 41
- ats_evidence_not_first_party: 1
- name_or_licence_duplicates_need_resolution: 1
- multiple_website_hosts: 1

## Existing development evidence inspected

- Sponsor register: 142,921 rows; 1,676 have a saved website.
- Company-site checks: 1,542 rows across 1,539 organisation names; 429 saved careers URLs; 4 verified ATS mapping rows across 4 organisation names; 31 checks report positive advert counts.
- Vacancy table: 6,529 stored vacancy rows; 2,261 live, verified company-site roles across 955 organisation names; 406 of those live roles have structured company-vacancy evidence.
- Existing 100-employer enrichment classification: 26 auto-promote, 41 review-required, and 33 rejected.
- Three additional unique employers (Pliant Payments, 59 Studio, Vertical Aerospace) have a persisted verified ATS provider/board mapping and same-host employer-site evidence. The 9fin mapping is retained as review-required because its stored mapping evidence URL is on the ATS host, not the employer website.

## Why the rollout is still blocked

The candidate volume is sufficient for review cohorts, but not for rollouts. Of 1,000 candidates, 971 still require review because stored sponsor websites, careers URLs, company-site checks, or vacancy evidence alone do not establish approved employer-domain identity. Most new candidates have no current identity audit; 41 retain the prior audit's explicit review decisions; additional rows are held for multiple licence IDs, website hosts, or ATS evidence that is not same-site. The 33 known rejections are separated; 18 of those rows had no evidence URL in the source audit and are explicitly marked unavailable in the CSV. No candidate was approved based on name similarity alone.

Fastest existing source to close the gap: review the 429 stored careers URLs against the saved employer website, starting with the 1,542 company-site checks and 2,261 live verified company-site vacancy records. The 406 live roles with structured company-vacancy evidence are especially useful for confirming first-party role pages. Keep a row review-required unless employer ownership and any licence/site conflict are resolved.

## Files

- candidate-set-100.csv, candidate-set-500.csv, candidate-set-1000.csv: cumulative balanced candidate cohorts; only auto-approved and review-required rows.
- auto-approved.csv, review-required.csv, rejected.csv: full status-separated lists.

No production data was queried or written, and nothing was deployed.

Sector values in each CSV are normalized for review; the original source value is retained in source_sector_value.
