---
name: Employer context routing
description: Prevent active employer members from being sent to onboarding while identity or organization context is still loading.
---

Employer route guards must wait for a signed-in user and a resolved employer-organization response before deciding an account has no employer workspace.

**Why:** On direct navigation, a temporarily disabled or unresolved organization query looked like an empty organization list and redirected existing owners to setup.

**How to apply:** Keep onboarding redirects behind explicit auth and organization-query readiness checks; verify direct-route entry as well as navigation from inside the app.
