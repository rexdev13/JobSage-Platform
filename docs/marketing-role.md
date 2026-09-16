# JOBSAGE marketing-account technical specification

**Status:** read-only reproduction of the current repository implementation. This
is not a design, recommendation, or implementation proposal. A behavior that is
not present is explicitly marked **not implemented**.

**Evidence convention:** paths are repository-relative and line ranges refer to
the current source tree. The API server mounts its routers under `/api`
(`artifacts/api-server/src/app.ts:30-42`; `artifacts/api-server/src/routes/index.ts:42-82`).
Representative JSON below is code-derived and uses non-production values.

This document is the canonical marketing-account document. The public waitlist
capture flow is documented in `docs/waitlist-technical-spec.md`; this document
cross-references that specification instead of reproducing its public form and
chat UI in full. Where that older document conflicts with current source, the
current source is recorded here as a contradiction.

## 1. Product snapshot

A marketing account is a row in the shared `users` table with
`role = "marketing"`. It is not a separate `marketing_users` table, flag, or
join table. The role is one of six application roles:
`candidate`, `admin`, `reviewer`, `employer`, `super_admin`, and `marketing`
(`lib/db/src/schema/auth.ts:14-33`;
`artifacts/api-server/src/middlewares/requireRole.ts:3-3`).

Marketing is a restricted operational CRM role:

- It can work the waitlist-lead inbox, claim unassigned leads, change the status
  of leads it owns, and use its own follow-up calendar.
- It can see only a reduced lead projection and, by default, its own plus
  unassigned leads.
- It cannot assign, unassign, delete, export, or administer users.
- It can save its own Calendly URL and manage its own calendar events.
- It cannot use candidate, employer, general admin, sponsor, vacancy, identity,
  audit, ruleset, billing, or super-admin surfaces.
- `admin` and `super_admin` are both allowed into the shared leads/calendar
  operations, but only `super_admin` can create marketing accounts, inspect the
  full user directory, change roles, suspend/restore/delete users, and
  impersonate.

There is no marketing-specific active flag. The shared `suspendedAt` field is
used for account suspension. There is no database check that a foreign-key
target assigned as a marketer currently has role `marketing`; the API validates
that rule before assignment (`lib/db/src/schema/auth.ts:21-28`;
`lib/db/src/schema/socialLeads.ts:63-68`;
`lib/db/src/schema/marketerEvents.ts:8-12`).

## 2. End-to-end behavior

The implemented path from account creation to lead work is:

1. A `super_admin` opens the Super Admin user directory and submits **Create
   marketing account**, or calls `POST /api/admin/super/marketing-accounts`.
   The body contains email, first name, last name, and an optional Calendly URL
   (`artifacts/jobsage-web/src/pages/admin/SuperAdminPage.tsx:710-812`;
   `artifacts/api-server/src/routes/superAdmin.ts:370-464`).
2. The server normalizes the email, inserts a normal `users` row with role
   `marketing`, a null password hash, `emailVerified = false`, a generated
   JOBSAGE email alias, and a 24-hour password-reset/setup token. The optional
   Calendly URL is stored on that same row.
3. The server sends the generic password-reset email. This is the invitation:
   there is no separate invitation token or invitation acceptance route. If the
   mail function throws, the newly inserted user is deleted and the endpoint
   returns 503; a successful request returns 201
   (`superAdmin.ts:370-464`; `email.ts:814-822`).
4. The invitee opens the reset-password URL and uses the existing
   `POST /api/auth/reset-password` flow. A valid token sets a bcrypt password,
   marks the account verified, and clears the reset/verification token fields.
   Reset does not create a session (`auth.ts:403-447`).
5. The marketer uses the ordinary `/login` page, not `/admin/login`, with the
   same email/password login endpoint. Login creates a seven-day secure,
   HttpOnly `sid` cookie and also returns the session ID in a `token` property.
   The browser then goes to `/`; `AuthGuard` redirects a marketing user to
   `/admin/leads` (`LoginPage.tsx:44-75`;
   `auth.ts:280-352`; `AuthGuard.tsx:57-63`).
6. `AuthGuard` skips candidate consent/profile loading for marketing and permits
   only exact locations `/admin/leads` and `/admin/calendar`. Opening another
   protected location redirects to `/admin/leads`. This exact string comparison
   also means a marketing location with a query string, such as
   `/admin/calendar?leadId=7`, can be redirected before the calendar can read
   the lead ID (`AuthGuard.tsx:20-45,48-63`).
7. The sidebar shows only **Waitlist Leads** and **Calendar** for marketing.
   The leads page queries the role-scoped CRM API and displays a reduced
   projection, a personal performance banner, search/sector filters, the
   own/unassigned queue, and a **Claim** action for unassigned rows
   (`roleAccess.ts:1-25`; `AppSidebar.tsx:103-143`;
   `AdminLeadsPage.tsx:367-428,544-887`).
8. A marketer claims an unassigned lead with
   `POST /api/leads/:id/claim`. Claiming only sets `marketingUserId` and
   `claimedAt`; it does not set status to contacted and does not set
   `contactedAt` (`leads.ts:267-299`).
9. The marketer can set an owned lead to `new`, `contacted`, `registered`, or
   `unqualified`, individually or in bulk. Moving to `contacted` sets
   `contactedAt` only when it was previously null. Cross-owner status updates
   are rejected (`leads.ts:684-819`).
10. The **Calendar** button goes to `/admin/calendar?leadId=<id>`. Merely
    opening the calendar does not update the lead. Creating a linked manual
    event for a lead that is still `new` changes it to `contacted` and records
    `contactedAt` (`AdminLeadsPage.tsx:102-114,832-835`;
    `marketerCalendar.ts:138-206`).
11. The marketer can save/clear its own Calendly URL, create manual events,
    edit permitted event fields, record outcome/notes, and delete manual
    events. Calendly-owned time/title/link fields cannot be changed in JOBSAGE
    and Calendly-sourced events cannot be deleted (`AdminCalendarPage.tsx:46-131`;
    `marketerCalendar.ts:246-344`).
12. If the marketer opens an admin-only URL directly, the frontend guard
    redirects it and the backend independently returns 403. The backend is the
    authority; hiding a sidebar item is not the permission check
    (`App.tsx:157-205,297-313`; `requireRole.ts:29-47`).

## 3. Implemented and absent surfaces

| Surface | Path/API | Who can use it | Current behavior |
|---|---|---|---|
| Regular login | `/login`, `POST /api/auth/login` | Public | Marketing uses the same login as candidates and other users. |
| Marketing invitation | Super Admin **All Users** tab; `POST /api/admin/super/marketing-accounts` | `super_admin` | Creates a marketing row and sends a password-setup link. |
| Password setup | `/reset-password`, `POST /api/auth/reset-password` | Public with token | Sets password and marks the invited account verified. |
| Waitlist leads | `/admin/leads` | `admin`, `super_admin`, `marketing` | Role-dependent CRM projection and actions. |
| Calendar | `/admin/calendar` | `admin`, `super_admin`, `marketing` | Own calendar for marketing; cross-marketer access for admins. |
| Personal performance | `/admin/leads`; `GET /api/leads/my-performance` | `marketing` | Assigned/contacted/registered/conversion/response metrics. |
| Marketer directory | `/admin/super`, **All Users** tab | `super_admin` | General user directory can filter role `Marketing`; no dedicated marketer page. |
| Admin user lookup | `/admin/users` | Exact `admin` | Email lookup, verification/reset actions, and recent admin actions; not a marketer directory. |
| Impersonation | Super Admin detail and `/impersonate?token=...` | `super_admin` | Read-only activated session; all protected non-GET writes are blocked. |
| Public lead capture | `/get-started`, `/api/leads/submit`, `/api/leads/chat` | Public | Covered by `docs/waitlist-technical-spec.md`; only its interaction with marketing is summarized here. |

The following are **not implemented**:

- A marketing-only login page, marketer self-registration, or a public
  “register as marketing” option.
- A dedicated `/admin/marketers` or `/admin/marketing-users` page.
- A general invitation endpoint for candidate, employer, reviewer, or admin
  accounts.
