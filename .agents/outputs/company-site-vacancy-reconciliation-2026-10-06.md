# Company-site vacancy reconciliation

Validation source: healthcare-sponsor-vacancy-live-validation-2026-10-06.csv
Input recount: 201 rows total; 178 READY; 23 HOLD. The 23 source HOLD rows were excluded from both environments.

## Development
- Inserted: 177; already present before write: 0; held by import normalizer: 1 (READY source row 146, duplicate fingerprint with row 57); failed writes: 0.
- Current link checks: 176 live, 0 dead, 1 unverified. Source row 16 (Cathena Healthcare Limited) remains unverified because the host is paced or in backoff; the existing liveness gate keeps it from candidate visibility until verified.
- All 177 imported rows have exactly one canonical listing URL match, matching application URL, and matching source title. A repeat-run preflight would insert 0 rows.
- The shared writer returned inserted=177, updated=0, revived=0.

## Production
- Inserted: 0; already present and skipped without overwrite: 19; held: 159; failed writes: 0.
- Fresh read-only snapshot at 2026-10-06 07:41:58 UTC: all 19 existing records were live and had exact canonical listing URL matches. In all 19, the validated application destination was the listing page; stored application_url was null, so candidate routing uses the same listing URL as fallback.
- Employer identities were unambiguous. The 159 held rows consist of 158 rows lacking a safe exact-row production import route and source row 146 held as a duplicate fingerprint with row 57. The available production batch route rediscovers roles and could import unapproved rows, so no production write was made.

## Scope and side effects
- No HOLD source row was imported. No code, schema, or configuration changes were made; no deployment occurred; no forms or applications were submitted and no employer outreach was sent.
- The shared writer performs passive public-page contact enrichment as part of its normal flow. It populated blank public contact fields and recorded vacancy_scrape evidence for four employers during the import window: Afeni Healthcare Limited, Countrywide Healthcare Ltd, Exemplar Health Care, and Gray Healthcare. No outreach was sent.

The companion CSV contains one row for each READY source row in each environment, including employer and reason for every held row.
