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

Run the export-package self-test and typecheck with:

```bash
pnpm --filter @workspace/scripts sponsor-enrichment-export:test
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