- A dedicated marketing invitation acceptance route, invitation state, invite
  resend action, or invitation audit view.
- A marketing dashboard separate from `/admin/leads`.
- Marketing lead email/SMS outreach, lead notes, a lead-detail page, or an
  explicit conversion action.
- Marketing export/CSV, a marketing leaderboard page, or marketing-action
  reporting separate from the Super Admin stats view.
- A marketer ability to assign/unassign, delete, restore, or bulk-delete leads.
- Assignment notifications, claim notifications, marketer digests, or
  calendar-write notifications.
- A Calendly webhook receiver. Current Calendly integration is polling/sync.
- A marketer ability to manage other marketers or to view another marketer's
  performance/calendar as a marketing user.

## 4. File map

| Path | Responsibility |
|---|---|
| `artifacts/jobsage-web/src/lib/roleAccess.ts:1-25` | Role names, admin roles, leads roles, marketing navigation, delete rule. |
| `artifacts/jobsage-web/src/App.tsx:157-205,297-313` | `AdminGuard`, `LeadsGuard`, `SuperAdminGuard`, route registration, `/impersonate`. |
| `artifacts/jobsage-web/src/components/layout/AuthGuard.tsx:12-131` | Public paths, marketing redirect, consent/profile bypass, loading. |
| `artifacts/jobsage-web/src/components/layout/AppSidebar.tsx:56-143,197-228` | Marketing/admin/super-admin navigation and logout. |
| `artifacts/jobsage-web/src/pages/LoginPage.tsx:44-75,127-260` | Shared login form, verification resend, exact login copy. |
| `artifacts/jobsage-web/src/pages/admin/AdminLeadsPage.tsx:367-915` | CRM query, filters, projections, claim, status, assignment, delete, copy. |
| `artifacts/jobsage-web/src/pages/admin/AdminCalendarPage.tsx:22-204` | Accessible leads, Calendly URL card, calendar page shell. |
| `artifacts/jobsage-web/src/components/admin/MarketerCalendar.tsx:134-713` | Calendar views, sync, event dialogs, event permissions/copy. |
| `artifacts/jobsage-web/src/pages/admin/SuperAdminPage.tsx:216-395,398-573,710-1067` | Super-admin marketing stats, user detail, create/invite form, directory. |
| `artifacts/jobsage-web/src/pages/AdminUsersPage.tsx:157-465` | Exact-admin user lookup and verification/reset actions. |
| `artifacts/jobsage-web/src/pages/ImpersonatePage.tsx:17-63` | One-time impersonation activation and redirect. |
| `artifacts/jobsage-web/src/components/layout/AppLayout.tsx:23-75` | Impersonation banner and stop button. |
| `artifacts/api-server/src/routes/auth.ts:86-506` | Auth status, registration, login, reset, verification, logout. |
| `artifacts/api-server/src/routes/leads.ts:115-819,849-1110` | Lead CRM, public capture/chat, Calendly URL, and status/assignment actions. |
| `artifacts/api-server/src/routes/marketerCalendar.ts:14-344` | Calendar CRUD, status, and Calendly sync. |
| `artifacts/api-server/src/routes/superAdmin.ts:272-928` | Super-admin directory, marketing creation, Calendly, impersonation, lifecycle. |
| `artifacts/api-server/src/routes/adminUsers.ts:18-303` | Exact-admin account lookup and verification/reset actions. |
| `artifacts/api-server/src/middlewares/authMiddleware.ts:27-71` | Session lookup and impersonated-user resolution. |
| `artifacts/api-server/src/middlewares/requireRole.ts:9-47` | 401/403 role and impersonation write gates. |
| `artifacts/api-server/src/lib/auth.ts:7-70` | Session storage, seven-day cookie/session helpers, bearer lookup. |
| `artifacts/api-server/src/lib/email.ts:22-170,385-415,814-822` | Email configuration, waitlist welcome, verification, reset/invite. |
| `lib/db/src/schema/auth.ts:14-33` | Users and sessions schema. |
| `lib/db/src/schema/socialLeads.ts:20-82` | Lead schema, ownership FK, indexes, waitlist delivery metadata. |
| `lib/db/src/schema/marketerEvents.ts:5-34` | Calendar/event schema. |
| `lib/db/drizzle/0010_social_leads.sql` through `0030_calendly_event_sync.sql` | Lead assignment, Calendly URL/timestamps/event-sync migration history. |
| `lib/api-spec/openapi.yaml:2412-3571` | Partial lead, super-admin, and impersonation contract. |
| `lib/api-zod/src/generated/api.ts:2888-3030,3738-3890` | Generated subset of lead/super-admin schemas. |
| `lib/api-client-react/src/generated/api.ts` | Generated client; lacks several implemented routes. |
| `artifacts/api-server/src/__tests__/routes/leads.test.ts:129-880` | Lead scope, redaction, claim, status, assignment, Calendly tests. |
| `artifacts/api-server/src/__tests__/routes/superAdmin.test.ts:119-390` | Marketing creation, invitation rollback, listing, performance tests. |

## 5. Account lifecycle

### 5.1 Creation and invitation

Only `super_admin` may create a marketing account through the explicit
marketing-account endpoint. The server validates an email and first/last names,
trims names, rejects duplicates, validates an optional Calendly URL, and
inserts:

```json
{
  "email": "marketer@example.com",
  "firstName": "Maya",
  "lastName": "Jones",
  "calendlyUrl": "https://calendly.com/maya-jones"
}
```

The 201 response is:

```json
{
  "message": "Marketing account created. A password setup link has been sent.",
  "user": {
    "id": "user-id",
    "email": "marketer@example.com",
    "firstName": "Maya",
    "lastName": "Jones",
    "role": "marketing",
    "emailVerified": false,
    "calendlyUrl": "https://calendly.com/maya-jones"
  }
}
```

The exact implementation and rollback behavior are in
`superAdmin.ts:370-464`; tests cover normalization, duplicates, optional URL,
mail invocation, and rollback on a thrown mail failure
(`artifacts/api-server/src/__tests__/routes/superAdmin.test.ts:119-280`).

The invitation calls `sendPasswordResetEmail`, with subject/template semantics
for a normal password reset, not a dedicated marketing invitation
(`email.ts:814-822`). The setup token is stored in
`passwordResetToken` and expires after 24 hours. The account has no password
until the recipient completes reset. There is no separate `invitedAt`,
`invitationStatus`, `invitationToken`, or active field.

Validation/status behavior:

- Invalid body, invalid names, or invalid Calendly URL: 400.
- Duplicate normalized email: 409.
- Thrown invitation delivery failure: 503; the inserted user is deleted.
- Success: 201 and an audit event.
- The invitation endpoint is super-admin-only; `admin` is not accepted.

The regular `POST /api/auth/register` creates a candidate/default-role account,
not a marketer. `POST /api/auth/employer-register` creates an employer. No
self-registration path assigns `marketing` (`auth.ts:93-230`).

### 5.2 First login, password reset, and verification

The invite URL points to `/reset-password?token=...`. A valid
`POST /api/auth/reset-password` requires a token and password of at least eight
characters, hashes the password, sets `emailVerified = true`, clears both reset
and verification fields, and returns:

```json
{"message":"Password updated successfully. You can now sign in."}
```

It does not log the user in or create a session (`auth.ts:403-447`).

The shared login endpoint:

- Missing fields: 400 `{"error":"Email and password are required"}`.
- Unknown email or password mismatch: 401 `{"error":"Invalid email or password"}`.
- Correct password but unverified: 403 with `code: "email_not_verified"`.
- Suspended account: 403 with `code: "account_suspended"`.
- Success: creates a seven-day session, sets the `sid` cookie, audits login
  asynchronously, and returns the current-user envelope plus `token: sid`
  (`auth.ts:280-352`).

The regular login page uses `credentials: "include"` and redirects to `/` after
success. Relevant copy is `Sign in`, `Welcome back to JOBSAGE`, `Email address`,
`Password`, `Forgot password?`, `Signing in…`, `Create account`, and the
verification-resend states in `LoginPage.tsx:127-260`.

