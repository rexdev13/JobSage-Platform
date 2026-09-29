# Sponsor contact discovery CLI

This is a standalone, review-first batch tool. It does not send email and it does not write to JOBSAGE during discovery.

## Read-only sponsor website/careers export

Generate the Codex-ready export package from the development database:

```bash
NODE_ENV=development pnpm --filter @workspace/scripts sponsor-enrichment-export \
  --confirm-development-db
```

The command refuses non-development mode and Replit deployment processes. It opens a
read-only database transaction and writes only to
`.local/reports/sponsor-enrichment/`. The explicit confirmation flag is required so
the operator must verify that the configured `DATABASE_URL` points to the development
database. It does not fetch public datasets, crawl employer sites, change database
records, import candidate rows, or deploy.

Outputs:

- `jobsage-sponsor-base-export.csv`
- `jobsage-company-site-existing.csv`
- `jobsage-existing-vacancy-sources.csv`
- `jobsage-website-enrichment-import-template.csv` (headers only)
- `public-source-enrichment-readiness.md`
- `final-report.md`
- `export-manifest.json`

The sponsor export includes every sponsor row up to 50,000. Above that threshold it
includes all rows with existing website/careers/ATS evidence, all rule-classified
healthcare/social-care, education, technology, engineering, and finance rows, and a
stable SHA-256-selected sample of up to 5,000 remaining rows without those fields.
`sponsor_licence_id` is JOBSAGE's internal `sponsor_licences.id`; it is not an
official licence number.

The public-source report assesses only existing files under `scripts/data/cache/`.
It does not download or refresh CQC, GIAS, or Charity Commission data. Potential
name/location matches and available fields are reported separately from confirmed,
source-attributed JOBSAGE enrichments.

## Healthcare sponsor website batch

The first-batch command reads the sponsor export and the cached CQC directory. It is
file/network-only: it does not connect to a database, write sponsor records, import
candidate values, or deploy.

If the canonical sponsor CSV is absent, first create the development-only,
read-only export using the guarded command above. Do not use an unrelated cohort as
a substitute. Then run:

```bash
pnpm --filter @workspace/scripts healthcare-sponsor-websites \
  --limit 500 \
  --delay-ms 1500
```

The default input is
`.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`; the cached
CQC directory is `scripts/data/cache/cqc-directory-2026-09-14.csv`. The command
selects only source rows with `industry` exactly `Healthcare`, skips rows that
already have a website/careers/ATS signal, and caps each batch at 500.
`--offset 500 --limit 500` selects a later source-order slice. For a multi-batch
sequence, use `--previous-batch FILE` once for each completed CSV so sponsor IDs are
excluded and batches cannot overlap.

Batch 2 can rank remaining sponsors using the approved criteria: unique normalized
employer name, populated town/city, care-home/clinic terms, and town/county clues.
It excludes names tied to robots-policy or unreachable-site errors in earlier
batches and uses source order as the final tie-breaker. Use
`--target-healthcare-location --batch-number 2 --previous-batch BATCH1.csv` to
enable this mode; its report includes criterion counts.

Website and careers fields remain blank unless an employer page can be safely
fetched and its identity corroborated. CQC and search results are leads only; they
are never accepted as official employer URLs on their own. The public SponsorList
directory search is used as an additional lead source for unresolved employers;
results must match exact normalized name and town/county before their website URL
is checked. The script queries one employer at a time; it never uploads the sponsor
CSV or a bulk employer list to a third-party lookup service. An optional
`BING_SEARCH_API_KEY` enables more search leads, but first-party verification is
still required. The tool checks HTTPS, public DNS,
same-site redirects, robots.txt, page size, request timeouts, pacing, and transient
retries. It logs per-employer progress and atomically checkpoints results under
`.local/state/`; changing the input or batch settings requires `--fresh`, which backs
up the existing checkpoint.

The output defaults to:

- `artifacts/healthcare-sponsor-website-enrichment-batch1.csv`
- `artifacts/healthcare-sponsor-website-enrichment-batch1-report.md`

Existing deliverables are not replaced unless `--overwrite` is supplied; the old
files are renamed to timestamped backups under
`.local/state/healthcare-sponsor-website-batch/backups/` first. The CSV is for human
review only, not an import file or approval.

## Development-only healthcare batch import

Do not use the `sponsor-contacts import` command for the healthcare website/careers
batch. It matches contact-discovery rows by employer name and is not the exact-ID
website workflow.

First create and inspect a dry-run diff:

```bash
NODE_ENV=development pnpm --filter @workspace/scripts healthcare-sponsor-import -- \
  --input artifacts/healthcare-sponsor-website-enrichment-batch1.csv \
  --batch-number 1 \
  --confirm-development-db
```

The command requires development mode, refuses deployment processes and
production-marked database targets, and checks each sponsor ID against exact
`Healthcare` industry, employer name, and town/city. It writes a reviewable diff
and a medium-confidence review CSV without changing the database. The output
includes a plan SHA-256.

Apply only after inspecting the diff, using the exact hash printed by that dry run:

