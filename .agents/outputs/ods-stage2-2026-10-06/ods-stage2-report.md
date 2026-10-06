# Stage 2 NHS ODS website match report

Generated: 2026-10-06T18:27:14.976Z

## Scope and rules

Reviewed 6804 blank-website rows: 6667 rows classified as Healthcare, plus 137 additional no-website rows whose employer names contain NHS, hospital, or healthcare terms outside that industry label. This includes NHS Trusts categorized as Public Services.

Compared against 544 NHS Trust ODS search records (247 active and 297 inactive). Exact matching preserves legal suffixes; it normalizes case, spacing, punctuation, apostrophes, and ampersand/“and” only. No fuzzy match or suffix stripping was used.

A write was eligible only with one active RO197 NHS TRUST record, an exact normalized name, an exact town match, one HTTPS website listed in that ODS record, all three production fields blank, and no explicit non-write hold.

## Counts

| Measure | Count |
| --- | --- |
| Candidate rows | 6804 |
| Clean rows | 55 |
| Clean distinct employers | 54 |
| Held rows | 15 |
| Location conflicts | 9 |
| No exact NHS Trust match | 6725 |
| Planned write rows | 55 |
| Planned write employers | 54 |
| Writer preflight status | blocked_before_write |
| Writer preflight reason | The production writer role has broader-than-approved administrative or ownership privileges. |
| Production apply status | Not yet applied |
| Last read-only production sponsor rows | 142847 |
| Last read-only blank websites | 132456 |
| Last read-only blank website/ODS rows | 132456 |
| Production sponsor rows before writer transaction | No writer transaction ran |
| Production sponsor rows after writer transaction | No writer transaction ran |
| Blank websites before writer transaction | No writer transaction ran |
| Blank websites after writer transaction | No writer transaction ran |

## Ten clean-match examples

| Employer | Website | ODS code | ODS record |
| --- | --- | --- | --- |
| Southport & Ormskirk Hospital (NHS) Trust | https://www.southportandormskirk.nhs.uk/ | RVY | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RVY |
| Barking Havering and Redbridge University Hospitals NHS Trust | https://www.bhrhospitals.nhs.uk/ | RF4 | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RF4 |
| Berkshire Healthcare NHS Foundation Trust | https://www.berkshirehealthcare.nhs.uk/ | RWX | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RWX |
| Calderdale and Huddersfield NHS Foundation Trust | https://www.cht.nhs.uk/HOME/ | RWY | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RWY |
| Cambridgeshire Community Services NHS Trust | https://www.cambscommunityservices.nhs.uk/ | RYV | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RYV |
| Central London Community Healthcare NHS Trust | https://www.clch.nhs.uk/ | RYX | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RYX |
| County Durham and Darlington NHS Foundation Trust | https://www.cddft.nhs.uk/ | RXP | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RXP |
| Dartford and Gravesham NHS Trust | https://www.dgt.nhs.uk/ | RN7 | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RN7 |
| Derbyshire Healthcare NHS Foundation Trust | https://www.derbyshirehealthcareft.nhs.uk/ | RXM | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RXM |
| Devon Partnership NHS Trust | https://www.dpt.nhs.uk/ | RWV | https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RWV |

## Named non-write examples

| Employer | Result | Reason |
| --- | --- | --- |
| King's College Hospital Charity | NO_MATCH | No exact NHS Trust name in the current ODS role search. KING'S COLLEGE HOSPITAL NHS FOUNDATION TRUST (RJZ); charity is not the Trust. |
| Kings College Hospital NHS Foundation Trust | HELD | Location mismatch or missing town (sponsor: Camberwell; ODS: LONDON). Explicitly named for non-write review. |
| Northumbria Healthcare NHS Foundation Trust | HELD | Location mismatch or missing town (sponsor: Newcastle upon Tyne; ODS: NORTH SHIELDS). Explicitly named for non-write review. |
| Oxford University Hospitals NHS Trust | NO_MATCH | No exact NHS Trust name in the ODS role search; explicitly named for non-write review. OXFORD UNIVERSITY HOSPITALS NHS FOUNDATION TRUST (RTH); not an exact name match. |
| University College London Hospitals NHS Foundation Trust | HELD | The ODS record lists no valid HTTPS website. Explicitly named for non-write review. |

Oxford Health NHS Foundation Trust is a separate exact-name organisation; it is not Oxford University Hospitals NHS Trust.

## Undo

No production write occurred in this run. After a successful apply, the guarded writer will create `ods-stage2-before-image.json` in this directory before updating any rows. To undo a later successful apply, first run a read-only restore preflight:

```sh
pnpm --filter @workspace/api-server sponsor:stage1-ods-websites -- --restore-before-image-file=.agents/outputs/ods-stage2-2026-10-06/ods-stage2-before-image.json --preflight-only=true
```

If that preflight confirms every row still has the Stage 2 values, apply the restore with the fingerprint printed by that preflight:

```sh
pnpm --filter @workspace/api-server sponsor:stage1-ods-websites -- --restore-before-image-file=.agents/outputs/ods-stage2-2026-10-06/ods-stage2-before-image.json --apply=true --expected-db-fingerprint=<restore-preflight-fingerprint> --confirm-production-ods-restore=true
```

The restore is conditional and will refuse if target values or row counts changed. These commands require the production writer secret to be a valid PostgreSQL URL.

The production writer preflight stopped: The production writer role has broader-than-approved administrative or ownership privileges. A database connection was opened for the read-only preflight; no writes were attempted and no transaction before-image was created. The exact-match before-value snapshot is saved separately as production-exact-ods-writer-row-states.csv.