The account can use the public forgot-password path. Unknown addresses receive
the same safe 200 response as known addresses; email errors are logged and do
not change the response (`auth.ts:360-401`). The admin password-reset route
creates a one-hour reset token, rather than the public reset flow's 24-hour
token (`adminUsers.ts:208-256`).

### 5.3 Sessions, logout, suspension, deletion, and role changes

`sid` is the session cookie. It is HttpOnly, Secure, SameSite=Lax, path `/`, and
has a seven-day max age (`auth.ts:69-76`). The server accepts
`Authorization: Bearer <session-id>` before falling back to the cookie
(`lib/auth.ts:7-70`). Authenticated frontend requests generally use
`credentials: "include"`.

Logout is idempotent: `POST /api/auth/logout` deletes the session if present,
clears the cookie, and returns `{"success":true}`
(`auth.ts:354-358`).

Super-admin lifecycle actions are:

- `POST /api/admin/super/users/:id/suspend`: self-suspension is 400, missing
  target is 404, already suspended is 409, and suspending another
  super-admin is 403. Otherwise it sets `suspendedAt`.
- `POST /api/admin/super/users/:id/restore`: missing target is 404,
  non-suspended target is 409, otherwise clears `suspendedAt`.
- `DELETE /api/admin/super/users/:id`: cannot delete self (400) or another
  super-admin (403); success is `{"deleted":true,"id":"..."}`.
- `PATCH /api/admin/super/users/:id/role`: accepts candidate, employer,
  reviewer, admin, super_admin, or marketing. Self-demotion is 400. It records
  the from/to role and returns the updated row.

These routes are `super_admin` only
(`superAdmin.ts:833-928`). There is no `active` column, no admin deactivation
route, and no dedicated marketer deactivate operation. Suspend is the
available account disable action.

Important existing session behavior:

- Login checks `suspendedAt`, but normal requests use the user object stored in
  the session and do not re-query current suspension, deletion, verification,
  or role. Suspending, deleting, unverifying, or changing role therefore does
  not revoke an already-issued ordinary session.
- There is no “revoke all sessions” or forced logout endpoint.
- `marketing_user_id` is `ON DELETE SET NULL`, so deleting a marketer unassigns
  its leads (`socialLeads.ts:63-68`; `0019_marketing_lead_assignment.sql:1-6`).
- `marketer_events.marketing_user_id` is `ON DELETE CASCADE`, so deleting a
  marketer deletes its calendar events (`marketerEvents.ts:8-12`).

## 6. Authentication and authorization

### Frontend roles and guards

```ts
ADMIN_ROLES = ["admin", "super_admin"]
LEADS_ROLES = ["admin", "super_admin", "marketing"]
MARKETING_NAVIGATION = [
  { name: "Waitlist Leads", href: "/admin/leads" },
  { name: "Calendar", href: "/admin/calendar" }
]
```

These exact values are in `roleAccess.ts:1-25`.

- `AdminGuard` allows only `admin` and `super_admin`.
- `LeadsGuard` allows `admin`, `super_admin`, and `marketing`.
- `SuperAdminGuard` allows only `super_admin`.
- `/admin/leads` and `/admin/calendar` use `LeadsGuard`.
- `/admin/users` uses `AdminGuard`; a super-admin sees the Super Admin user
  directory while an ordinary admin sees `AdminUsersPage`.
- `/admin/super` and `/admin/sync` are super-admin-only.
- `/impersonate` is wrapped by `AuthGuard`, but has no role-specific route
  guard; marketing is still redirected by `AuthGuard` because it is not one of
  the two exact marketing paths (`App.tsx:157-205,297-313`).

`AuthGuard` public paths include `/login`, `/register`, `/employer/register`,
`/forgot-password`, `/reset-password`, and `/`. Marketing skips consent/profile
queries and is redirected to `/admin/leads` from every other location
(`AuthGuard.tsx:12-86`).

### Backend middleware

`requireRole` first requires a session and returns:

```json
{"error":"Not authenticated."}
```

with 401. During impersonation, every protected non-GET is blocked before the
route with:

```json
{"error":"Write operations are not permitted during impersonation."}
```

with 403. A role mismatch returns:

```json
{"error":"Access denied. Required role(s): admin, super_admin."}
```

with 403. Roles are an exact allow-list; there is no hierarchy, so `admin` does
not satisfy `super_admin` and vice versa
(`requireRole.ts:29-47`).

`requireAuthenticated` additionally rejects marketing for candidate-facing
routes with:

```json
{"error":"Marketing accounts may only access leads management."}
```

(`requireRole.ts:9-23`). This is why marketing does not gain candidate or
general authenticated APIs merely by knowing their URLs.

### Permission matrix

| Method/path family | `admin` | `super_admin` | `marketing` | Other roles |
|---|---:|---:|---:|---:|
| `GET /api/leads` | yes, full projection | yes, full projection | yes, own/unassigned or own scope | 403 |
| `GET /api/leads/my-performance` | no | no | yes | 403 |
| `GET /api/leads/assignees` | yes | yes | 403 | 403 |
| `POST /api/leads/:id/claim` | 403 | 403 | yes, unassigned only | 403 |
| `GET/PATCH /api/me/calendly-url` | 403 | 403 | yes, own row | 403 |
| `PATCH /api/leads/:id/assignee` | yes | yes | 403 | 403 |
| `PATCH /api/leads/bulk-assignee` | yes | yes | 403 | 403 |
| `PATCH /api/leads/:id/status` | yes | yes | yes, owned only | 403 |
| `PATCH /api/leads/bulk-status` | yes | yes | yes, all IDs owned | 403 |
| `DELETE /api/leads` | yes | yes | 403 | 403 |
| Calendar events/status | yes, any permitted target | yes, any permitted target | yes, own only | 403 |
| Calendly sync | yes | yes | 403 | 403 |
| `GET /api/admin/super/*` | 403 | yes | 403 | 403 |
| `GET/POST /api/admin/users/*` | yes, exact admin | 403 | 403 | 403 |
| Candidate/employer/profile APIs | normally 403 or candidate-specific | route-specific | blocked by marketing guard | route-specific |

The backend route definitions are in
`leads.ts:115-819`, `marketerCalendar.ts:14-344`,
`superAdmin.ts:272-928`, and `adminUsers.ts:18-303`.

## 7. Marketing lead inbox

### Page, scope, and fields

The page is `/admin/leads`. Its heading is **Waitlist Leads** and its subtitle
is **Contacts from the waitlist page** followed by the filtered total
(`AdminLeadsPage.tsx:551-555`).

The list supports page/limit, name/email search, sector search, and role-specific
assignee scope. The API defaults to page 1 and limit 25, clamps the limit to
1–100, searches email/first/last name case-insensitively, filters sector by
substring, and orders newest first (`leads.ts:115-207`).

Marketing's default request is own plus unassigned. The **Including
unassigned** checkbox changes the request to omit the assignee restriction,
after which the server still post-filters to the caller's own or unassigned
rows. Marketing cannot use the admin assignee selector. Admin and super-admin
can select **All assignees**, **Unassigned**, or a named marketer
(`AdminLeadsPage.tsx:391-428,663-728`; `leads.ts:60-78,115-207`).

Admin/super-admin receive the full CRM projection, including:

```json
{
  "id": 7,
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "phone": "+44 7700 000000",
  "industrySector": "Healthcare",
  "desiredRole": "Nurse",
  "additionalMessage": null,
  "utmSource": "campaign",
  "utmMedium": "paid-social",
  "utmCampaign": "uk-careers",
  "utmContent": null,
  "landingPath": "/get-started",
  "referrerUrl": "https://example.test",
  "ipHash": "sha256-hex-value",
  "gdprConsent": true,
  "gdprConsentedAt": "2026-09-14T12:00:00.000Z",
  "status": "new",
  "source": "form",
  "convertedUserId": null,
  "marketingUserId": null,
  "createdAt": "2026-09-14T12:00:00.000Z",
  "assignee": null
}
```

