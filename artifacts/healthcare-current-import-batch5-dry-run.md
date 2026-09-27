# Healthcare sponsor website import — batch 5 (dry-run)

- Input CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch5.csv`
- Database: development only (`heliumdb`)
- Run ID: `healthcare-sponsor-batch-005-c902a7b522dad0c2`
- Plan SHA-256: `281c35417971ccee9b06daea4b4c3bc27252e88e3c7f5291b3b3f05e44fbdf1f`
- Source rows and audit records: **500**
- High-confidence website updates with blank targets: **83**
- High-confidence careers updates with blank targets: **38**
- Medium-confidence sponsor rows held for review: **40**
- ATS candidates held in audit only: **0**
- Website targets already populated before this batch: **0**
- Distinct employer careers targets already populated before this batch: **0**

High-confidence fields are written only when the current target is blank. Existing values are never overwritten. Medium-confidence website/careers values are retained in the audit table and medium-review CSV, not promoted. ATS mappings are audit-only.

**Dry run only: no database changes were made.**

No production database was accessed and no deployment was performed.
