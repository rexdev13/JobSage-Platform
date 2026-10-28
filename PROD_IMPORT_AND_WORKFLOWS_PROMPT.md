# Paste this to the Replit agent

Merge PR #2 first. PR #1 is already merged:

- https://github.com/rexdev13/JobSage-Platform/pull/1
- https://github.com/rexdev13/JobSage-Platform/pull/2

Then perform the following in order.

## 1. Install, migrate, and import the existing data

Use the repository's normal install and migration commands. Set `DATABASE_URL` and `NODE_ENV=production`.

Import the two committed dumps exactly once, sponsors first:

```bash
gunzip < jobsage_seeds.sql.gz | psql "$DATABASE_URL"
gunzip < jobsage_vacancies.sql.gz | psql "$DATABASE_URL"
```

These are data-only exports into the real tables. The rows must behave exactly like rows fetched by the application. Do not create a fixture mode, hardcode them in TypeScript, or insert them into a separate cache.

Verify before doing anything destructive:

```bash
psql "$DATABASE_URL" -Atc "select count(*) from sponsor_licences"
psql "$DATABASE_URL" -Atc "select count(*) from sponsor_licence_vacancies"
psql "$DATABASE_URL" -Atc "select count(*) from sponsor_licences where contact_email is not null and btrim(contact_email) <> ''"
psql "$DATABASE_URL" -Atc "select count(*) from sponsor_licences where website is not null and btrim(website) <> ''"
psql "$DATABASE_URL" -c "select id, organisation_name, title, source_type, url from sponsor_licence_vacancies order by id desc limit 5"
```

The expected starting point is approximately 143,177 sponsors, 13,400 vacancies, 1,542 published emails, and 5,476 websites. Higher counts are fine. If the vacancy table is empty or the sample query fails, stop and fix the import; do not delete the dumps.

After the import and verification succeed, delete only the one-time dump files from GitHub:

```bash
git rm jobsage_seeds.sql.gz jobsage_vacancies.sql.gz
git commit -m "Remove one-time imported vacancy dumps"
git push
```

Do not delete any imported database rows.

## 2. Set production configuration

Set these secrets/env vars:

```text
JOOBLE_API_KEY
ADZUNA_APP_ID
ADZUNA_APP_KEY
BRAVE_API_KEY
COMPANY_SITE_FEED_MAX_BYTES=16000000
CONTACT_ENRICHMENT_ALL_WEBSITE_SPONSORS=1
CONTACT_ENRICHMENT_BATCH_LIMIT=200
```

Use the existing internal endpoint and the repository's auth secret for scheduled jobs. Do not expose that endpoint publicly.

## 3. Start all recurring workflows

Run these from `artifacts/api-server`. Use the platform's cron/workflow scheduler, not ad-hoc one-off processes:

```bash
# Weekly
tsx src/tools/runVacancyPipelineCli.ts sponsor-sync

# Every 30–60 minutes
tsx src/tools/runVacancyPipelineCli.ts free-boards
tsx src/tools/runVacancyPipelineCli.ts free-boards --source=jooble --pages=8
tsx src/tools/runVacancyPipelineCli.ts free-boards --source=adzuna --pages=8
tsx src/tools/runVacancyPipelineCli.ts job reed_professions --limit=12
tsx src/tools/runVacancyPipelineCli.ts job additional_boards --limit=12

# Every 5–15 minutes
tsx src/tools/runVacancyPipelineCli.ts job company_site_direct_feed --limit=30
tsx src/tools/runVacancyPipelineCli.ts job company_site --limit=10
tsx src/tools/runVacancyPipelineCli.ts job company_site_probe --limit=60

# Every 10–15 minutes
tsx src/tools/runVacancyPipelineCli.ts job contact --limit=200

# Hourly or platform-equivalent recurring maintenance
tsx src/tools/runVacancyPipelineCli.ts job liveness --limit=100
```

If production uses `POST /internal/vacancy-jobs` instead of the CLI, use the same job kinds and include `x-jobsage-job-secret`. Keep the existing single-writer lock and retry `writer-lock-held`; never run concurrent writers.

## 4. Start the discovery workflows

Run these as resumable scheduled workers:

```bash
# All supported slug-guess providers, sharded if needed
tsx src/tools/discoverSponsorAtsBoards.ts --mode=slug-guess --limit=300 --concurrency=15

# First-party board links from sponsor websites
tsx src/tools/discoverSponsorAtsBoards.ts --mode=site-evidence --limit=100 --concurrency=10

# Weak sectors first, then repeat for all sectors
tsx src/tools/sectorSiteDrain.ts --sectors=manufacturing,security,services,hospitality,"social care",retail,transport,construction,beauty,agriculture

# Keyed website/email discovery, bounded by the Brave plan
tsx src/tools/discoverSponsorWebsitesBrave.ts --limit=300 --sectors=manufacturing,security,services,hospitality,"social care"
tsx src/tools/discoverSponsorEmailsBrave.ts --limit=300
```

The website and email tools use Brave first and Bing fallback. Respect the configured provider limits; do not create an unlimited tight loop against Brave.

## 5. Acceptance checks

Confirm that:

1. Imported vacancies appear through the normal vacancy API/UI.
2. Existing rows retain `source_type`, employer, title, URL, board metadata, and timestamps.
3. New runs add/dedupe/refresh ordinary rows in `sponsor_licence_vacancies`.
4. Liveness can mark dead links without treating imported rows specially.
5. Published emails remain published-only; never guess email patterns.
6. The dump files were removed from GitHub only after successful import verification.

Report the final counts by sector and application mode after the first production cycle.