Marketing receives the reduced projection: lead ID, name, email, phone, sector,
source, status, created time, desired role, additional message, and resolved
assignee identity/Calendly URL. It does not receive UTM fields, landing path,
referrer URL, IP hash, consent fields, converted-user ID, or raw owner ID in
the reduced lead object (`leads.ts:13-57,164-197`; tests
`leads.test.ts:129-213`).

The table headings are **Name**, **Email**, **Phone**, **Sector**, **Source**,
**Booking**, **Assigned**, **Status**, and **Date**. Source labels are **AI
Chat** and **Form**. Missing phone is `—`; missing sector is `Not provided`
(`AdminLeadsPage.tsx:771-830`).

### Actions and status

Marketing may:

- Click **Claim** on an unassigned row. A successful claim makes the row show
  **Claimed by you**. A race with another claim returns 409 and the inline
  failure defaults to **Could not claim this lead.**
- Change the status of an assigned lead to `new`, `contacted`, `registered`,
  or `unqualified`, singly or in bulk.
- Open **Calendar** / **Book a call in Calendar** for a lead.
- Save or clear its own Calendly URL.

Marketing cannot select an unassigned row for bulk status work and cannot
status-edit an unassigned row. The API independently enforces ownership.
Changing status to `contacted` sets `contactedAt` only when it is null; claiming
does not contact the lead (`AdminLeadsPage.tsx:201-267,432-455,801-843`;
`leads.ts:267-299,684-819`).

Admin and super-admin additionally see per-row assignee controls, can assign or
unassign single/bulk, and can permanently delete selected leads. Assignment
requires the target to be a marketing-role user. Bulk assignment returns an
updated count and does not require every supplied ID to exist
(`leads.ts:378-496`).

The process display is derived from the lead, not a separate workflow table:
**Captured**, **Claimed**, **Contacted**, and **Registered**. State labels
include **Unqualified / Disqualified**, **✓ Converted to User**, **In Contact /
Follow-up**, **Claimed • Pending First Outreach**, and **New Inbound • Ready to
Claim** (`AdminLeadsPage.tsx:270-360`).

### Performance and page states

Marketing sees these cards:

- **Assigned to Me**
- **Contacted**
- **Registered**
- **Conversion Rate**
- **Avg Response Time**

The values come from `GET /api/leads/my-performance`, which returns
`assignedCount`, `contactedCount`, `registeredCount`,
`conversionRate` (rounded to one decimal), and nullable
`averageResponseTimeMinutes`. The marketing query refreshes every 30 seconds
(`AdminLeadsPage.tsx:391-397,646-659`; `leads.ts:210-236`).

Current lead-page copy/states:

- Search: **Search by name or email…**
- Sector: **Filter by Sector**, **All Industries**
- Marketing scope: **Including unassigned**
- Bulk controls: **Set status…**, **Apply**
- Claim error: **Could not claim this lead.**
- Load error: **Failed to load leads. Please refresh.**
- Empty: **No leads match your search.** or **No leads yet.**
- Pagination: **Page X of Y · N total**, **Previous**, **Next**

Admin-only copy includes **Filter by assignee**, **All assignees**,
**Unassigned**, **Assign selected…**, **Unassign selected**, **Assign**, and
**Delete**. The delete dialog says **Delete N lead(s)?** and
**This will permanently remove this lead/these N leads from the system. This
action cannot be undone.** with **Cancel** and **Delete**
(`AdminLeadsPage.tsx:558-638,663-766,891-910`).

## 8. Calendar and Calendly

### Page and personal link

`/admin/calendar` is shared by the three leads roles. The page heading is
**Calendar** with **Schedule, manage, and track marketer calls.**
(`AdminCalendarPage.tsx:170-180`).

Marketing additionally sees:

- **My Calendly link**
- **Use this link for calls assigned to you and for the Live Calendly view.**
- Placeholder `https://calendly.com/your-name`
- **Save link** / **Saving...**
- **Calendly link saved.** / **Calendly link cleared.**

The card uses `GET/PATCH /api/me/calendly-url`. The parser permits a Calendly
URL, an empty value to clear, or null; an invalid URL returns 400
(`AdminCalendarPage.tsx:46-131`; `leads.ts:301-337`).

### Events and views

The calendar presents **Month View**, **Week View**, **Upcoming Agenda**, and
**Live Calendly**, with previous/next controls. Event statuses are
**Scheduled**, **Completed**, **Rescheduled**, **Cancelled**, and **No show**.
Agenda empty copy is **No calls scheduled in the upcoming period.**
(`MarketerCalendar.tsx:66-117,440-580`).

The schedule dialog is **Schedule a call** with
**Book a conversation and keep the lead timeline up to date.** It supports a
linked or unlinked lead, title, start, optional end, meeting URL, notes, and
owner. Current labels include **Lead**, **No linked lead**, **Discovery Call with
Jane Doe**, **Meeting link**, **Calendly, Google Meet, or Zoom link**, **Notes /
agenda**, **What should be covered?**, **Cancel**, and **Schedule call** /
**Saving…** (`MarketerCalendar.tsx:582-608`).

Creating a linked manual event:

- requires a marketing owner; marketing is forced to itself;
- validates lead existence and, for marketing, lead ownership;
- changes a `new` linked lead to `contacted` and sets `contactedAt`;
- returns 201 with `{ "event": ... }`.

Marketing can edit manual event title/time/end/link/notes/status within the
route validation. Calendly events allow only local notes and permitted outcome
status changes. Attempts to change Calendly-managed title/time/link or delete a
Calendly event return 409. Manual deletion returns `{ "id": number }`
(`marketerCalendar.ts:138-344`).

Admin/super-admin load marketer assignees, can use **All Marketers**, can filter
events with `marketingUserId`, can view other marketers' Calendly pages, and can
start **Sync Calendly**. Marketing is restricted to its own events and does not
see the marketer picker. Sync status says **Calendly has not imported any
events for this calendar yet.** or **Last Calendly sync <date> · N synced
event(s)**, and says **Automatic sync runs every 10 minutes.**
(`MarketerCalendar.tsx:216-354,440-490`;
`marketerCalendar.ts:103-344`).

The scheduler starts after a short startup delay and runs every ten minutes.
The sync uses a transaction advisory lock, maps hosts to marketing users, links
invitee emails to assigned/unassigned leads, preserves local completed/no-show
outcomes, and upserts external event URIs
(`artifacts/api-server/src/lib/calendlySync.ts:153-358`;
`artifacts/api-server/src/lib/calendlySyncScheduler.ts:6-37`). There is **no
Calendly webhook implementation**.

## 9. Admin oversight of marketers

This is a separate product surface from the marketer's own inbox.

### 9.1 Super-admin directory and account management

The Super Admin page is available only at `/admin/super` to `super_admin`.
Its tabs include **Overview**, **Marketing**, **All Users**, **Job Listings**,
**Employers**, **Platform Health**, **Identity Queue**, and **References**
(`SuperAdminPage.tsx:1863-1912`).

The **All Users** tab is the marketer directory in practice. It is a general
user directory, not a dedicated marketer page. It supports:

- Search by email.
- Role filters: **All Roles**, **Candidate**, **Employer**, **Admin**,
  **Reviewer**, **Super Admin**, **Marketing**.
- Verification filters: **All Verification**, **Verified**, **Unverified**.
- From/To dates and **Refresh**.
- Sortable columns: ID, Email, Role, Verified, Profile %, Docs, Apps,
  Eligibility, Consent, Joined, Last Activity.
- Pagination with **Previous**, **Page X of Y**, **Next**.
- Expanded user detail with role, verification, profile/application/document
  metadata, consent, last login, suspension state, and audit events.

The server endpoint is
`GET /api/admin/super/users?role=marketing`. It has fixed page size 25,
role/verified/email/date filters, an allow-listed sort field, and returns
`{users,total,page,pageSize}` with user identity, role, verification,
created/updated/suspension, last-login, document/application/profile,
eligibility, consent, and activity fields
(`superAdmin.ts:272-368`; `SuperAdminPage.tsx:814-1067`).

The expanded user panel provides:

- **Impersonate (Read-Only)**
- **Suspend** or **Restore Account**
- **Delete Account**
- Role changes through Candidate, Employer, Reviewer, Admin, Super Admin,
  and Marketing
