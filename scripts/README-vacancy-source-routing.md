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
second public-host delay. The command accepts:

- `--sector VALUE` — exact industry label; `Healthcare` uses the local CQC cache.
- `--batch-size N` and `--offset N` — select a deterministic ranked slice.
- `--previous-file FILE` — exclude sponsor IDs already present in a prior routing
  CSV. For Healthcare, batch 1 is the default.
- `--include-processed` — explicitly include IDs found in the previous CSV.
- `--output-dir DIR` — directory for the CSV, report, and progress JSON.
- `--input FILE`, `--cqc FILE`, `--output FILE`, `--report FILE`, and
  `--progress FILE` — override individual paths.
- `--resume` — resume the matching progress file (the default behavior).
- `--fresh` — refuse to resume; it never overwrites an existing progress file.
- `--delay-ms N` — public-host delay; values below 1000 ms are rejected.

Default artifact names are derived from the sector, batch number, and batch size.
For the command above they are:

- `artifacts/healthcare-vacancy-source-routing-batch2-200.csv`
- `artifacts/healthcare-vacancy-source-routing-batch2-200-report.md`
- `artifacts/healthcare-vacancy-source-routing-progress.json`

The progress JSON is checkpointed after each sponsor. It is tied to the input,
CQC cache, prior-batch file, sector, offset, batch size, and selected IDs; a
mismatch stops the run without replacing it. Existing final CSV and report files
are never overwritten. Use a new path for a separate or changed run.

## Evidence and route policy

The runner uses existing sponsor fields and the local CQC matcher first. For
unresolved employers it queries the public SponsorList endpoint one employer at
a time, requiring exact normalized-name and available location agreement.
`BING_SEARCH_API_KEY` enables an additional lead source, but it is optional when
the SponsorList preflight succeeds. If neither search path is available, the
runner stops before producing findings.

Search results and directory records are leads, not proof. The runner rechecks
the employer through the existing `PublicSiteFetcher`, which enforces HTTPS,
public DNS, same-site redirects, robots.txt, host pacing, bounded responses,
timeouts, and transient retries. Hiring pages and ATS/job-board routes are
accepted only when employer identity and hiring evidence are corroborated.
Generic contact forms do not qualify as Send CV sources; the page must state a
CV, application, or vacancy-specific instruction. Unknown ATS platforms remain
unconfirmed rather than being guessed.

The CSV contains one row per selected sponsor. When multiple verified routes
exist, the primary route is recorded in the route columns and secondary routes
are preserved in `notes`. `should_import` is a recommendation only:
high-confidence rows are flagged `yes_high_confidence`, medium rows require
review, and unverified rows are not importable.

The runner performs public HTTP GET/search requests and writes only its selected
CSV, report, and progress file. It does not write sponsor records, import
findings, modify production data, or deploy.

## Tests

```bash
pnpm --filter @workspace/scripts vacancy-source-routing:test
pnpm --filter @workspace/scripts typecheck
```