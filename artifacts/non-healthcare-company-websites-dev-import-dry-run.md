# Non-Healthcare sponsor website import

- Mode: **dry-run**
- Input CSV: `/home/runner/workspace/artifacts/non-healthcare-company-websites-all-sectors.csv`
- Database: development only (`heliumdb`)
- Run ID: `non-healthcare-company-websites-903195c09e0aba4b`
- Reviewed plan SHA-256: `a004cbe7e2dc6683d85a56fab7a857cf68b675f5660d7c1d5184b843816913bb`
- Input rows/audit records: **14530**
- Confidence counts: high **2495**, medium **1233**, low **1162**, unverified **9640**
- Planned high-confidence website updates into blank fields: **2038**
- Action counts: review_medium **1233**; unverified **9640**; preserve_existing_same **402**; review_low **1162**; preserve_existing_different **55**; promote_high_blank **2038**

Only high-confidence websites are promoted, and only into blank sponsor website fields. Existing websites are never overwritten. Medium- and low-confidence findings remain in the audit table for review; low-confidence URLs are not accepted as official websites. Unverified rows are recorded without a website candidate.

**Dry run only: no database changes were made.**

Production was not accessed or changed.
