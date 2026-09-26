# Healthcare vacancy source routing — batch 1 (100 sponsor rows)

Generated: 2026-09-26

**Review only.** These classifications are recommendations; no source was imported into JOBSAGE.

## Source and cohort

- Source CSV: `.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`
- The expected source CSV was absent, so it was regenerated with the documented guarded sponsor export. The export was development-only and read-only; it contained 25,349 rows.
- Exact `Healthcare` sponsors in that export: **4,808**.
- Sponsor rows processed: **100**; distinct normalized employer names: **96**. Repeated employer names were retained as separate sponsor rows rather than deduplicated.
- The cohort was selected in source order from exact-Healthcare rows with blank website/careers/ATS fields and no company-site check timestamp; earlier `none`, `low`, or `unverified` website/careers results were prioritized where available.
- All 100 selected rows had blank existing website, careers URL, ATS provider, and ATS board ID fields.
- `sponsor_licence_id` contains JOBSAGE internal sponsor-row IDs, not official licence numbers.

## Routing results

| Pipeline | Sponsor rows |
|---|---:|
| Company website | 9 |
| Job board / ATS | 6 |
| Send CV / recruitment contact | 4 |
| Unverified / rejected | 81 |
| **Total** | **100** |

### Job board / ATS provider breakdown

| Provider or portal | Rows |
|---|---:|
| Accord Healthcare careers portal (underlying platform unconfirmed) | 2 |
| SAP SuccessFactors | 3 |
| SmartRecruiters | 1 |

Counts are sponsor rows. The two Accord records are duplicate sponsor rows for the same employer portal; no unsupported platform name was assigned.

## Confidence and import recommendation

| Confidence | Rows | Import recommendation |
|---|---:|---|
| High | 18 | `yes_high_confidence` |
| Medium | 1 | `review_medium_confidence` |
| Low | 0 | `no_low_confidence` |
| Unverified | 81 | `no_unverified` |

- Safe to import immediately, after the normal review gate: **18**.
- Needs manual review: **1**. This is Abundant Graze Ltd T/A ACH Healthcare (Bicester): the careers page shows Cambridge recruitment, so confirm its legal-entity and Bicester connection first.
- No low-confidence result was retained as a possible import. Unverified items remain non-importable.

## Common failure reasons

- No employer-specific careers, vacancy, recruitment, or CV route verified: 36 (`not_found`).
- Employer identity mismatch or lookalike source: 11 (`identity_mismatch`).
- Source page unavailable or blocked, or no current hiring route could be fetched: 7 (`unreachable`).
- Regulator or sponsor directory only, with no employer hiring route: 3 (`directory_only`).
- Other insufficient evidence, including stale/closed listings or unclear links to the sponsor: 24 (`unverified`).
- Generic contact forms without any recruitment or CV instruction were not treated as Send CV sources.

## Example verified sources

### Company website pipeline

- [4 Ways Healthcare — Work For Us](https://4waysdiagnostics.co.uk/work-for-us): first-party careers page with current vacancies; it links to a [Digital Marketing Executive listing](https://uk.indeed.com/job/digital-marketing-executive-b546fae9175ff857).
- [5 Star Clinic — Work with Us](https://www.5starclinicltd.com/work-with-us): first-party page links to role pages, including a [Physiotherapist job offer](https://myfu.5starclinicltd.com/job-hiring-page-physiotherapist).
- [Acme Pharma — Careers](https://www.acmepharma.co.uk/Careers.html): first-party careers page, with the employer contact page corroborating Welwyn Garden City.
- [Active Healthcare Services — Working for Us](https://activehealthcare.org.uk/working-for-us): first-party recruitment page; employer contact details corroborate Livingston, West Lothian.

### Job board / ATS pipeline

- [A&U Dental Surgeries on SmartRecruiters](https://careers.smartrecruiters.com/audentalsurgeriesltd), with a [Social Media Manager listing](https://jobs.smartrecruiters.com/audentalsurgeriesltd/743999871763296-social-media-manager). The employer identity matches the sponsor; the company careers page also links to hiring routes.
- [Accord Healthcare careers portal](https://www.intasaccordcareers.com/accordemena/): official UK careers page links to a portal with keyword, location, category, and country filters. The underlying platform was not confirmed.
- [ADVANZ PHARMA careers search](https://careers.advanzpharma.com/viewalljobs?locale=en_US) and [AGFA careers](https://careers.agfa.com/): structured SAP SuccessFactors job-search pages. The ADVANZ page is global; no UK-specific sample vacancy was retained.

### Send CV / recruitment contact pipeline

- [360 Degrees Healthcare — Send Us Your CV](https://www.360degreeshealthcare.co.uk/send-us-your-cv/): explicitly invites job applications and gives the Nelson office address and telephone route.
- [Absolute Healthcare Providers — Careers](https://absolute-healthcare.co.uk/careers): tells applicants to email their CV to the employer recruitment address.
- [Advance Dental Care — Job Vacancies](https://advance-dental-care.co.uk/job-vacancies): lists an Associate Dentist vacancy and explicitly requests emailed CVs.
- [Ace24 Healthcare — Contact Us](https://www.ace24healthcare.com/contact-us): explicitly invites people seeking care-sector work to ask about current vacancies and request an application form.

## Example rejected or unverified sources

- **360 Degrees Clinic Ltd (Surrey):** a SmartRecruiters NP/PA ad was for Anaheim, California and a different employer. The ATS result was rejected as an identity mismatch.
- **3D’s Healthcare Services Ltd:** its first-party page had only a generic contact form and did not mention recruitment, applications, or CVs; it was not accepted as Send CV.
- **ZVF Pharma Ltd (Slough):** the fetched careers result identified Zavian Pharma Pvt Ltd, not the sponsor; no reliable identity match was found.
- **Abbey House Medical Practice:** the NHS Jobs result was explicitly closed, so it was retained as historical evidence only and not classified as an importable vacancy source.

## Recommendation

**Yes: replace the previous single-output discovery behavior with a multi-route classification step, while keeping any existing importer as a downstream, review-gated step.** This batch found useful sources across company careers pages, structured boards, and direct CV/contact routes; a single website/careers output would lose that distinction. Import only high-confidence routes after the normal review gate, manually review the one medium-confidence row, and keep unverified evidence out of the import path.

## Safety and file handling

- Research was performed in four 25-sponsor batches. Accepted sources were fetched and checked for employer identity and location; search snippets and generic directories alone were not treated as proof.
- No production data was changed, no database write or import was performed, and no deployment occurred.
- Both requested artifact paths were absent before writing; neither existing output was overwritten.
- The CSV contains one row per selected sponsor record and preserves evidence/notes for rejected findings so they can be reviewed without importing them.
