# 40-row live-verification status — development dry run only

**No import was applied.** The 40-row live-verification file was checked against development and dry-run through the guarded sponsor website importer.

## Result

- Live-verified candidates at high confidence: **40**.
- Already promoted to high confidence in the development audit: **0**. All 40 still have their earlier medium-confidence audit status; the pilot's later high verification has not been recorded in the audit table.
- Current development website already equals the verified URL: **37** (these values were already present; the dry run did not add them).
- Existing development website differs from the verified URL: **3**.
- Blank website targets available for promotion: **0**.
- Planned website updates: **0**.
- Audit rows inserted by this dry run: **0**.
- Dry-run actions: `preserve_existing_same` **37**; `preserve_existing_different` **3**.

The verified high URL is therefore not “already imported/promoted” as high-confidence audit data: **0 of 40**. The website value itself was already the same for 37 rows. None of the existing website fields were overwritten.

### Existing-value differences kept unchanged

| Organisation | Current development website | Verified candidate |
|---|---|---|
| ADAMA Agricultural Solutions UK ltd | `https://www.adama.com/uk/en/` | `https://www.adama.com/` |
| BLUEBIRD CARE STEVENAGE & NORTH HERTS | `https://www.bluebirdcare.co.uk/stevenage-north-herts` | `https://www.bluebirdcare.co.uk/` |
| A2B Aero Ltd | `http://www.a2baero.co.uk` | `https://www.a2baero.co.uk/` |

## Reproducible commands

Dry-run command executed:

```sh
NODE_ENV=development pnpm --filter @workspace/scripts non-healthcare-sponsor-import --input artifacts/non-healthcare-live-verification-high-40-import.csv --confirm-development-db --diff-output artifacts/live-verification-40-dev-import-dry-run-diff.csv --report-output artifacts/live-verification-40-dev-import-dry-run.md
```

Reviewed plan hash: `8de9dc15814160f336c9a43e52891a07bb64dc02443c09b3609b990a0b6f0ac5`.

Apply command **not run** (included only if you later choose to record the pilot results in development):

```sh
NODE_ENV=development pnpm --filter @workspace/scripts non-healthcare-sponsor-import --input artifacts/non-healthcare-live-verification-high-40-import.csv --confirm-development-db --apply-dev --expected-plan-hash 8de9dc15814160f336c9a43e52891a07bb64dc02443c09b3609b990a0b6f0ac5 --diff-output artifacts/live-verification-40-dev-import-applied-diff.csv --report-output artifacts/live-verification-40-dev-import-applied.md
```

If development data or the input changes before applying, rerun the dry run and use its new plan hash. Applying this exact plan would insert the high-confidence audit observations, but it would still update **0** website fields because every target is already populated. The guarded importer refuses to overwrite existing website values.

## Generated files

- `artifacts/non-healthcare-live-verification-high-40-import.csv` — 40-row, high-confidence input for the dry run.
- `artifacts/live-verification-40-dev-import-dry-run-diff.csv` — row-by-row dry-run outcome.
- `artifacts/live-verification-40-dev-import-dry-run.md` — importer-generated dry-run report.
- `artifacts/live-verification-40-dev-status.md` — this status and the dry-run/apply commands.
