---
name: Full CV enhancement completeness
description: Product rules for complete AI rewrites, source comparison, and candidate review.
---

**Rule:** Full-CV enhancement must preserve every distinct source detail, adapt headings to the candidate's profession, and must not target an arbitrary page count. Candidates must be able to compare with the original and explicitly confirm their review before saving. Disclose UK English/CV conventions and the lack of independent fact-checking in review and on saved AI CVs. Keep AI provenance separate from the candidate-editable display name.

**Why:** AI rewrites can over-compress job history and alter facts. The warning must remain visible after a candidate renames a document. A long PDF must continue onto additional pages rather than silently truncate. PDF parser page labels must be excluded from source-number comparisons to avoid false warnings.

**How to apply:** Changes to the rewrite prompt, source extraction, PDF renderer, or review UI should be tested with a synthetic CV that spans multiple pages, has distinct duties and a tail fact, and exercises the Original-tab confirmation gate. Verify the saved AI disclosure and candidate-chosen name survive a reload.
