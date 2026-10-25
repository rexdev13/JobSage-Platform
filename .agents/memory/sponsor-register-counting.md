---
name: Sponsor register counting
description: Preserve repeated official sponsor-register entries and distinguish row totals from company-name totals.
---

Preserve every named source row in the official sponsor register, including repeated company names and identical entries. Do not deduplicate the import by company name.

**Why:** The owner explicitly approved retaining repeated register entries so JOBSAGE's register-row total can be compared with GOV.UK. Distinct names are not a guaranteed count of separate legal entities.

**How to apply:** Treat each source occurrence as a row. If showing a distinct-name metric, label it separately from the register-entry total rather than replacing one silently with the other.
