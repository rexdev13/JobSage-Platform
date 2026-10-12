---
name: Employer staff role boundary
description: Do not infer organization-member access from the existing employer role.
---

Employer staff permissions are undefined because the source role and organisation-membership model has no employer-member role. Do not add staff access or infer it from another user's employer account.

**Why:** The owner explicitly said not to invent permissions for a role the product has not defined.

**How to apply:** Preserve canonical role gates. Add employer staff only after the owner supplies the role, membership lifecycle, and permission boundaries.
