# JobSage vacancy pipeline handoff

## Current measured export

Measured from the local Postgres database before export:

- 143,177 licensed sponsors
- 13,400 vacancies
- 1,542 published employer emails
- 5,476 employer websites
- 589 verified ATS board mappings in the previous extract; new discovery runs continue independently

The SQL files in this branch are data-only exports of the existing production tables:

- `jobsage_seeds.sql.gz`: `sponsor_licences`
- `jobsage_vacancies.sql.gz`: `sponsor_licence_company_site_checks` and `sponsor_licence_vacancies`

They import as ordinary rows. There is no hardcoded vacancy path, special source, or fixture flag.

## Sector × application mode

| Sector | Job board | Company site | Send-CV email |
|---|---:|---:|---:|
| Education | 4,768 | 59 | 120 |
| Public Services | 4,203 | 0 | 190 |
| Healthcare | 2,679 | 99 | 63 |
| Technology | 1,300 | 1,111 | 197 |
| Social Care | 434 | 4 | 194 |
| Media & Creative | 412 | 276 | 64 |
| Finance | 179 | 360 | 52 |
| Legal & Professional | 185 | 196 | 131 |
| Engineering | 105 | 191 | 31 |
| Services | 152 | 24 | 50 |
| Recruitment | 139 | 96 | 20 |
| Retail | 110 | 38 | 85 |
| Hospitality | 94 | 53 | 58 |
| Energy | 76 | 17 | 10 |
| Security | 65 | 0 | 11 |
| Manufacturing | 55 | 53 | 34 |
| Transport | 39 | 69 | 45 |
| Construction | 26 | 46 | 67 |
| Property | 22 | 5 | 17 |
| Beauty | 18 | 2 | 7 |
| Faith | 16 | 0 | 0 |
| Agriculture | 11 | 0 | 6 |
| Unlabeled | 244 | 12 | 90 |

Job-board and company-site counts total 13,400. Send-CV email counts are sponsors with a published contact email, not vacancy rows.

## What is running on Devin

- Jooble and Adzuna aggregator sweeps, with employer matching and deduplication.
- Keyless Brave → Bing website discovery, weak sectors first.
- Published-email contact enrichment; no guessed addresses.
- Verified ATS feed harvesting and site-evidence discovery.
- Probe/liveness maintenance and sector drains.
- Teamtailor slug-guess sweep completed with zero verified boards in that pass; the adapter remains enabled for future site-evidence discoveries.
- iCIMS adapter is enabled but tenant feeds are provider-specific; only valid advert feeds pass verification.

## Production rules

Merge PR #2 after review: https://github.com/rexdev13/JobSage-Platform/pull/2  
PR #1 is already merged: https://github.com/rexdev13/JobSage-Platform/pull/1

Set `JOOBLE_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, and `BRAVE_API_KEY` in production. Run the import before recurring jobs. Keep one writer job at a time; `writer-lock-held` is a retryable result.

Vacancies must continue through sponsor matching, URL validation, deduplication, and liveness. Do not replace them with hardcoded arrays or bypass the normal tables.
