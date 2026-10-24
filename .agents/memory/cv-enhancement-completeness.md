---
name: Full CV enhancement completeness
description: Product rules for complete AI rewrites, source comparison, and candidate review.
---

**Rule:** Full-CV enhancement must preserve every distinct source detail, adapt headings to the candidate's profession, and must not target an arbitrary page count. Candidates must be able to compare with the original and explicitly confirm their review before saving. Disclose UK English/CV conventions and the lack of independent fact-checking in review and on saved AI CVs. Keep AI provenance separate from the candidate-editable display name.

**Why:** AI rewrites can over-compress job history and alter facts. The warning must remain visible after a candidate renames a document. A long PDF must continue onto additional pages rather than silently truncate. PDF parser page labels must be excluded from source-number comparisons to avoid false warnings.

**How to apply:** Changes to the rewrite prompt, source extraction, PDF renderer, or review UI should be tested with a synthetic CV that spans multiple pages, has distinct duties and a tail fact, and exercises the Original-tab confirmation gate. Verify the saved AI disclosure and candidate-chosen name survive a reload.

**Rule:** Assess paid rewrite quality from actual generated prose and rendered pages, not HTTP success. A source-grounded editorial review remains AI assistance, not independent verification. Responsibility levels must not be inflated (tracking a budget is not managing it); derived statistics are not source facts.

**Why:** Live synthetic evaluations produced polished-sounding responsibility inflation and a newly calculated percentage despite preservation instructions. Generic summaries also persisted when completeness instructions accidentally treated promotional source wording as immutable evidence.

**How to apply:** Keep factual completeness separate from editable summary framing. Put mode-specific omission rules at system priority so Focus only can remove unrelated material without discarding relevant transferable evidence. Preserve digit notation to avoid false numeric warnings. Use final numeric guards and candidate review together; neither proves complete factual accuracy. Final quality probes can exercise the shared generation prompts without changing the validation account's daily quota.
