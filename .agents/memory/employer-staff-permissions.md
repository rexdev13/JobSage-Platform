---
name: Employer staff role boundary
description: Owner-approved employer staff roles and the boundary between organization access and platform-wide privileges.
---

The owner approved five organization roles: `employer_owner`, `employer_admin`, `recruiter`, `hiring_manager`, and `employer_viewer`. Enforce their permissions in API routes as well as navigation. Organization membership does not grant platform-wide role management, cross-organization access, impersonation, organization deletion, or unrestricted export. Keep billing, legal-identity, and account-deletion controls owner-only unless the owner explicitly changes that policy.

**Why:** The owner replaced the earlier prohibition on adding employer members with explicit authorization for these roles. Least-privilege boundaries remain necessary because the global `employer` role is not an organization-membership check.

**How to apply:** Use the approved role set for employer organization membership and test every role against the API. Do not treat hidden UI controls as authorization.