- For marketing users, **Calendly URL** and **Save Calendly link**

The server operations are exact-super-admin routes
(`superAdmin.ts:466-518,833-928`). Suspending a user prevents future login but
does not invalidate a normal existing session. Deleting a marketer sets
assigned leads' owner to null and cascades marketer events as described in
section 5.

The create form is admin oversight of marketer accounts, not a marketer
capability. Exact copy:

- **Create marketing account**
- **The new user will receive a one-time link to set their password. No
  password is entered or stored here.**
- **First name**, **Last name**, **Email address**
- **Calendly URL (optional)**
- **Create & invite** / **Sending...**
- Success: **Marketing account created** and **A secure password setup link has
  been sent to the new account.**
- Failure: **Could not create account**

(`SuperAdminPage.tsx:710-812`).

### 9.2 Performance and comparison

The Super Admin **Marketing** tab calls
`GET /api/admin/super/stats?industry=...` and displays:

- **Total Leads**
- **Leads in 7 Days**
- **Registered Leads**, with a seven-day subtext
- **Conversion Rate**
- **Lead status**
- **Lead source**
- **Industry**
- **Performance by marketer**

The performance table columns are **Marketer**, **Assigned**, **Contacted**,
**Registered**, **Conv. Rate**, **Avg Response**, and **Industries**.
Unassigned rows display **None** for marketer/industry where applicable and
missing response time displays `—` (`SuperAdminPage.tsx:216-395`;
`superAdmin.ts:40-270`).

This is the implemented admin/super-admin comparison surface. There is no
separate admin-only performance endpoint or leaderboard page. `my-performance`
is for the marketing user only; the super-admin stats response contains the
per-marketer aggregation.

### 9.3 Leads, assignment, and calendars

Admin and super-admin oversight appears in existing operational screens:

- `/admin/leads` has the assignee dropdown **Filter by assignee** with **All
  assignees**, **Unassigned**, and named marketers.
- Single and bulk assignment can assign a marketing user or unassign with
  **Unassign selected**.
- The lead row's **Assigned** field displays the marketer's name/email.
- The same page exposes full lead fields and admin/super-admin-only Delete.
- `/admin/calendar` loads all accessible leads and marketer assignees. Admin
  can use `marketingUserId` to view one marketer or omit it to view all.
- Admin/super-admin can trigger `POST
  /api/marketer/calendar/calendly/sync`; marketing cannot.

The relevant APIs are `GET /api/leads/assignees`,
`PATCH /api/leads/:id/assignee`, `PATCH /api/leads/bulk-assignee`,
`GET /api/marketer/calendar/events?marketingUserId=...`, and the sync route
(`leads.ts:243-265,378-496`;
`marketerCalendar.ts:103-135,221-243`).

### 9.4 Impersonation

The Super Admin directory opens a new tab with
`/impersonate?token=<token>`. Start is:

```http
POST /api/admin/super/impersonate/{userId}
```

and returns:

```json
{
  "token": "one-time-token",
  "expiresAt": "2026-09-16T12:15:00.000Z",
  "targetUser": {
    "id": "user-id",
    "email": "marketer@example.com",
    "displayName": "Maya Jones",
    "role": "marketing"
  }
}
```

The token creates a separate 15-minute session. Activation at
`GET /api/admin/super/impersonate/activate?token=...` requires the caller's
existing session to be `super_admin`, attaches `impersonatingUserId` to that
session, consumes the one-time token, and returns `{user,adminId}`. It does not
set a new cookie despite the OpenAPI description saying that it does
(`superAdmin.ts:520-627`; `ImpersonatePage.tsx:17-63`).

During activation, `authMiddleware` re-reads the target user on every request.
Protected GETs act as the target. Protected non-GETs return the impersonation
write-block response. The app banner says **Impersonating: <name> (<email>)**,
shows the role, **Read-only — all writes blocked**, and a **Stop Impersonating**
button (`AppLayout.tsx:23-75`).

Stop is `POST /api/admin/super/impersonate/stop`. It restores the original
admin identity in the same session and returns `{ "ok": true }`. It has no role
middleware of its own, but ordinary users cannot acquire
`impersonatingUserId` through the public routes (`superAdmin.ts:556-577`).

### 9.5 Admin versus marketing visibility

| Data/action | Admin / super-admin | Marketing |
|---|---|---|
| Full lead projection, UTM, IP hash, GDPR, converted-user ID | Yes | No; reduced projection |
| Assignee filter | Yes | No |
| Assign/unassign single lead | Yes | No |
| Bulk assign/unassign | Yes | No |
| Delete leads | Yes | No |
| Create/invite marketers | Super-admin only | No |
| View another marketer's leads | Admin/super-admin via assignee filter | No |
| View another marketer's calendar | Admin/super-admin | No |
| Compare marketer performance | Super-admin Marketing tab | No; own metrics only |
| Set another user's Calendly URL | Super-admin only | No; own URL only |
| User directory and role changes | Super-admin; exact admin has limited lookup | No |
| Suspend/restore/delete | Super-admin only | No |
| Impersonation | Super-admin only | No |
| Export/reporting | **Not implemented** | **Not implemented** |

There is no admin dashboard widget specifically showing “today's claims” or
“unclaimed queue”; the general Super Admin stats/Marketing tab and leads table
are the implemented oversight surfaces.

## 10. API inventory

### 10.1 Lead APIs

All paths below are under `/api`.

| Method/path | Role | Request | Success and material behavior |
|---|---|---|---|
| `GET /leads` | admin, super_admin, marketing | `page`, `limit`, `search`, `sector`, `assignedTo` | `{leads,total,page,limit,stats}`; marketing scope/projection differs from admins. 400 for invalid query; 401/403 from middleware. `leads.ts:115-207`. |
| `GET /leads/my-performance` | marketing | none | `{assignedCount,contactedCount,registeredCount,conversionRate,averageResponseTimeMinutes}`. Marketing only. `leads.ts:210-236`. |
| `GET /leads/assignees` | admin, super_admin | none | `{assignees:[{id,email,name,calendlyUrl}]}` for role-marketing users. `leads.ts:243-265`. |
| `POST /leads/:id/claim` | marketing | numeric path ID | 200 claim object; 400 bad ID; 404 missing; 409 already assigned. Atomic owner/claim timestamp update. `leads.ts:267-299`. |
| `GET /me/calendly-url` | marketing | none | `{calendlyUrl:string|null}`. Missing account 404. `leads.ts:301-312`. |
| `PATCH /me/calendly-url` | marketing | `{calendlyUrl}` | 200 same shape; 400 invalid URL; 404 missing account. Empty/null clears. `leads.ts:314-337`. |
| `GET /leads/sectors` | public | none | `{sectors:[...]}` from sponsor licence industries, cacheable; 500 `Could not load sector list.` It is not a marketing-account endpoint, but feeds the public waitlist form. `leads.ts:344-368`. |
| `PATCH /leads/:id/assignee` | admin, super_admin | `{marketingUserId:string|null}` | 200 `{id,marketingUserId,assignee}`; 400 invalid/non-marketing target; 404 lead missing. `leads.ts:378-433`. |
| `PATCH /leads/bulk-assignee` | admin, super_admin | `{ids:number[],marketingUserId:string|null}` | 200 `{updated,marketingUserId,assignee}`; 400 invalid/empty IDs or assignee. Matching rows only. `leads.ts:445-496`. |
| `PATCH /leads/:id/status` | admin, super_admin, marketing | `{status:"new"|"contacted"|"registered"|"unqualified"}` | 200 `{id,status}`; 400 validation; 403 marketing foreign owner; 404 missing/inaccessible. `contactedAt` side effect. `leads.ts:761-819`. |
| `PATCH /leads/bulk-status` | admin, super_admin, marketing | `{ids:number[],status}` | 200 `{updated}`; 400 validation; marketing transaction rejects foreign ownership with 403 or missing with 404. `contactedAt` side effect. `leads.ts:684-755`. |
| `DELETE /leads` | admin, super_admin | `{ids:unknown[]}` | 200 `{deleted:number}`; 400 if no valid positive IDs. Permanent; no restore. `leads.ts:653-678`. |

