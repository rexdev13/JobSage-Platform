---
name: Smart Apply profile gate
description: Required-versus-optional profile fields for starting Smart Apply.
---

Smart Apply may require professional and application-critical profile fields, but it must not require optional search preferences such as preferred region.

**Why:** Candidates can legitimately search nationwide with no preferred region. Treating an empty region list as an incomplete profile caused valid Smart Apply requests to fail with HTTP 422.

**How to apply:** Keep opportunity-filter preferences outside the Smart Apply readiness gate, and surface the API's specific validation message instead of replacing it with a generic generation error.