```bash
NODE_ENV=development pnpm --filter @workspace/scripts healthcare-sponsor-import -- \
  --input artifacts/healthcare-sponsor-website-enrichment-batch1.csv \
  --batch-number 1 \
  --confirm-development-db \
  --apply-dev \
  --expected-plan-hash PLAN_SHA256_FROM_DRY_RUN
```

Only high-confidence website/careers values with blank targets are promoted.
Existing values are never overwritten. All batch rows and evidence are stored in
`sponsor_licence_website_enrichment_audits`; medium-confidence candidates remain
pending in that audit table and the review CSV. ATS evidence is audit-only. A
changed database state invalidates the dry-run hash and stops the apply. The
importer never writes to production or deploys.

Run the export-package self-test and typecheck with:

```bash
pnpm --filter @workspace/scripts sponsor-enrichment-export:test
pnpm --filter @workspace/scripts healthcare-sponsor-websites:test
pnpm --filter @workspace/scripts healthcare-sponsor-import:test
pnpm --filter @workspace/scripts typecheck
```

## Pilot

From the repository root:

```bash
pnpm --filter @workspace/scripts sponsor-contacts pilot \
  --limit 200 \
  --output data/sponsor_contacts_pilot.csv
```

Without `--input`, the CLI downloads the latest Home Office Worker and Temporary Worker sponsor register. When CQC/GIAS/Charity files are not supplied, it attempts to cache current official CQC and GIAS datasets under `data/cache/`. If `CHARITY_COMMISSION_API_KEY` is configured, it queries the Charity Commission API for the selected pilot sponsor names and caches the normalized result. Otherwise the run emits a structured warning.

Disable automatic optional-source downloads with:

```bash
pnpm --filter @workspace/scripts sponsor-contacts pilot \
  --limit 200 \
  --no-auto-fetch
```

You can provide official-register exports explicitly:

```bash
pnpm --filter @workspace/scripts sponsor-contacts pilot \
  --cqc data/cqc.csv \
  --gias data/gias.csv \
  --charity data/charity.csv
```

The local `--gias FILE` and `--charity FILE` paths work without API credentials. Charity files should expose a name column (`organisation_name`, `charity_name`, or `name`), plus optional `website`, `contact_email`/`email`, and `evidence_url` columns.

GIAS manual download fallback:

1. Open https://get-information-schools.service.gov.uk/Downloads.
2. Select **Establishment fields CSV** and submit the download form.
3. Wait for the generated download page to finish, then use its protected CSV download action.
4. Save the CSV under the repository, for example `data/cache/gias-manual.csv`.
5. Run the pilot with `--gias data/cache/gias-manual.csv`.

The automatic GIAS flow saves its generation ID and session cookie in
`<cache-dir>/gias-generation-state.json`. A later run resumes that generation instead of
starting another one. HTTP 429 and 5xx responses use exponential backoff, valid cached
GIAS CSVs are preferred before creating a generation, and a failed generation remains
resumable. The CLI logs `started`, `resumed`, `cached`, or `failed` source status.

Additional operational flags:

```text
--cache-dir DIR       default data/cache
--summary-json FILE   write a machine-readable summary
--delay-ms N          minimum delay per employer host
```

The fallback website fetcher only visits the confirmed employer domain, checks robots.txt, enforces HTTPS/public-DNS/timeout/size limits, paces requests per host, and accepts only published employer-domain emails. It never constructs an address.

Matching is deterministic and audit-friendly:

- exact normalized organisation name
- exact normalized name plus town/city
- strict fuzzy name match with town/city agreement
- ambiguous matches remain `unmatched`

The output includes `match_method`, `match_confidence`, and `match_candidates_count`. Each run also writes a rejected CSV beside the main CSV. Use `--summary-json` for a JSON report with source contributions, status counts, warnings, and sample rows.

If `BING_SEARCH_API_KEY` is present, Bing is used only to discover a candidate official website. The same-domain checks still apply.

## Review and import

Inspect and edit the CSV first. The discovery output includes a blank `review_status` column.
Only clearly invalid rows with missing evidence are auto-marked `rejected`; good candidates
remain blank for human approval. You may also add or change:

```text
review_status
```

Then dry-run:

```bash
pnpm --filter @workspace/scripts sponsor-contacts import \
  --input data/sponsor_contacts_pilot.csv \
  --require-review
```

Apply only after review:

```bash
pnpm --filter @workspace/scripts sponsor-contacts import \
  --input data/sponsor_contacts_pilot.csv \
  --apply \
  --require-review
```

Import never overwrites existing JOBSAGE website or contact-email values. It matches sponsor licence rows by organisation name, using town/city to disambiguate when possible, and stores the accepted evidence in the contact-enrichment record.

## Statuses

- `verified_email`: accepted published employer-domain email with evidence
- `website_no_email`: confirmed website checked, but no accepted public email found
- `no_website`: official match exists but no website is published
- `unmatched`: no unambiguous official match
- `no_public_contact`: website could not be safely fetched
- `skipped_existing`: input already contained a contact email