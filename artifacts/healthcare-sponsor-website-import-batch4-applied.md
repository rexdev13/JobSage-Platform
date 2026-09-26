# Healthcare sponsor website import — batch 4 (applied)

- Input CSV: `/home/runner/workspace/artifacts/healthcare-sponsor-website-enrichment-batch4.csv`
- Database: development only (`heliumdb`)
- Run ID: `healthcare-sponsor-batch-004-376c7b29f0166f58`
- Plan SHA-256: `4bf2fe9287c8a34d02bc58bf6154553b4f87fc2dad03c89414c3783bcc9d0e09`
- Source rows and audit records: **500**
- High-confidence website updates with blank targets: **102**
- High-confidence careers updates with blank targets: **71**
- Medium-confidence sponsor rows held for review: **52**
- ATS candidates held in audit only: **0**
- Website targets already populated before this batch: **0**
- Distinct employer careers targets already populated before this batch: **0**

High-confidence fields are written only when the current target is blank. Existing values are never overwritten. Medium-confidence website/careers values are retained in the audit table and medium-review CSV, not promoted. ATS mappings are audit-only.

Applied website updates: **102**; careers employer rows: **71**; audit rows inserted: **500**; already stored from this same run: **0**.

No production database was accessed and no deployment was performed.
