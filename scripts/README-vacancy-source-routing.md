# Vacancy source routing runner

`vacancy-source-routing` is a resumable, review-only runner for classifying one
useful hiring route per sponsor record. It does not import data or connect to a
database.

## Run a batch

```bash
pnpm --filter @workspace/scripts vacancy-source-routing \
  -- \
  --sector Healthcare \
  --batch-number 2 \
  --batch-size 200 \
  --offset 0 \
  --previous-file artifacts/healthcare-vacancy-source-routing-batch1-100.csv \
  --output-dir artifacts \
  --resume
```

The default input is the guarded, development-only sponsor export at
`.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`. The sector
match is exact. Defaults are `Healthcare`, 100 sponsors, offset 0, and a 1.5
second public-host delay. Search is enabled only when `BING_SEARCH_API_KEY` is
available; without it, the runner continues through local and first-party checks.
The command accepts:

- `--sector VALUE` — exact industry label; `Healthcare` uses the local CQC cache.
- `--batch-size N` and `--offset N` — select a deterministic ranked slice.
- `--previous-file FILE` — exclude sponsor IDs already present in a prior routing
  CSV. For Healthcare, batch 1 is the default.
- `--unresolved-file FILE` — restrict selection to rows marked `unverified` in a
  prior routing CSV. `--baseline-file FILE` records a read-only comparison cohort.
- `--include-processed` — explicitly include IDs found in the previous CSV.
- `--output-dir DIR` — directory for the CSV, report, and progress JSON.
- `--input FILE`, `--cqc FILE`, `--output FILE`, `--report FILE`, and
  `--progress FILE` — override individual paths.
- `--resume` — resume the matching progress file (the default behavior).
- `--fresh` — refuse to resume; it never overwrites an existing progress file.
- `--delay-ms N` — public-host delay; values below 1000 ms are rejected.
- `--search-enabled` / `--search-disabled` — enable the optional Bing source or
  leave it off. It remains inactive when no key is configured.
- `--max-searches-per-sponsor N` and `--max-total-searches N` — hard query caps
  (defaults: 2 and 100).
- `--cache-enabled` / `--cache-disabled` and `--search-cache-file FILE` —
  control the persistent query/SponsorList cache. Successful results expire after
  30 days; page responses are reused within a run and sponsor results checkpoint
  for resumability.
- `--known-sites-file FILE` and `--known-sources-file FILE` — override local
  company-site and vacancy-source lead files.
- `--max-concurrency N` — bounded parallel sponsor checks (1–8, default 3);
  public-host pacing and robots checks remain enforced per site.

Default artifact names are derived from the sector, batch number, and batch size.
For the command above they are:

- `artifacts/healthcare-vacancy-source-routing-batch2-200.csv`
- `artifacts/healthcare-vacancy-source-routing-batch2-200-report.md`
- `artifacts/healthcare-vacancy-source-routing-progress.json`

The progress JSON is checkpointed after each sponsor. It is tied to the input,
CQC cache, prior-batch and unresolved files, local source caches, sector, search
settings, offset, batch size, and selected IDs; a
mismatch stops the run without replacing it. Existing final CSV and report files
are never overwritten. Use a new path for a separate or changed run.

## Run the 50-sponsor unresolved pilot

This selects only unverified Healthcare rows from the batch-2 baseline and writes
separate pilot files. It does not rerun or change batch 2.

```bash
pnpm --filter @workspace/scripts vacancy-source-routing \
  -- \
  --sector Healthcare \
  --batch-number 2 \
  --batch-size 50 \
  --unresolved-file artifacts/healthcare-vacancy-source-routing-batch2-200.csv \
  --baseline-file artifacts/healthcare-vacancy-source-routing-batch2-200.csv \
  --previous-file artifacts/healthcare-vacancy-source-routing-batch1-100.csv \
  --output artifacts/healthcare-vacancy-source-routing-search-pilot-50.csv \
  --report artifacts/healthcare-vacancy-source-routing-search-pilot-50-report.md \
  --progress artifacts/healthcare-vacancy-source-routing-search-pilot-progress.json \
  --search-enabled \
  --max-searches-per-sponsor 2 \
  --max-total-searches 100 \
  --cache-enabled \
  --max-concurrency 3
```

The report records whether search was configured, actual query/cache/request
counts, runtime, blocked results, and the comparison against all of batch 2 and
the selected 50-row unverified cohort. If no search key is configured, it clearly
reports zero Bing queries and still performs the local-source pilot.

## Evidence and route policy

The runner checks CQC, existing sponsor website/careers fields, a non-public-mail
contact-email domain, exact-name company-site and vacancy-source cache matches,
and SponsorList leads before optional web search. Cached support records and
search results are leads, not proof. Search runs only when those known sources
have not produced a verified route. SponsorList unavailability does not stop a
no-key run.

Search results and directory records are leads, not proof. The runner rechecks
the employer through the existing `PublicSiteFetcher`, which enforces HTTPS,
public DNS, same-site redirects, robots.txt, host pacing, bounded responses,
timeouts, and transient retries. Hiring pages and ATS/job-board routes are
accepted only when employer identity is corroborated and the source exposes a
distinct vacancy-detail URL. General careers listings and job-application forms
are not sample vacancies. A Send CV route requires explicit CV/application
instructions or a clearly identified recruitment form; a generic contact page
does not qualify. Unknown ATS platforms remain unconfirmed rather than being
guessed.

The CSV contains one row per selected sponsor. When multiple verified routes
exist, the primary route is recorded in the route columns and secondary routes
are preserved in `notes`. `should_import` is a recommendation only:
high-confidence rows are flagged `yes_high_confidence`, medium rows require
review, and unverified rows are not importable. `search_used`, `cache_hit`, and
`attempt_count` make optional search and reuse visible in each row.

The runner performs public HTTP GET/search requests and writes only its selected
CSV, report, and progress file. It does not write sponsor records, import
findings, modify production data, or deploy.

## Tests

```bash
pnpm --filter @workspace/scripts vacancy-source-routing:test
pnpm --filter @workspace/scripts typecheck
```