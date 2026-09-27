# Healthcare sponsor website import — batch 3 (applied)

- Input CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch3.csv`
- Database: development only (`heliumdb`)
- Run ID: `healthcare-sponsor-batch-003-ded136c97883d54a`
- Plan SHA-256: `5c9e921f5f8d60228b4eceaaace855bb2bdece92ec141dfbc5b585df7fd565c6`
- Source rows and audit records: **500**
- High-confidence website updates with blank targets: **91**
- High-confidence careers updates with blank targets: **56**
- Medium-confidence sponsor rows held for review: **51**
- ATS candidates held in audit only: **0**
- Website targets already populated before this batch: **0**
- Distinct employer careers targets already populated before this batch: **0**

High-confidence fields are written only when the current target is blank. Existing values are never overwritten. Medium-confidence website/careers values are retained in the audit table and medium-review CSV, not promoted. ATS mappings are audit-only.

Applied website updates: **91**; careers employer rows: **56**; audit rows inserted: **500**; already stored from this same run: **0**.

No production database was accessed and no deployment was performed.