The public capture routes are already specified in
`docs/waitlist-technical-spec.md` and are not repeated here:
`POST /leads/submit` persists a form lead and returns 201; `POST /leads/chat`
is an SSE chat route that progressively persists chat leads. Both are public
and absent from OpenAPI/generated contracts.

### 10.2 Calendar APIs

| Method/path | Role | Request/behavior | Responses |
|---|---|---|---|
| `GET /marketer/calendar/events` | marketing, admin, super_admin | Optional ISO `start`, `end`; admin may add `marketingUserId`. Marketing is forced to own events. | `{events:[event,lead,marketer]}`; 400 invalid range; 401/403. `marketerCalendar.ts:103-135`. |
| `POST /marketer/calendar/events` | marketing, admin, super_admin | `title`, `scheduledAt`; optional `leadId`, `marketingUserId`, `endTime`, `meetingUrl`, `notes`. | 201 `{event}`; 400 validation/owner/time; 403 foreign marketing lead; 404 lead. Linked new lead becomes contacted. `:138-206`. |
| `GET /marketer/calendar/calendly/status` | marketing, admin, super_admin | Optional admin owner filter. | Sync status; marketing forced own. `:208-219`. |
| `POST /marketer/calendar/calendly/sync` | admin, super_admin | Optional `{marketingUserId}`. | `{summary,status}`; 503 Calendly auth/permission issue; 502 other sync failure. `:221-243`. |
| `PATCH /marketer/calendar/events/:id` | marketing, admin, super_admin | Optional event fields; marketing owner-scoped. | 200 `{event}`; 400 validation/time; 404 inaccessible/missing; 409 forbidden Calendly-owned edit. `:246-308`. |
| `DELETE /marketer/calendar/events/:id` | marketing, admin, super_admin | Event ID; owner-scoped for marketing. | Manual 200 `{id}`; 404 missing/inaccessible; 409 Calendly event. `:310-344`. |

### 10.3 Super-admin account, stats, and impersonation APIs

| Method/path | Role | Behavior |
|---|---|---|
| `GET /admin/super/stats` | super_admin | Optional industry filter; platform counts plus per-marketer performance, status/source/industry aggregates. `superAdmin.ts:40-270`. |
| `GET /admin/super/users` | super_admin | General user directory with role, verification, email/date, sorting, and pagination filters. `:272-368`. |
| `POST /admin/super/marketing-accounts` | super_admin | Creates/invites marketing account; 400 validation, 409 duplicate, 503 thrown invitation failure/rollback, 201 success. `:370-464`. |
| `PATCH /admin/super/users/:id/calendly-url` | super_admin | Optional URL; 400 invalid/non-marketing, 404 missing, 200 `{calendlyUrl}`. `:466-501`. |
| `GET /admin/super/users/:id/full` | super_admin | Full user/profile/document/application/eligibility/audit/consent detail; 404 missing. `:503-518,700-793`. |
| `GET /admin/super/impersonate/activate?token=` | authenticated caller plus super-admin session | 400 missing token, 401 invalid/no admin session, 403 non-super-admin, 200 `{user,adminId}`. Consumes token and updates current session. `:520-554`. |
| `POST /admin/super/impersonate/stop` | authenticated session | 401 missing/invalid, 400 not impersonating, 200 `{ok:true}`. `:556-577`. |
| `POST /admin/super/impersonate/:id` | super_admin | 404 target missing; 200 token/expiry/target. Creates a 15-minute token session. `:579-627`. |
| `POST /admin/super/users/:id/suspend` | super_admin | 400 self, 403 target super-admin, 404 missing, 409 already suspended, otherwise 200 updated user. `:835-857`. |
| `POST /admin/super/users/:id/restore` | super_admin | 404 missing, 409 not suspended, otherwise 200. `:859-875`. |
| `DELETE /admin/super/users/:id` | super_admin | 400 self, 403 another super-admin, 404 missing, otherwise 200 deleted object. `:877-898`. |
| `PATCH /admin/super/users/:id/role` | super_admin | 400 invalid role/self-demotion, 404 missing, otherwise 200 updated row. `:900-928`. |

### 10.4 Exact-admin account APIs

These do not accept `super_admin` because they use exact
`requireRole("admin")`:

- `GET /admin/users/search?email=`: exact normalized lookup; 400 invalid query,
  404 missing; returns identity, role, verification, password presence,
  token-expiry timestamps, and created/updated timestamps.
- `POST /admin/users/:id/mark-verified`: 400/404/409; clears verification
  token and returns a message.
- `POST /admin/users/:id/unverify`: 400/404/409; revokes verification.
- `POST /admin/users/:id/resend-verification`: 404/422/409/503 cases; writes
  a 24-hour token before sending.
- `POST /admin/users/:id/send-password-reset`: 404/422/503 cases; writes a
  one-hour reset token before sending.
- `GET /admin/users/:id/audit-events`: returns recent `admin_*` actions, with
  default limit 5 clamped to 1–20.

(`artifacts/api-server/src/routes/adminUsers.ts:18-303`.)

There is no exact-admin API for creating, inviting, changing the role of,
suspending, restoring, deleting, or impersonating a marketer. Those operations
are **not implemented** for ordinary `admin`; the corresponding lifecycle
routes are exact-super-admin routes.

## 11. API contract and generated-code drift

The OpenAPI and generated outputs describe only part of the running routes.
This is a contract/documentation gap, not evidence that the source route is
absent.

Present in `lib/api-spec/openapi.yaml` and generated subsets:

- `/leads`
- `/leads/assignees`
- `/leads/my-performance`
- `/leads/{id}/claim`
- `/me/calendly-url`
- `/leads/{id}/assignee`
- `/leads/bulk-assignee`
- Super-admin stats/users/marketing-account/Calendly/full-user/impersonation/
  health paths (`openapi.yaml:2412-2723,3287-3630`).

Implemented routes missing from OpenAPI, api-zod, and/or the generated React
client include:

- `GET /leads/sectors`
- `POST /leads/submit`
- `POST /leads/chat`
- `DELETE /leads`
- `PATCH /leads/:id/status`
- `PATCH /leads/bulk-status`
- Every `/marketer/calendar/*` route
- Every `/admin/users/*` route
- `POST /auth/employer-register`

Specific mismatches:

- The generated lead item is an unconstrained record, so field-level
  projection/redaction is not enforced by generated validation
  (`lib/api-zod/src/generated/api.ts:2888-2917`;
  `lib/api-client-react/src/generated/api.schemas.ts:1819-1840`).
- Generated `ClaimLeadResponse` requires `contactedAt` as a `Date`, but the
  implementation can return null.
- Generated bulk-assignment IDs use `z.number()` while the server accepts
  coercible numbers with `z.coerce.number()`.
- Generated/specified Calendly URL bodies describe nullable URL values, while
  the server parser also accepts an empty string to clear.
- The generated full-user schema under-specifies fields such as `suspendedAt`
  and audit `details`.
- The OpenAPI activation description says a session cookie is set, but the
  implementation updates the existing session and does not set a cookie.
- OpenAPI does not fully describe activation's 400/403 behavior.
- Login's extra `token` response property and suspended-account 403 code are
  not fully represented.
- Email-resend 429/cooldown behavior is absent from the OpenAPI/generated
  contract.
- `GET /auth/verify-email` redirects on success and invalid/expired tokens;
  the OpenAPI description also lists a JSON 400 that the implementation does
  not use.

The frontend admin login page calls `/api/auth/me`, but the current server
defines `/api/auth/user` and no `/api/auth/me` route
(`AdminLoginPage.tsx:20-50`; `auth.ts:86-91`). The regular app layout uses
`/api/auth/user` (`AppLayout.tsx:23-44`). This is a current implementation
contradiction worth preserving when porting.

## 12. Data model and migrations

### 12.1 Users and sessions

`users` has:

