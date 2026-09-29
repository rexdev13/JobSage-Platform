---
name: Direct-feed duplicate identities
description: Identity rules for direct-only vacancy runs when sponsor rows share an organisation name.
---

For the guarded direct-only path, duplicate sponsor rows with a matching organisation name may share one employer feed only when every row agrees on the website, careers URL, ATS provider, board ID, mapping status, and evidence URL. The selected sponsor ID and organisation name must still match exactly. Any source mismatch remains an identity conflict. Do not relax identity checks in generic discovery mode.

**Why:** shared vacancy records are keyed by organisation name, not sponsor ID; a disagreement could import another sponsor's feed. A blanket duplicate-row rejection can also block a safe run when duplicate rows are identical in all source identity fields.

**How to apply:** preserve the exact-ID check and compare every same-name row's website and mapping fields. Limit any duplicate tolerance to direct-only mode. If any value differs, fail closed and require manual reconciliation.