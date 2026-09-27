# Healthcare sponsor website import — batch 6 (dry-run)

- Input CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch6.csv`
- Database: development only (`heliumdb`)
- Run ID: `healthcare-sponsor-batch-006-be2e32efe904db87`
- Plan SHA-256: `f61a1266ce9930177ba2bc565c03895ae68ddd7cabc2cf59aa2489054f80080b`
- Source rows and audit records: **500**
- High-confidence website updates with blank targets: **73**
- High-confidence careers updates with blank targets: **29**
- Medium-confidence sponsor rows held for review: **40**
- ATS candidates held in audit only: **0**
- Website targets already populated before this batch: **0**
- Distinct employer careers targets already populated before this batch: **0**

High-confidence fields are written only when the current target is blank. Existing values are never overwritten. Medium-confidence website/careers values are retained in the audit table and medium-review CSV, not promoted. ATS mappings are audit-only.

**Dry run only: no database changes were made.**

No production database was accessed and no deployment was performed.