- `id` varchar primary key with generated UUID default.
- Unique nullable `email`.
- Nullable first/last/profile image.
- Nullable `calendly_url`.
- Non-null role defaulting to `candidate`, with the six application values.
- Nullable `password_hash`.
- Non-null `email_verified` default false.
- Verification/reset token and expiry columns.
- Nullable `suspended_at`.
- Unique nullable `jobsage_email`.
- Created/updated timestamps.

`user_sessions` stores `sid` primary key, JSON session payload, and expiry with
an expiry index (`auth.ts:4-12,14-33`). A session is normally seven days; the
one-time impersonation session is 15 minutes.

### 12.2 Leads

`social_leads` contains contact fields, optional phone/qualification and UTM
fields, GDPR fields, status enum `new/contacted/registered/unqualified`, source
enum `chat/form`, conversion user ID, marketing owner, claim/contact timestamps,
waitlist confirmation timestamps/provider/error, and created time
(`socialLeads.ts:20-82`).

Marketing-specific fields:

| Column | Definition |
|---|---|
| `marketing_user_id` | Nullable FK to `users.id`, `ON DELETE SET NULL`. |
| `claimed_at` | Nullable timestamp set by atomic claim. |
| `contacted_at` | Nullable timestamp set by first contacted transition or linked scheduling. |

Indexes are email, status, UTM source, created time, and marketing owner. Email
is indexed but not unique. `converted_user_id` has no FK and there is no
database constraint that the owner role is `marketing`.

The current schema also includes `waitlist_confirmation_sent_at`,
`waitlist_confirmation_provider_id`, and
`waitlist_confirmation_last_error`. The current capture code sends the
confirmation asynchronously and records the result
(`leads.ts:602-641,971-1107`; `email.ts:72-170`). This is related to marketing
lead operations but is not a marketer notification.

### 12.3 Marketer events

`marketer_events` has:

- Serial primary-key `id`.
- Required marketing-user FK with `ON DELETE CASCADE`.
- Nullable lead FK with `ON DELETE SET NULL`.
- Required title, scheduled time, and end time.
- Nullable meeting URL and notes.
- Status enum `scheduled`, `completed`, `cancelled`, `rescheduled`, `no_show`.
- Source enum `manual` or `calendly`.
- Nullable external Calendly event/invitee URI/email and sync timestamp.
- Created timestamp.
- Indexes for owner, lead, scheduled time, and a unique external event URI.

(`lib/db/src/schema/marketerEvents.ts:5-34`.)

### 12.4 Migration history and differences

- `0010_social_leads.sql:5-40` created the lead table, initially with
  non-null phone, status/source checks/defaults, and a source index.
- `0011_social_leads_phone_nullable.sql:1-3` made phone nullable for partial
  chat leads.
- `0019_marketing_lead_assignment.sql:1-6` added the marketing owner FK and
  index.
- `0020_marketing_calendly_url.sql:1` added `users.calendly_url`.
- `0029_social_lead_contact_timestamps.sql:1-2` added claim/contact times.
- `0030_calendly_event_sync.sql:1-8` added Calendly columns and external URI
  index to `marketer_events`.

No tracked migration creates the `marketer_events` table. `0030` assumes that
table already exists. The current Drizzle declaration also omits the historical
`social_leads_source_idx`. These are schema/migration drift findings, not
features to silently repair.

There is no `marketing_users` table, marketer join table, role-enforcing FK,
email uniqueness for leads, or marketer-specific database active flag.

## 13. Email and notification semantics

### Implemented

- Marketing invitation/password setup uses the generic
  `sendPasswordResetEmail` path and reset URL. It is sent through Resend and
  is rolled back at account-creation level only when the send function throws.
- Candidate account registration sends the normal
  **JOBSAGE: Verify your email address** message.
- Public reset sends **JOBSAGE: Reset your password**.
- Public waitlist form/chat capture currently queue
  **Welcome to JOBSAGE — We've received your details!** through
  `sendWaitlistWelcomeEmail` when the applicable lead has the required phone
  state. The result is stored as sent timestamp/provider ID or last error.
  Capture returns before this background email completes
  (`email.ts:72-170`; `leads.ts:604-641,1040-1087`).

### Not implemented

- Email to a marketer when a lead is assigned, claimed, unassigned, or
  scheduled.
- A marketer digest, daily queue email, or performance email.
- Dedicated marketing invite template, invitation resend endpoint, or invite
  lifecycle state.
- Email on role change, suspend, restore, delete, or Calendly change.
- Calendar event email notifications.

Shared email caveat: several generic Resend calls do not inspect provider
`result.error` objects and only surface thrown failures; this affects the
observability of some verification/reset/invitation paths. `RESEND_API_KEY`,
`EMAIL_FROM`, and `APP_URL` configure the module
(`email.ts:22-69,385-415,814-822`).

## 14. Environment variables and integrations

Names and purposes only; no values are included.

