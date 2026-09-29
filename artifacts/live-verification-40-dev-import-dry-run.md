# Non-Healthcare sponsor website import

- Mode: **dry-run**
- Input CSV: `/home/runner/workspace/artifacts/non-healthcare-live-verification-high-40-import.csv`
- Database: development only (`heliumdb`)
- Run ID: `non-healthcare-company-websites-06f5f90992555d5b`
- Reviewed plan SHA-256: `8de9dc15814160f336c9a43e52891a07bb64dc02443c09b3609b990a0b6f0ac5`
- Input rows/audit records: **40**
- Confidence counts: high **40**, medium **0**, low **0**, unverified **0**
- Planned high-confidence website updates into blank fields: **0**
- Action counts: preserve_existing_same **37**; preserve_existing_different **3**

Only high-confidence websites are promoted, and only into blank sponsor website fields. Existing websites are never overwritten. Medium- and low-confidence findings remain in the audit table for review; low-confidence URLs are not accepted as official websites. Unverified rows are recorded without a website candidate.

**Dry run only: no database changes were made.**

Production was not accessed or changed.
