---
name: Employer context routing
description: Prevent active employer members from being sent to onboarding while identity or organization context is still loading.
---

Employer route guards must wait for a signed-in user and a resolved employer-organization response before deciding an account has no employer workspace.

**Why:** On direct navigation, a temporarily disabled or unresolved organization query looked like an empty organization list and redirected existing owners to setup.

**How to apply:** Keep onboarding redirects behind explicit auth and organization-query readiness checks; verify direct-route entry as well as navigation from inside the app.

Native candidate-companion access additionally requires a stable user ID and a freshly verified response with both active and archived organization lists present and empty. Keep the shortcut hidden during membership fetches; errors, incomplete responses, or any employer membership return the user to the canonical workspace.

**Why:** A global candidate role can coexist with employer staff membership, and stale or malformed membership data must not be treated as proof that employer context is absent.

**How to apply:** Revalidate organization context at companion entry and fail closed if identity or membership data is missing, changing, or unavailable.
