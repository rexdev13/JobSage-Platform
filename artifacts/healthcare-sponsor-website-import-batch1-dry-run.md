# Healthcare sponsor website import — batch 1 (dry-run)

- Input CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch1.csv`
- Database: development only (`heliumdb`)
- Run ID: `healthcare-sponsor-batch-001-492fb0beb43786ca`
- Plan SHA-256: `a4f947ed45205246ce587d7ecce92765e77e72fad9be60874373f31bc7df57f3`
- Source rows and audit records: **500**
- High-confidence website updates with blank targets: **86**
- High-confidence careers updates with blank targets: **51**
- Medium-confidence sponsor rows held for review: **54**
- ATS candidates held in audit only: **0**
- Website targets already populated before this batch: **0**
- Distinct employer careers targets already populated before this batch: **0**

High-confidence fields are written only when the current target is blank. Existing values are never overwritten. Medium-confidence website/careers values are retained in the audit table and medium-review CSV, not promoted. ATS mappings are audit-only.

**Dry run only: no database changes were made.**

No production database was accessed and no deployment was performed.
