---
name: Extension data declarations
description: Privacy classifications must include local processing, complete CV transfers and remaining free-text paths.
---

Assess Chrome Web Store disclosures across the entire extension flow, not just
the AI prompt or network telemetry. Local processing counts. Excluding raw CV
text from AI does not make full-file CV retrieval/attachment/download disappear
from the data inventory.

**Why:** Smart Apply preserves complete, unredacted CV transfer and
candidate-authored free text. Content regexes reduce accidental sensitive
handling but cannot establish zero health/financial handling. Treating professional
healthcare work itself as personal health information is also incorrect.

**How to apply:** Base each category on a specific retained path; never select
everything merely because HTTPS access is broad, or exclude categories merely
because processing is local. Reassess health/financial declarations if verified
document redaction or narrower input handling changes those paths. Do not invent
provider retention/training guarantees or operational staff-access restrictions
from source-level checks.
