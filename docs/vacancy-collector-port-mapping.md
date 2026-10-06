# Vacancy collector port mapping

## Destination and operational path

- Keep `sponsor_licence_vacancies` as the single vacancy store and write through `upsertSharedBoardVacancies`; do not add a second listings table.
- Run bulk feeds only through the protected internal vacancy-job runner. Use `vacancy_sync_log.job_kind` and `metrics` for run history. The current schema has no durable per-feed cursor/circuit-breaker state or source-specific sighting records, so add only those operational/provenance records if required for safe resume, cross-source deduplication, and complete-sweep missing checks.
- Existing company-site feeds already support Ashby, Greenhouse, Lever, SmartRecruiters, Recruitee, Personio, Pinpoint, and the restricted Circle Workday mapping. Reuse that path rather than adding duplicate ATS parsers.

## Source mapping

- NHS Jobs and Teaching Vacancies have employer-scoped clients today, not the reference’s nationwide collectors. Port bulk paging into the existing board pipeline. NHS uses XML `sort=publicationDateAsc`; Teaching Vacancies uses its JSON list plus sitemap reconciliation and per-listing JSON.
- Arbeitnow, Jobicy, and Himalayas are new public-board adapters. Do not add DWP Find a Job, Remotive, or a generic SmartRecruiters feed.
- The reference ATS file contains 49 employer/slug pairs but no first-party evidence URLs. Treat these as mapping candidates only: import through the existing direct-feed path when the sponsor row is uniquely identified and its stored ATS mapping is verified and matches the configured provider/board. Use the existing discovery-and-review flow otherwise.
- Resolve every bulk-board employer to one exact sponsor-register organisation before writing it. The candidate vacancy mapper treats these rows as sponsor vacancies; non-sponsor or ambiguous employer names must be counted and rejected, not shown as confirmed sponsors.

## Live feed-shape checks

Checked the public endpoints on 2026-10-06. NHS Jobs currently returns XML listings on `beta.jobs.nhs.uk`; Teaching Vacancies returns the expected `data`, `links`, and `meta` JSON fields; Arbeitnow listing URLs can include `/jobs/companies/{company}/{slug}`; Jobicy returns numeric IDs and a `nextCursor`; Himalayas uses cursor pagination and listing paths such as `/companies/{company}/jobs/{slug}`. The adapters validate these response structures and the URL policy accepts only their specific advert paths.

## Field mapping

| Collector field | JOBSAGE storage |
| --- | --- |
| `employer`, `title` | `organisation_name`, `title` |
| source/provider and `externalId` | source observation identity; shared row `board_name`, `external_listing_id` |
| listing URL, apply URL | `url`, `application_url` |
| locations | `location` as a readable joined value; preserve the full list and country in source metadata |
| salary, description, posted date, closing date | `salary`, `description`, `posted_date`, `closes_at` |
| country, remote, employment type, category/sector evidence, sponsorship evidence, parser version, raw hash | source metadata; these have no equivalent typed columns today |

Do not put raw vacancy locations into `target_regions`; that field represents candidate targeting. Sponsor-register membership identifies an employer only and is not vacancy sponsorship evidence. Keep sponsorship unknown unless the individual advert supplies explicit evidence.

## Visibility and safety

Candidate vacancy queries require the existing live-link and 48-hour verification gates, enforce closing dates and source-missing state, and apply stricter evidence rules to company-site rows. New imports must use the existing liveness queue and must not weaken those checks. The company-site HTTP client protects existing ATS hosts; new public-board hosts need explicit allowlisting while retaining HTTPS, DNS/SSRF, redirects, robots policy, pacing, deadlines, retries, and response-size limits.
