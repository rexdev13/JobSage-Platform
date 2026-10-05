---
name: Audit CSV alignment
description: Validate positional CSV exports semantically, not only by field count.
---

For CSVs built from positional arrays, validate representative values against their named headers for each row type, in addition to checking row widths. Equal column counts do not prove fields are aligned.

**Why:** A scan export had one missing placeholder in candidate rows. The total width still matched the header, but candidate values shifted under the wrong column names.

**How to apply:** Prefer object-based serialization with a declared header schema. If positional arrays are used, assert selected header/value pairings for target and candidate rows after the final file is rendered.