| Variable | Relevance/purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection used by Drizzle; required by database bootstrap. |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Repository-documented PostgreSQL configuration alternatives/context (`replit.md:125-133`). |
| `RESEND_API_KEY` | Resend credential for invitations, auth email, and waitlist welcome. |
| `EMAIL_FROM` | Configured email sender; defaults to `noreply@jobsage.co.uk` when absent. |
| `APP_URL` | Base URL used by password/reset and other email links. |
| `SESSION_SECRET` | Shared auth/session infrastructure configuration. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI-compatible base URL required by public lead chat. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI-compatible credential required by public lead chat. |
| `EMAIL_OPS` | Operations fallback for employerless Send-CV flows; not a marketer notification setting. |
| `NODE_ENV` | Production email gating and startup behavior. |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` | Shared object-storage configuration; not marketing-specific. |
| `ENABLE_CONTACT_BACKFILL`, `ENABLE_INDUSTRY_BACKFILL`, `ENABLE_REGION_BACKFILL` | Shared startup/backfill controls; not marketing-specific. |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Shared inbound-email webhook authentication. |
| `VACANCY_JOB_SECRET`, `COMPANY_SITE_BATCH_SIZE` | Shared vacancy/company-site job controls. |

Calendly is accessed through the Replit connector runtime in
`calendlySync.ts:109-115`; there is no marketing-specific Calendly environment
variable.

## 15. Exact UI copy

### Marketing login and navigation

The regular login page uses:

- **Sign in**
- **Welcome back to JOBSAGE**
- **Email address**
- **Password**
- **Forgot password?**
- **Sign in** / **Signing in…**
- **Create account**
- Placeholder `you@example.com` and `••••••••`
- Verification states **That verification link is invalid.**, **That
  verification link has expired.**, **Verification email sent — check your
  inbox.**, **Please wait Ns before requesting another email.**, and **Resend
  verification email**

(`LoginPage.tsx:127-260`.)

Marketing sidebar entries are exactly **Waitlist Leads** and **Calendar**.
The account footer uses the role label `marketing` and **Log out**
(`roleAccess.ts:6-9`; `AppSidebar.tsx:197-228`).

### Marketing leads

- **Waitlist Leads**
- **Contacts from the waitlist page**
- **Search by name or email…**
- **Filter by Sector**
- **All Industries**
- **Including unassigned**
- **Assigned to Me**, **Contacted**, **Registered**, **Conversion Rate**,
  **Avg Response Time**
- **Claimed by you**
- **Claim**
- **Could not claim this lead.**
- **Calendar** with tooltip/ARIA **Book a call in Calendar**
- **Captured**, **Claimed**, **Contacted**, **Registered**
- **Failed to load leads. Please refresh.**
- **No leads match your search.**
- **No leads yet.**
- **Page X of Y · N total**, **Previous**, **Next**

(`AdminLeadsPage.tsx:201-360,551-887`.)

Admin-only lead copy not shown as a marketer action includes **Filter by
assignee**, **All assignees**, **Unassigned**, **Assign selected…**,
**Unassign selected**, **Assign**, and the permanent-delete confirmation quoted
in section 7.

### Marketing calendar

- **Calendar**
- **Schedule, manage, and track marketer calls.**
- **My Calendly link**
- **Use this link for calls assigned to you and for the Live Calendly view.**
- **Save link**, **Saving...**, **Calendly link saved.**, **Calendly link
  cleared.**
- **Schedule & Upcoming Calls**
- **Book, manage, and track marketer conversations.**
- **Schedule New Call**
- **Month View**, **Week View**, **Upcoming Agenda**, **Live Calendly**
- **No calls scheduled in the upcoming period.**
- **No Calendly link configured**
- **Save a Calendly link above before opening the live booking view.**
- **Schedule a call**, **Book a conversation and keep the lead timeline up to
  date.**, **Cancel**, **Schedule call**
- **Loading calendar…**
- **Could not load calendar events. Refresh the page and try again.**
- **The calendar could not load. Please refresh and try again.**

(`AdminCalendarPage.tsx:103-188`;
`MarketerCalendar.tsx:440-713`.)

### Admin/super-admin marketer oversight

Admin-only/super-admin-only copy includes:

- **Super Admin**
- **Operational intelligence view — full platform visibility.**
- **Marketing**
- **Performance by marketer**
- **Create marketing account**
- **The new user will receive a one-time link to set their password. No
  password is entered or stored here.**
- **Create & invite** / **Sending...**
- **Marketing account created**
- **A secure password setup link has been sent to the new account.**
- **Could not create account**
- **Impersonate (Read-Only)**
- **Suspend** / **Restore Account**
- **Delete Account**
- **Suspend this account? The user will not be able to log in.**
- **Permanently delete this account? This cannot be undone.**
- **Role updated**
- **Calendly link saved** / **Calendly link cleared**
- **Sync Calendly** / **Syncing…**
- **All Marketers**
- **No users found.**
- **Unable to load the user directory.**

(`SuperAdminPage.tsx:216-395,398-573,710-1067`;
`MarketerCalendar.tsx:440-490`.)

## 16. Email, data, and failure edge matrix

| Situation | Existing behavior |
|---|---|
| Marketing self-registration | **Not implemented**; regular register creates candidate/default role. |
| Invite token expires | Reset returns 400 invalid/expired; no dedicated resend. |
| Invitation mail throws | New marketing row is deleted and creation returns 503. |
| Invitation provider returns an unchecked error object | Some shared mail helpers may not surface it as a thrown failure; delivery observability is limited. |
| Marketing logs in before setup | Password is null, so normal login cannot succeed until reset/setup. |
| Wrong password/unknown email | 401 `Invalid email or password`. |
| Unverified login | 403 with `email_not_verified`; regular login offers resend. |
| Suspended login | 403 with `account_suspended`; existing ordinary sessions are not rechecked. |
| Role changed while logged in | Existing ordinary session retains its stored role until replaced; no forced logout. |
| Marketing opens `/admin/super` or `/admin/users` | Frontend redirects; backend returns 403 if called directly. |
| Marketing opens `/admin/calendar?leadId=7` | Exact marketing-path check can redirect because query string is included in the location. |
| Unassigned lead claim race | One request succeeds; another receives 409. |
| Marketing claims an already-assigned lead | 409; no reassignment path. |
| Marketing sees another marketer's lead | Backend excludes it; UI also only exposes own/unassigned work. |
| Marketing bulk status includes a foreign lead | Transaction rejects with 403; missing rows produce 404. |
| Claiming a lead | Sets owner/claim time only; does not contact it. |
| Opening calendar | Does not change lead status. |
| Scheduling linked new lead | Changes it to contacted and records `contactedAt`. |
| Missing Calendly URL | Live view is empty with the configured-link prompt; manual events still work. |
| Calendly event edit/delete | Managed fields/deletion return 409; local notes/outcome remain editable. |
| Deleted marketer | Lead owner is set null; marketer events cascade-delete. |
| Admin/super-admin assignment to candidate | 400 because target role must be marketing. |
| Admin attempts super-admin management | 403; super-admin routes use exact role. |
| Impersonated write | Protected non-GET is 403; protected GET acts as current target. |
| Invalid impersonation token | Activation 401; UI shows **Access Denied** and **Invalid or expired token.** |
| No impersonation token in UI | UI shows **No impersonation token provided.** |
| Empty inbox | **No leads yet.**; search with no result gives **No leads match your search.** |
| Lead export | **Not implemented**. |
| Assignment notification | **Not implemented**. |

## 17. Not implemented / not found inventory

The repository search and route inventory found no implementation for:

1. A dedicated marketing login, marketer self-signup, or marketer invite
   acceptance/token type.
2. Invitation resend, invitation status/history, or invitation-specific audit.
3. An ordinary admin ability to create/manage marketer accounts. The general
   admin page only performs email lookup, verification, reset, and recent
   admin-action viewing.
4. Marketing user edit of name/email/password through a marketer profile
   surface. Marketing can edit only its own Calendly URL through the dedicated
   endpoint; password reset is the shared public flow.
5. A separate marketer directory, active flag, lead-export/reporting page,
   leaderboard, or CSV export.
6. Marketing ability to view other marketers' leads, performance, calendars,
   or Calendly URLs.
7. Marketing ability to assign/unassign/delete/restore leads.
8. Lead email/SMS, assignment, claim, digest, or calendar notifications.
9. A dedicated lead detail/notes/outreach/conversion UI.
10. A Calendly webhook. Sync is scheduled/manual polling.
11. A database role constraint for the marketing owner, a FK for
    `converted_user_id`, or unique lead email.
12. A tracked initial migration creating `marketer_events`.
13. OpenAPI/generated entries for marketer-calendar, exact-admin user routes,
    lead status/delete/submit/chat/sectors, and employer registration.
14. Route-level marketer-calendar tests. Existing Calendly tests cover helper
    functions only (`calendlySync.test.ts:7-21`).
15. Email delivery testing against real external inboxes. Production delivery
    is outside this repository audit.

## 18. Porting checklist

To reproduce this JOBSAGE behavior in another application:

- Store `marketing` as a first-class user role on the existing user table.
- Implement super-admin-only creation with normalized unique email, optional
  Calendly URL, null password, 24-hour setup token, and rollback on thrown
  invitation failure.
- Use the shared login/session/password-reset flow; do not assume a separate
  marketer login.
- Add frontend and backend gates for leads/calendar only, while skipping
  candidate consent/profile gates for marketing.
- Implement own/unassigned lead visibility, reduced marketing projection,
  atomic claim, owned status changes, and personal performance metrics.
- Keep admin/super-admin full projection, assignee filters, assignment,
  deletion, and marketer comparison distinct from marketing permissions.
- Implement the two calendars roles use: own events for marketing and
  cross-marketer views/sync for admins.
- Preserve the linked-calendar side effect that changes a new lead to
  contacted, and the restriction on editing/deleting Calendly-owned events.
- Add super-admin directory filters, create/invite, role, suspend/restore,
  delete, Calendly edit, and impersonation if this oversight surface is in
  scope.
- Preserve session behavior if reproducing the current system: ordinary
  sessions are not revalidated after role/suspension/deletion changes, while
  impersonation re-reads the target and blocks protected writes.
- Do not copy JOBSAGE-specific candidate/sponsor/visa product features or
  assume the `/admin/leads`, `/admin/calendar`, `/api/leads`, or
  `social_leads` paths exist in the destination application.
- Do not copy the known OpenAPI omissions as intentional API restrictions;
  they are current contract drift.

## 19. Verification notes

The audit covered the three attached audit/addendum files, the existing
waitlist specification, current frontend route/guard/sidebar/lead/calendar/
super-admin/admin-user/impersonation files, backend auth/lead/calendar/
super-admin/admin-user routes and middleware, auth/session/email helpers,
Calendly sync, tests, current Drizzle schema, migration history, OpenAPI,
generated Zod/client output, and `replit.md`.

The public waitlist document's statement that confirmation email is
**not implemented** is stale relative to the current source:
`leads.ts:604-641,1040-1087` calls `sendWaitlistWelcomeEmail`, and
`email.ts:72-170` records provider success/failure. The current source behavior
is documented in sections 12 and 13 here; the separate waitlist document was
not rewritten as part of this task.

No application code, database behavior, API behavior, generated contract,
tests, configuration, environment value, product copy, production data, or
external service was modified. The intended change is limited to this
canonical documentation file and the task metadata.