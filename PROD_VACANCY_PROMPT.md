# Prod vacancy pipeline — paste-ready prompt for the Replit agent

Merge this branch, then run the vacancy pipeline exactly as validated on Devin's box. Everything below is copy-paste instructions for the agent.

## 0. One-time data seed (skips weeks of discovery)

The repo now carries three CSV extracts under `data/` plus full SQL dumps are attached in the Devin session (`jobsage_seeds.sql.gz`, `jobsage_vacancies.sql.gz`). Prefer the SQL dumps if available:

```bash
gunzip < jobsage_seeds.sql.gz | psql $DATABASE_URL
gunzip < jobsage_vacancies.sql.gz | psql $DATABASE_URL
```

This imports: 143k sponsors with industry labels, 5,143 employer websites, 1,509 verified employer emails, 589 verified ATS board mappings, ~12k live vacancies.

## 1. Continuous pipeline jobs (run on cron / workflow)

Run from `artifacts/api-server` with `DATABASE_URL` and `NODE_ENV` set:

```bash
# Refresh sponsor register (weekly)
tsx src/tools/runVacancyPipelineCli.ts sponsor-sync

# Free job boards: NHS Jobs, jobs.ac.uk, Reed professions (every 30-60 min)
tsx src/tools/runVacancyPipelineCli.ts free-boards
tsx src/tools/runVacancyPipelineCli.ts job reed_professions --limit=12
tsx src/tools/runVacancyPipelineCli.ts job additional_boards --limit=12

# Company-site tick: verified ATS boards + careers crawl (every 5-15 min)
tsx src/tools/runVacancyPipelineCli.ts job company_site_direct_feed --limit=30
tsx src/tools/runVacancyPipelineCli.ts job company_site --limit=10
tsx src/tools/runVacancyPipelineCli.ts job company_site_probe --limit=60

# Send-CV email enrichment (every 10-15 min)
tsx src/tools/runVacancyPipelineCli.ts job contact --limit=25
```

## 2. Discovery passes (run continuously until done, then weekly)

```bash
# Slug-guess sweep: 8 ATS providers x all sponsors, sharded
tsx src/tools/discoverSponsorAtsBoards.ts --mode=slug-guess --limit=300 --concurrency=15

# Site-evidence sweep: crawl sponsor websites for board links (catches Workday/BambooHR/Workable)
tsx src/tools/discoverSponsorAtsBoards.ts --mode=site-evidence --limit=100 --concurrency=10

# Sector-focused careers drain, weakest sectors first
tsx src/tools/sectorSiteDrain.ts --sectors=manufacturing
tsx src/tools/sectorSiteDrain.ts --sectors="social care"
# ...repeat per sector as needed
```

`COMPANY_SITE_DISCOVERY_BATCH_SIZE` env var tunes the generic-discovery batch (default 10; 40 was used during drains).

### Aggregator API sources (free keys required)

Two new free-board sources pull weak-sector vacancies from aggregator APIs. Set these env vars before running `free-boards` (values must be provided by the owner — free-tier keys, no card needed):

- `JOOBLE_API_KEY` — jooble.org API key (~500 req/day free)
- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` — developer.adzuna.com (rate-limited, no daily cap)
- `BRAVE_API_KEY` — api-dashboard.search.brave.com free plan (2,000 searches/mo), used only by the website-discovery tool below

```bash
tsx src/tools/runVacancyPipelineCli.ts free-boards --source=jooble --pages=8
tsx src/tools/runVacancyPipelineCli.ts free-boards --source=adzuna --pages=8

# Website discovery for sponsors that have none (~40% hit rate observed)
tsx src/tools/discoverSponsorWebsitesBrave.ts --limit=900 --sectors=manufacturing,security,services,hospitality,"social care"

# Email discovery for sponsors whose contact scrape failed (uses same BRAVE_API_KEY)
tsx src/tools/discoverSponsorEmailsBrave.ts --limit=500
```

## 3. Rules that matter

- Vacancies only persist when the advert employer name matches a licensed sponsor (normalized-key matching: case/punctuation/legal-suffix-insensitive). Unmatched adverts are audited in `vacancy_source_listing_audits`, not lost.
- Emails are stored only when published on the employer's own site or advert — never guessed.
- Reed profession keywords live in `src/lib/reedProfessionBackfill.ts` (`REED_PROFESSION_BACKFILL_TARGETS`); sector-specific rows (e.g. manufacturing: CNC, welder, assembler) are already added.
- Only one writer job runs at a time; overlapping runs return `writer-lock-held` — normal, retry later.
- Supported ATS providers: Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Personio, Pinpoint, Workable, BambooHR (site-evidence only), Workday (general `*.wdN.myworkdayjobs.com`).
