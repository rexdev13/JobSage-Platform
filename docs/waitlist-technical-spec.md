# JOBSAGE waitlist / lead-capture technical specification

**Status:** read-only reproduction of the existing JOBSAGE implementation. This document is not a proposal and does not describe improvements. SellBuyLink should reproduce the behavior documented here, including omissions, surprising behavior, and code/schema differences.

**Repository evidence convention:** source references use repository-relative paths and line ranges as observed in the current tree. The public API routes are registered under `/api` by `artifacts/api-server/src/routes/index.ts` (lines 35-42, 77-82) and `artifacts/api-server/src/app.ts` (lines 30-42).

## 1. How it works: page load to stored row and conversion

1. A guest is routed to the sole public capture page, `GET /get-started`. `artifacts/jobsage-web/src/App.tsx` lazy-loads `GetStartedPage` and mounts it at `/get-started` (lines 64-67, 237-262). There is no `/waitlist` route in the router.
2. `GetStartedPage` renders a sticky JOBSAGE header, a hero, two tabs, and a footer. The default tab is the AI chat (`activeTab = "chat"`); the form is the other tab (lines 437-465, 654-766).
3. On page mount, the browser fetches `GET /api/leads/sectors`. The endpoint reads distinct non-empty sponsor-licence industries, excludes the literal `Other`, sorts them, appends `Other`, and returns a one-hour public cache header. A failure is swallowed by the browser and leaves the dropdown empty (frontend lines 456-465; backend `artifacts/api-server/src/routes/leads.ts` lines 338-367).
4. The visitor can use the form or chat. The form has native browser-required first name, last name, email, and phone controls, plus an optional sector dropdown and consent checkbox. The chat starts with one fixed assistant message and disables its input/send button while an AI response is streaming (`GetStartedPage.tsx` lines 52-61, 322-393).
5. Form submission first checks `gdprConsent` in JavaScript. If false, it stays on the form and shows `Please confirm your consent before submitting.`. If true, the submit button is disabled and text changes to `Submitting…` (`GetStartedPage.tsx` lines 605-613, 269-285).
6. The form sends an unauthenticated JSON `POST /api/leads/submit`. It sends the visible contact values, the selected sector (or free-text `sectorOther` when `Other` is selected), optional state values, consent, current URL UTM values, `window.location.pathname`, and `document.referrer` (`GetStartedPage.tsx` lines 614-635).
7. The server validates the body with Zod. It requires non-empty strings for first name, last name, and phone, a valid email, and literal `gdprConsent: true`; all qualifying and attribution fields are optional (`leads.ts` lines 79-106). It hashes the first `x-forwarded-for` address, or the socket address, with SHA-256 and does not store the raw IP (`leads.ts` lines 515-523).
8. A form submission upgrades an existing `social_leads` row only when the lower-cased email already has `source = "chat"`. The row is replaced with the full form details, consent becomes true, `gdprConsentedAt` is set to the current time, `source` becomes `form`, and status becomes `new`. Otherwise a new form row is inserted. There is no general email uniqueness constraint or generic duplicate-form behavior (`leads.ts` lines 527-590; `lib/db/src/schema/socialLeads.ts` lines 20-78).
9. A successful form request returns HTTP 201 `{ "success": true }`; the form switches to the success screen. The success screen does not send or wait for an email (`GetStartedPage.tsx` lines 98-125, 637-646; `leads.ts` lines 590-595).
10. Chat messages are sent as unauthenticated JSON `POST /api/leads/chat`. The response is an SSE stream. The server keeps the last 12 supplied history entries, adds the current user message, calls `gpt-4o-mini`, streams `data: {"text":"..."}` events, then optionally runs a second extraction call and sends one terminal `data: {"done":true,"extracted":{...}}` event (`GetStartedPage.tsx` lines 505-603; `leads.ts` lines 798-887).
11. Once the extractor has a non-null name and email, chat saves what it has collected. A new row is `source = "chat"`, `status = "new"`, and `gdprConsent = false`, but its `gdprConsentedAt` is still set to `now`. Existing chat rows are progressively updated; an existing form row is intentionally left unchanged. Chat does not send the form's UTM, landing path, referrer, or IP hash (`leads.ts` lines 889-943).
12. Chat can prefill the form with extracted name, email, phone, sector, and desired role. It does not submit that form automatically, and chat itself has no consent control. The visitor must switch to the form and submit to create a consented `source = "form"` row (`GetStartedPage.tsx` lines 480-503, 649-652; `leads.ts` lines 893-937).
13. An authenticated candidate registering at `POST /api/auth/register` with an email matching any lead lower-cased marks every matching lead `status = "registered"` and sets `convertedUserId` to the new user ID. This update is best-effort and does not fail registration if it errors (`artifacts/api-server/src/routes/auth.ts` lines 93-168).
14. Admin, super-admin, and marketing users operate the resulting rows at `/admin/leads`. They can search/filter, view status aggregates, assign or claim work, update status, and open the related calendar flow. Only admin and super-admin can delete or assign; marketing users are scoped to their own or unassigned leads (`App.tsx` lines 300-305; `roleAccess.ts` lines 1-21; `leads.ts` lines 114-206 and 242-297).

## 2. Public and admin surfaces

### Implemented surfaces

| Surface | Location | Behavior |
|---|---|---|
| Public capture page | `/get-started` | One page with `Chat with AI` and `Fill out Form` tabs. `App.tsx` lines 259-261; `GetStartedPage.tsx` lines 654-766. |
| Public sector source | `GET /api/leads/sectors` | Dynamic dropdown data from `sponsor_licences`; appends `Other`. `leads.ts` lines 338-367. |
| Waitlist CRM | `/admin/leads` | Protected list/table with pagination, search, sector/assignee filters, status counts, selection, status updates, assignments, claiming, and deletion. `AdminLeadsPage.tsx` lines 367-428, 544-915. |
| Marketer calendar | `/admin/calendar` | Related operational surface for scheduling calls for accessible leads. `App.tsx` lines 300-305; `AdminCalendarPage.tsx` lines 135-203; `marketerCalendar.ts` lines 103-205. |

### Not implemented / not found

The repository route and source search found no implementation for the following:

- A dedicated `/waitlist` page: **not implemented**. The public page is `/get-started`.
- A waitlist modal, pop-up, footer capture form, or additional page-embedded waitlist form: **not implemented** in the JOBSAGE web source. The `/get-started` footer contains only the privacy-policy link (`GetStartedPage.tsx` lines 760-766).
- A mobile waitlist form or mobile capture route: **not implemented** in the mobile artifact's waitlist route inventory.
- A “people waiting” count widget: **not implemented**.
- A duplicate/already-signed-up UI state: **not implemented**. Form submissions normally return success even for a pre-existing form lead; only chat-to-form rows are upgraded.
- A waitlist confirmation email, internal new-lead notification email, double opt-in, unsubscribe flow, or waitlist webhook: **not implemented**.
- Behavioral analytics or submit/chat tracking events: **not implemented** in this capture page. The form and chat use `fetch`; there is no GA, Mixpanel, PostHog, Pixel, or equivalent call in `GetStartedPage.tsx`.
- CAPTCHA, honeypot, waitlist-specific rate limiting, CSRF token, or public API key: **not implemented**.
- CSV export: **not implemented** for waitlist leads. The admin UI has deletion and operational updates, not export.
- Lead restore or a lead audit-history UI: **not implemented**. Deletion is permanent at the table level; the app does not provide a restore action.

Unrelated candidate analytics, audit exports, and other platform email features must not be interpreted as waitlist features. The waitlist-specific source inventory is the route/page/schema/API set documented below.

## 3. File map

| Path | Waitlist responsibility |
|---|---|
| `artifacts/jobsage-web/src/App.tsx` | Registers public `/get-started`, protected `/admin/leads`, and protected `/admin/calendar`; lazy-loads the pages (lines 21-67, 237-343). |
| `artifacts/jobsage-web/src/pages/GetStartedPage.tsx` | Complete public UI: form state, sector loading, UTM/referrer capture, form POST, chat POST/SSE reader, AI prefill, exact copy, loading/error/success states, and footer (lines 17-807). |
| `artifacts/jobsage-web/src/pages/admin/AdminLeadsPage.tsx` | CRM query, filters, role-dependent list, assignment/claim/status/delete actions, status bar, loading/error/empty states, and exact admin copy (lines 367-915). |
| `artifacts/jobsage-web/src/pages/admin/AdminCalendarPage.tsx` | Loads all accessible leads for calendar context, manages marketer Calendly URL, and opens/loads scheduling (lines 22-203). |
| `artifacts/jobsage-web/src/components/admin/MarketerCalendar.tsx` | Calendar presentation and event controls used by the lead booking action. The lead table links to it with `?leadId=` (`AdminLeadsPage.tsx` lines 832-835). |
| `artifacts/jobsage-web/src/lib/roleAccess.ts` | Frontend roles: `admin`, `super_admin`, and `marketing` may access leads; only admin roles may delete (lines 1-25). |
| `artifacts/jobsage-web/src/components/layout/AppSidebar.tsx` | Adds `Waitlist Leads` and `Calendar` navigation for admin/super-admin/marketing roles (lines 103-140). |
| `artifacts/api-server/src/app.ts` | CORS, JSON parsing/raw-body capture, cookies, auth middleware, `/api` mount, and sanitized error handler (lines 8-60). |
| `artifacts/api-server/src/routes/index.ts` | Mounts the leads router and marketer-calendar router (lines 35-42, 77-82). |
| `artifacts/api-server/src/routes/leads.ts` | Public sector/submit/chat endpoints and authenticated CRM endpoints (lines 79-106, 114-367, 377-495, 501-768, 771-955). |
| `artifacts/api-server/src/routes/auth.ts` | Registration and waitlist-to-user conversion attribution (lines 93-168). |
| `artifacts/api-server/src/routes/marketerCalendar.ts` | Related lead booking/list/update/delete and Calendly sync API (lines 103-344). |
| `artifacts/api-server/src/middlewares/authMiddleware.ts` | Resolves the `sid` cookie or `Authorization: Bearer` session ID and attaches `req.user` (lines 27-71). |
| `artifacts/api-server/src/middlewares/requireRole.ts` | Returns 401/403 for protected CRM/calendar routes and blocks writes during impersonation (lines 9-47). |
| `artifacts/api-server/src/lib/email.ts` | Shared Resend/auth and platform email module. It has no waitlist email function; verification begins at line 252. |
| `lib/db/src/schema/socialLeads.ts` | Current Drizzle definition of `social_leads`, indexes, FK, defaults, and inferred types (lines 20-82). |
| `lib/db/drizzle/0010_social_leads.sql` | Initial table, checks, defaults, and indexes (lines 1-40). |
| `lib/db/drizzle/0011_social_leads_phone_nullable.sql` | Makes `phone` nullable for early chat leads (lines 1-3). |
| `lib/db/drizzle/0019_marketing_lead_assignment.sql` | Adds the marketing owner FK and index (lines 1-6). |
| `lib/db/drizzle/0029_social_lead_contact_timestamps.sql` | Adds `claimed_at` and `contacted_at` (lines 1-2). |
| `lib/db/src/index.ts` | Requires `DATABASE_URL`, creates the PostgreSQL pool, and exports Drizzle `db` (lines 18-28). |
| `lib/integrations-openai-ai-server/src/client.ts` | Requires and configures the OpenAI proxy environment variables (lines 1-18). |
| `lib/api-spec/openapi.yaml` | Documents authenticated lead-management routes at `/leads`, but does not contain the public `/leads/sectors`, `/leads/submit`, or `/leads/chat` paths. Authenticated lead paths begin at lines 2412-2723. |
| `artifacts/api-server/src/__tests__/routes/leads.test.ts` | Tests role scope, fields exposed to marketing, claiming, assignment, status updates, deletion denial, Calendly URL behavior, and representative admin list responses (lines 129-660). |
| `replit.md` | Repository-level API, frontend, and environment-variable inventory (lines 93-140). |

## 4. Frontend behavior and fields

### Form state and controls

Initial state is empty for all strings and `false` for consent (`GetStartedPage.tsx` lines 23-35, 440-451):

| State/key | UI control | Required in browser | Server requirement | Stored behavior |
|---|---|---:|---:|---|
| `firstName` | Text input | Yes | `string.min(1)` | `first_name`, required |
| `lastName` | Text input | Yes | `string.min(1)` | `last_name`, required |
| `email` | `type="email"` | Yes | `z.string().email()` | Lower-cased into `email` |
| `phone` | `type="tel"` | Yes | `string.min(1)` | `phone`; nullable in the current schema for chat rows |
| `industrySector` | Select | No | Optional string | Stored as `industry_sector` when non-empty |
| `sectorOther` | Conditional text input when sector is `Other` | No | Never sent by this name | Display/input helper only; its value replaces `industrySector` in the request |
| `desiredRole` | State only; no rendered form control | No | Optional string | Stored if a value is supplied, normally only via chat extraction |
| `additionalMessage` | State only; no rendered form control | No | Optional string | Stored if a value is supplied; no current form field lets a visitor enter it |
| `gdprConsent` | Checkbox | No native `required` attribute | Must be literal `true` | Stored as boolean and form timestamp |

The form sends no hidden `userAgent` field. It sends UTM values only from the current query string at submit time, not from a stored first-touch cookie. `getUtmParams()` maps `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content` to camel-case request keys (`GetStartedPage.tsx` lines 67-75). `landingPath` is the current `window.location.pathname`; `referrerUrl` is `document.referrer` or omitted (`GetStartedPage.tsx` lines 631-635).

There is no explicit client-side trimming or custom email/phone validation. Native browser validation runs because the inputs have `required`/`type="email"`; the explicit JavaScript check only covers consent. The server does not trim the required values before validation or storage, although it lower-cases email on insert/update (`GetStartedPage.tsx` lines 161-205; `leads.ts` lines 83-105, 564-587).

The form submit button is disabled while the request is in flight. There is no timer-based debounce, idempotency key, or duplicate-submit server lock. On a non-2xx response the JSON `error` string is displayed; if the response is not JSON the UI uses `Submission failed`, and a thrown non-`Error` uses `Something went wrong. Please try again.` (`GetStartedPage.tsx` lines 616-645).

### Chat behavior

- The initial assistant content is exactly the `INITIAL_MESSAGES` string at `GetStartedPage.tsx` lines 52-58.
- Enter sends; Shift+Enter inserts a newline. Empty/whitespace input is ignored. The textarea and send button are disabled during streaming (`GetStartedPage.tsx` lines 315-320, 363-381; `handleChatSend` lines 505-515).
- The client sends the prior non-streaming messages as `history`, plus the current `message`. It does not include the newly-added empty assistant bubble (`GetStartedPage.tsx` lines 511-525).
- The server takes `history.slice(-12)`, so at most the last 12 client-supplied history messages are passed to the model, then adds the current user message (`leads.ts` lines 817-823).
- The conversational system prompt calls the assistant `SAGE`, directs it to collect first/last name, email, phone, and optionally sector, forbids Markdown and dashes, and limits normal replies to one or two short sentences (`leads.ts` lines 775-795).
- After at least two user turns, a second `gpt-4o-mini` call extracts only clearly stated `name`, `email`, `phone`, `industrySector`, and `desiredRole` JSON values. Extraction failures are swallowed (`leads.ts` lines 842-887).
- The UI applies extracted name by splitting on whitespace, matches a sector case-insensitively against the loaded dropdown, otherwise selects `Other` and fills `sectorOther`, and fills email/phone/desired role (`GetStartedPage.tsx` lines 480-503).
- After three user messages, and only when not streaming, the UI shows the register CTA. This CTA links to `/register` and offers `Fill out form instead`; it is not a waitlist submission (`GetStartedPage.tsx` lines 60-61, 472-474, 401-429).
- SSE `text` chunks update the last assistant bubble. `done` removes its streaming state and applies extraction. Malformed SSE lines are ignored (`GetStartedPage.tsx` lines 532-590).
- If the server emits an `error` event after headers, the last bubble becomes `Sorry, I'm having trouble right now. Please try again.`. If fetch has no OK response/body, it becomes `Network error. Please try again.`. The server-side fallback event is `{"error":"AI service unavailable. Please try again."}` (`GetStartedPage.tsx` lines 528-600; `leads.ts` lines 947-951).
- Chat has no frontend consent checkbox and the chat save path writes `gdprConsent: false` with a non-null timestamp. This is existing behavior, not proof of consent (`leads.ts` lines 913-924).

## 5. API contract

All examples below are code-derived examples with representative values. No secret, production record, or production query is required to reproduce them.

### Request middleware and cross-origin behavior

The API applies credentialed CORS before the router. It permits no-origin requests, `chrome-extension://` origins, `https://jobsage.co.uk`, and one-level `https://*.jobsage.co.uk` origins; other origins receive `callback(null, false)`. It parses JSON and URL-encoded bodies, captures raw JSON bytes, and runs `authMiddleware` for every route (`artifacts/api-server/src/app.ts` lines 10-42). Public lead routes do not call `requireRole` and do not require a session. They also do not use `credentials: "include"` in the public frontend fetch calls (`GetStartedPage.tsx` lines 522-526, 616-618).

The authenticated UI uses `credentials: "include"` and the server accepts either the `sid` cookie or an `Authorization: Bearer <session-id>` header (`auth.ts` lines 57-63; `authMiddleware.ts` lines 27-71). There is no waitlist-specific CSRF token or API key.

### `GET /api/leads/sectors` — public

**Success:**

```http
GET /api/leads/sectors

HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
Content-Type: application/json

{"sectors":["Care","Engineering","Healthcare","Other"]}
```

The values are generated from `sponsor_licences.industry`, excluding null, empty, and exact `Other`, sorted by the database, with `Other` appended last. On a database error:

```json
{"error":"Could not load sector list."}
```

with HTTP 500. The frontend does not display that error; it leaves the dropdown empty (`leads.ts` lines 343-365; `GetStartedPage.tsx` lines 456-465).

### `POST /api/leads/submit` — public form capture

**Request:**

```http
POST /api/leads/submit
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "Jane@example.com",
  "phone": "+44 7700 000000",
  "industrySector": "Healthcare",
  "desiredRole": "Nurse",
  "additionalMessage": "Looking for a sponsored role",
  "gdprConsent": true,
  "utmSource": "facebook",
  "utmMedium": "paid-social",
  "utmCampaign": "uk-careers",
  "utmContent": "video-1",
  "landingPath": "/get-started",
  "referrerUrl": "https://www.facebook.com/"
}
```

All keys except the four required contact keys and `gdprConsent: true` are optional. The server schema accepts `industrySector`, `desiredRole`, `additionalMessage`, `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `landingPath`, and `referrerUrl` as optional strings (`leads.ts` lines 83-105). The form omits optional keys whose state is empty.

**Success:**

```http
HTTP/1.1 201 Created
Content-Type: application/json

{"success":true}
```

**Validation examples:**

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"error":"A valid email address is required"}
```

Other first-failure messages are `First name is required`, `Last name is required`, `Phone number is required`, and `GDPR consent is required to submit this form` (`leads.ts` lines 83-105, 504-509). Because the schema reports the first issue, the exact error depends on object validation order.

**Persistence and failure:**

- Email is lower-cased before lookup/insert. Only a matching chat row is upgraded; otherwise a new form row is inserted.
- The server returns HTTP 500 `{"error":"Failed to submit your details. Please try again."}` for a database or other persistence exception (`leads.ts` lines 512-595).
- There is no email-provider call in this route, so there is no form case where a database write succeeds and a waitlist email fails. No waitlist email is attempted.

### `POST /api/leads/chat` — public SSE chat

**Request:**

```http
POST /api/leads/chat
Content-Type: application/json

{
  "message": "I am Jane Smith and I am a nurse",
  "history": [
    {
      "role": "assistant",
      "content": "Hi there! 👋 I am JOBSAGE AI, your guide to building a career in the UK..."
    },
    {
      "role": "user",
      "content": "I want to move to the UK"
    }
  ]
}
```

The route only checks that `message.trim()` is non-empty; `history` is structurally cast rather than Zod-validated. Empty input returns HTTP 400:

```json
{"error":"message is required."}
```

For a valid request the server first sends SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`) and flushes headers (`leads.ts` lines 806-814). A normal stream looks like:

```text
data: {"text":"Thanks Jane, that is helpful."}

data: {"text":" What kind of role are you looking for?"}

data: {"done":true,"extracted":{"name":"Jane Smith","industrySector":"nursing"}}

```

The `extracted` object contains only non-null/non-empty extracted properties. The client expects `text`, `done`, `extracted`, and `error` (`GetStartedPage.tsx` lines 545-553). If the model call or downstream stream fails after headers, the server emits:

```text
data: {"error":"AI service unavailable. Please try again."}

```

and closes the stream. The route does not return a conventional non-2xx status for that post-header failure (`leads.ts` lines 816-831, 947-951).

### Authenticated CRM routes

These are not public capture endpoints. They are included because they are the operational API for the captured rows. Protected routes return `401 {"error":"Not authenticated."}` without a valid session and `403 {"error":"Access denied. Required role(s): ..."}` when the role is not allowed (`requireRole.ts` lines 29-47).

| Method/path | Allowed role(s) | Request/query | Success shape and behavior |
|---|---|---|---|
| `GET /api/leads` | `admin`, `super_admin`, `marketing` | `page` defaults 1; `limit` defaults 25 and clamps 1-100; optional `search`, `sector`, `assignedTo` | `{leads,total,page,limit,stats}`. Search is case-insensitive substring over email/first/last name; sector is substring over `industry_sector`; newest rows first. `stats` is filtered status totals plus rolling last-seven-days count (`leads.ts` lines 114-206). |
| `GET /api/leads/assignees` | `admin`, `super_admin` | none | `{assignees:[{id,email,name,calendlyUrl}]}` for users whose role is `marketing`, ordered by name/email (`leads.ts` lines 242-263). |
| `GET /api/leads/my-performance` | `marketing` | none | `{assignedCount,contactedCount,registeredCount,conversionRate,averageResponseTimeMinutes}` for the signed-in marketer (`leads.ts` lines 209-234). |
| `POST /api/leads/:id/claim` | `marketing` | none | Atomically sets `marketingUserId` and `claimedAt`; does not set contacted/status. Returns `{id,status,marketingUserId,claimedAt,contactedAt}`. Existing assignment is 409; missing lead is 404; bad ID is 400 (`leads.ts` lines 266-297). |
| `PATCH /api/leads/:id/assignee` | `admin`, `super_admin` | `{ "marketingUserId": "marketing-user-id" }` or `null` | `{id,marketingUserId,assignee}`. The selected user must have role `marketing`; bad ID/body/user is 400 and missing lead is 404 (`leads.ts` lines 370-431). |
| `PATCH /api/leads/bulk-assignee` | `admin`, `super_admin` | `{ "ids":[1,2], "marketingUserId":"..." }` or null | `{updated,marketingUserId,assignee}`. IDs must be a non-empty positive integer array and the assignee must be marketing (`leads.ts` lines 434-493). |
| `PATCH /api/leads/:id/status` | `admin`, `super_admin`, `marketing` | `{ "status":"new"|"contacted"|"registered"|"unqualified" }` | `{id,status}`. Setting `contacted` sets `contactedAt` only if it was previously null. Marketing can update only a lead assigned to that marketer (`leads.ts` lines 707-767). |
| `PATCH /api/leads/bulk-status` | `admin`, `super_admin`, `marketing` | `{ "ids":[1,2], "status":"contacted" }` | `{updated}`. Marketing requests are transactional and must contain existing leads all assigned to that marketer; otherwise 404/403. Admin updates matching IDs (`leads.ts` lines 629-703). |
| `DELETE /api/leads` | `admin`, `super_admin` | `{ "ids":[1,2] }` | `{deleted}`. IDs are numerically coerced, invalid/non-positive entries removed, and duplicates removed. Empty/invalid input is 400. No restore path exists (`leads.ts` lines 598-626). |

Representative list response:

```json
{
  "leads": [
    {
      "id": 9,
      "firstName": "Jane",
      "lastName": "Smith",
      "email": "jane@example.com",
      "phone": "+44 7700 000000",
      "industrySector": "Healthcare",
      "desiredRole": null,
      "additionalMessage": null,
      "utmSource": "facebook",
      "utmMedium": "paid-social",
      "utmCampaign": "uk-careers",
      "utmContent": null,
      "landingPath": "/get-started",
      "referrerUrl": "https://www.facebook.com/",
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
  ],
  "total": 1,
  "page": 1,
  "limit": 25,
  "stats": {
    "statusTotals": {"new": 1, "contacted": 0, "registered": 0, "unqualified": 0},
    "createdLast7Days": 1
  }
}
```

Admin receives the full projected lead fields above. Marketing receives a reduced projection with `name`, `email`, `phone`, `sector`, `source`, `status`, `createdAt`, `desiredRole`, `additionalMessage`, and resolved `assignee`; the implementation deliberately excludes attribution/privacy fields such as `utmCampaign` and `ipHash` (`leads.ts` lines 13-28, 30-57, 164-197; tests lines 146-213).

### Related calendar API

The booking button on each admin lead navigates to `/admin/calendar?leadId=<id>` (`AdminLeadsPage.tsx` lines 832-835). The calendar API is not a second capture path:

- `GET /api/marketer/calendar/events`: marketing/admin/super-admin; optional ISO `start`, `end`, and admin-only `marketingUserId`; returns `{events:[...]}`. Non-admins see their own events. Invalid dates return 400 (`marketerCalendar.ts` lines 103-135).
- `POST /api/marketer/calendar/events`: marketing/admin/super-admin. Body requires `title` and `scheduledAt`; may include `leadId`, `marketingUserId`, `endTime`, `meetingUrl`, and `notes`. If a linked lead is `new`, creating the event changes it to `contacted` and sets `contactedAt`. Success is HTTP 201 `{event: ...}`; linked lead missing is 404 (`marketerCalendar.ts` lines 138-205).
- `PATCH /api/marketer/calendar/events/:id`: event owner or admin roles. Validates event fields and returns `{event: ...}`; Calendly-owned fields cannot be changed in JOBSAGE (`marketerCalendar.ts` lines 246-307).
- `DELETE /api/marketer/calendar/events/:id`: event owner or admin roles. Manual events return `{id}`; Calendly events return 409 and must be cancelled in Calendly (`marketerCalendar.ts` lines 310-344).
- `GET /api/marketer/calendar/calendly/status` and `POST /api/marketer/calendar/calendly/sync` are related integration operations, not waitlist capture. Calendar URL preference is stored through `GET/PATCH /api/me/calendly-url`, marketing-only (`leads.ts` lines 300-335).

## 6. Storage schema and migration history

### Current Drizzle definition

The table is PostgreSQL `social_leads`, created through Drizzle's `pgTable` (`lib/db/src/schema/socialLeads.ts` lines 20-78). Current columns:

| Column | Drizzle type / nullability / default | Meaning |
|---|---|---|
| `id` | `serial`, primary key, not null | Numeric lead ID |
| `first_name` | `text`, not null | First name |
| `last_name` | `text`, not null | Last name |
| `email` | `text`, not null | Lower-cased by capture paths; **not unique** |
| `phone` | `text`, nullable | Phone; nullable is needed for partial chat rows |
| `industry_sector` | `text`, nullable | Sector/industry |
| `desired_role` | `text`, nullable | Target role/job title |
| `additional_message` | `text`, nullable | Free-text extra message |
| `utm_source` | `text`, nullable | `utm_source` attribution |
| `utm_medium` | `text`, nullable | `utm_medium` attribution |
| `utm_campaign` | `text`, nullable | `utm_campaign` attribution |
| `utm_content` | `text`, nullable | `utm_content` attribution |
| `landing_path` | `text`, nullable | Browser pathname captured on form submit |
| `referrer_url` | `text`, nullable | `document.referrer` captured on form submit |
| `ip_hash` | `text`, nullable | SHA-256 of selected client IP string |
| `gdpr_consent` | `boolean`, not null | Form is true; chat save is false |
| `gdpr_consented_at` | `timestamp with time zone`, not null | Form consent time; chat currently also writes `now` despite false consent |
| `status` | `varchar` enum values `new/contacted/registered/unqualified`, not null, default `new` | CRM state |
| `source` | `varchar` enum values `chat/form`, not null, default `form` | Capture source |
| `converted_user_id` | `varchar`, nullable | User ID written during candidate registration; no FK in current definition |
| `marketing_user_id` | `varchar`, nullable, FK to `users.id`, `ON DELETE SET NULL` | CRM owner |
| `claimed_at` | `timestamp with time zone`, nullable | Time a marketing user claimed it |
| `contacted_at` | `timestamp with time zone`, nullable | First explicit contacted transition or calendar scheduling |
| `created_at` | `timestamp with time zone`, not null, default `now()` | Row creation time |

Current indexes are:

1. `social_leads_email_idx` on `email`
2. `social_leads_status_idx` on `status`
3. `social_leads_utm_source_idx` on `utm_source`
4. `social_leads_created_at_idx` on `created_at`
5. `social_leads_marketing_user_idx` on `marketing_user_id`

There is no current unique index on email, no index on `source` in the Drizzle definition, and no foreign key from `converted_user_id` to `users.id` (`socialLeads.ts` lines 56-78).

### Migrations and known differences

1. `0010_social_leads.sql` initially created `phone text NOT NULL`, status/source checks, `converted_user_id`, and indexes including `social_leads_source_idx` (`0010_social_leads.sql` lines 5-40).
2. `0011_social_leads_phone_nullable.sql` then dropped the `phone` NOT NULL constraint specifically so AI-chat rows could be saved before phone collection (`0011_social_leads_phone_nullable.sql` lines 1-3). **Therefore the historical initial SQL and the current Drizzle definition differ: current `phone` is nullable.**
3. `0019_marketing_lead_assignment.sql` added nullable `marketing_user_id` with `users.id` `ON DELETE SET NULL` and its index (`0019_marketing_lead_assignment.sql` lines 1-6).
4. `0029_social_lead_contact_timestamps.sql` added nullable `claimed_at` and `contacted_at` (`0029_social_lead_contact_timestamps.sql` lines 1-2).
5. The historical migration creates `social_leads_source_idx`, while the current Drizzle declaration does not list that index. The historical migration's `source`/`status` checks are also expressed as Drizzle `varchar` enums in code. Do not silently normalize these differences in a port.
6. The migration comment calls the initial script idempotent, but the later timestamp migration uses plain `ADD COLUMN` statements. This is migration behavior, not a runtime waitlist feature.

### Row differences by capture path

| Property | Form row | Chat row |
|---|---|---|
| `source` | `form` | `chat` until a later successful form submission |
| `gdprConsent` | `true` required | `false` |
| `gdprConsentedAt` | current time when form is accepted | current time anyway; this timestamp does not mean consent was given |
| `phone` | required by form/server | nullable until extracted |
| `utm_*`, `landingPath`, `referrerUrl`, `ipHash` | populated when supplied/calculated | not populated by chat |
| `status` | `new` on insert and on chat-to-form upgrade | `new` on insert; chat updates do not reset it |
| `createdAt` | database default on new row | database default on new row; chat updates preserve it |

Chat checks any existing row by lower-cased email. If it is a chat row, it updates first/last name and only truthy phone/sector/desired-role values. If it is a form row, it does nothing. Form checks only for an existing chat row; an existing form row does not prevent another form insert (`leads.ts` lines 527-562, 904-943).

### Query, export, restore, and counts

- The admin list queries PostgreSQL through Drizzle, orders by descending `created_at`, applies optional filters, and paginates. The count and status aggregates use the same active filter; `createdLast7Days` uses a rolling seven-day timestamp, not calendar-week boundaries (`leads.ts` lines 153-205; `weeklyStats.ts` lines 49-80).
- There is no public lead list/count route.
- There is no CSV export, database export UI, restore operation, or lead audit trail in the waitlist implementation.
- The number shown beside `Contacts from the waitlist page` is the filtered API `total` count, not a public-site waitlist count (`AdminLeadsPage.tsx` lines 549-555).

## 7. Admin behavior and role scope

`LeadsGuard` allows only `admin`, `super_admin`, and `marketing` to render `/admin/leads`; other users are redirected to `/` (`App.tsx` lines 172-185, 300-302). The backend independently enforces the same role set with `requireRole` (`leads.ts` lines 114-117).

- Admin and super-admin see the full lead projection, status aggregate cards, assignee filter, assign/unassign controls, status controls, Calendar button, and permanent Delete action.
- Marketing sees a reduced lead projection, a rolling personal performance banner, own/unassigned scope by default, Claim for unassigned rows, and status controls only after assignment. The backend also prevents cross-owner status/bulk updates.
- The UI presents a two-stage lead process bar for `Captured`, `Claimed`, `Contacted`, and `Registered`; this is display logic derived from current status/assignee/timestamps, not a separate workflow table (`AdminLeadsPage.tsx` lines 270-359).
- Clicking Calendar navigates to the related admin calendar with a `leadId`; creating a manual linked event changes a `new` lead to `contacted`. Merely opening Calendar or claiming a lead does not mark it contacted.
- Admin delete confirmation copy says deletion permanently removes the selected leads and cannot be undone (`AdminLeadsPage.tsx` lines 891-910).

## 8. Conversion attribution

Candidate registration is a separate public auth operation. After the user row and verification email are successfully created, the server updates all `social_leads` rows whose email equals the normalized registration email:

```ts
{
  status: "registered",
  convertedUserId: user.id
}
```

The update is not restricted to `source = "chat"` or `source = "form"` and does not select one row. There is no lead ID or attribution token in the registration request. If this update fails, registration still returns its normal 201 response; the server logs the error (`auth.ts` lines 127-168).

The registration email is not a waitlist confirmation. It is the normal account verification email sent through Resend before the attribution update. The relevant email is `JOBSAGE: Verify your email address` (`email.ts` lines 252-259).

## 9. Email, AI, database, and third-party boundaries

### Email

The waitlist form and chat routes do not import or call `artifacts/api-server/src/lib/email.ts`. The email module initializes Resend and exposes account/platform email functions, including verification and password reset, but no `sendWaitlistConfirmation`, `sendLeadNotification`, or equivalent waitlist function (`email.ts` lines 1-10, 252-260, 571-579).

Therefore:

- Waitlist welcome/confirmation email: **not implemented**.
- Internal notification when a lead arrives: **not implemented**.
- Double opt-in: **not implemented**.
- Waitlist unsubscribe: **not implemented**.
- Waitlist email delivery retry/outbox: **not implemented**.
- Waitlist email-provider failure handling: **not applicable to capture**, because capture never calls the provider.
- Registration verification email after a later `/register`: implemented, but it is account verification, not waitlist confirmation.

### AI

Chat uses the shared OpenAI-compatible client. The client requires `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` at module load and passes them to the OpenAI SDK (`lib/integrations-openai-ai-server/src/client.ts` lines 1-18). `leads.ts` uses that client for both conversational generation and structured extraction (`leads.ts` lines 825-887). The chat route has no alternate non-AI persistence path when extraction never yields both name and email.

### Database

`lib/db/src/index.ts` requires `DATABASE_URL`, creates a node-postgres pool, attaches an idle-client error handler, and exports the Drizzle database (`lines 18-28`). `social_leads` is stored in PostgreSQL, not SQLite, Replit KV, Google Sheets, Airtable, Mailchimp, ConvertKit, HubSpot, Slack, or a client-side store.

### Other integrations

The capture paths call only the JOBSAGE API, PostgreSQL, and the OpenAI integration (chat only). Calendly is used only by the later marketer calendar workflow; it is not called by public capture. No waitlist webhook or third-party CRM destination is implemented.

## 10. Environment-variable list

Names and purposes only; no values are included.

| Variable | Relevance | Purpose / requirement |
|---|---|---|
| `DATABASE_URL` | Direct, required | PostgreSQL connection string used by Drizzle; API/database bootstrap throws if absent (`lib/db/src/index.ts` lines 18-26). |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Repository-documented database alternatives/context | Listed as PostgreSQL environment variables in `replit.md` lines 125-133. The waitlist database module directly checks `DATABASE_URL`. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Direct for chat, required for API module load | OpenAI-compatible proxy base URL (`client.ts` lines 3-18). |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Direct for chat, secret, required for API module load | OpenAI-compatible proxy credential (`client.ts` lines 9-17). Do not print its value. |
| `RESEND_API_KEY` | Indirect/shared registration dependency; not used by waitlist capture | Resend credential for shared email module. Missing it causes the email module to log that all emails will fail (`email.ts` lines 3-7). |
| `EMAIL_FROM` | Indirect/shared registration dependency; not used by waitlist capture | Shared sender address, default `noreply@jobsage.co.uk` (`email.ts` lines 8-9). |
| `APP_URL` | Indirect/shared email dependency; not used by waitlist capture | Base URL for account email links, default `https://jobsage.co.uk` (`email.ts` lines 9, 252-258). |
| `SESSION_SECRET` | Shared auth/infrastructure; not used by public capture | Express/session signing configuration documented by `replit.md` lines 125-133. |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` | Shared platform infrastructure; not used by waitlist capture | Object-storage configuration documented by `replit.md` lines 127-133. |
| `EMAIL_OPS` | Other shared email fallback; not used by waitlist capture | Operations inbox default used by speculative-CV email workflows (`email.ts` line 330), not by leads. |

There is no waitlist-specific feature flag or environment switch in `GetStartedPage.tsx` or `leads.ts`.

## 11. Exact UI copy

The following strings are part of the current public/admin behavior and should be copied exactly if reproducing it.

### Public page

- Header: `Sign in`
- Hero badge: `Open to professionals from all sectors`
- Hero heading: `Land your next role in the UK`
- Hero paragraph: `Tell us what you're looking for and we'll match you with UK employers who can hire and sponsor you — across any industry.`
- Hero bullets: `All sectors welcome`, `Free to use`, `No commitment`
- Tabs: `Chat with AI`, badge `Recommended`, `Fill out Form`
- Chat header: `JOBSAGE AI`; subtitle `UK career & relocation advisor`; status `Online`
- Initial chat message: `Hi there! 👋 I am JOBSAGE AI, your guide to building a career in the UK.\n\nWhether you are looking for a new role, exploring visa and sponsorship options, or just starting to plan your UK move, I am here to help.\n\nTo get started, what is your name?`
- Chat placeholder: `Type your message… (Enter to send)`
- Streaming chat placeholder: `JOBSAGE AI is typing…`
- Chat fallback: `Prefer a form instead?`; link `Switch to the form`
- Three-turn CTA: `Ready to explore your UK career options?`; `Create a free account to see matched opportunities, sponsor-licensed employers, and your personalised UK pathway.`; buttons `Create free account` and `Fill out form instead`
- Form section heading: `Your contact details`; subtext `We'll pass these to the team so they can reach you.`
- Form labels: `First name *`, `Last name *`, `Email address *`, `Phone number *`
- Form placeholders: `Jane`, `Smith`, `jane@example.com`, `+44 7700 000000`
- Career heading: `Your career interests`; subtext `Helps us match you with the right UK opportunities.`
- Sector label: `Sector / Industry (optional)`; empty option `Select a sector…`; `Other` helper placeholder `Please describe your sector…`
- Consent: `I agree to JOBSAGE storing and processing my information to assess my UK career options and send me relevant updates. I understand I can withdraw consent at any time.`; link `Privacy Policy`
- Form button: `Get in touch`; loading button: `Submitting…`
- Consent error: `Please confirm your consent before submitting.`
- Generic frontend errors: `Submission failed`, `Something went wrong. Please try again.`, `Network error. Please try again.`, and chat `Sorry, I'm having trouble right now. Please try again.`
- Success heading: `You're on the list!`
- Success body: `We've received your details and will be in touch shortly with your personalised UK pathway assessment.`
- Success buttons: `Create your free account`, `Back to homepage`
- Footer: `© {current year} JOBSAGE Ltd`; link `Privacy Policy`

These strings are in `GetStartedPage.tsx` lines 98-125, 151-285, 322-393, 401-429, 654-766.

### Admin page

- Heading: `Waitlist Leads`
- Subtitle: `Contacts from the waitlist page · {total} total`
- Search placeholder: `Search by name or email…`
- Sector filter: `Filter by Sector`, `All Industries`
- Assignee filter: `Filter by assignee`, `All assignees`, `Unassigned`
- Marketing checkbox: `Including unassigned`
- Bulk controls: `Set status…`, `Assign selected…`, `Unassign selected`, `Apply`, `Assign`, `Delete`
- Table headings: `Name`, `Email`, `Phone`, `Sector`, `Source`, `Booking`, `Assigned`, `Status`, `Date`
- Source badges: `AI Chat`, `Form`
- Empty states: `No leads match your search.`, `No leads yet.`
- Pagination: `Page {page} of {totalPages} · {total} total`, `Previous`, `Next`
- Delete dialog: `Delete {n} lead(s)?`; `This will permanently remove this lead/these {n} leads from the system. This action cannot be undone.`; `Cancel`, `Delete`
- Process bar: `Captured`, `Claimed`, `Contacted`, `Registered`; state labels include `Unqualified / Disqualified`, `✓ Converted to User`, `In Contact / Follow-up`, `Claimed • Pending First Outreach`, and `New Inbound • Ready to Claim`

Admin copy is in `AdminLeadsPage.tsx` lines 270-359 and 544-915.

## 12. Edge and failure matrix

| Situation | Existing behavior |
|---|---|
| Empty form submit | Browser native required validation normally prevents the handler. If bypassed, server returns the first Zod 400 error. |
| Whitespace-only required value | No explicit trim occurs before Zod `min(1)`; a string containing whitespace is not empty to Zod. |
| Invalid email | Browser `type=email` may block it; server returns 400 `A valid email address is required`. |
| Missing/false consent | Client shows `Please confirm your consent before submitting.`; server independently rejects with 400 consent error. |
| Missing phone | Browser/server rejects form. Chat may persist null phone. |
| Sector list unavailable | Client silently leaves options empty; the form can still submit an optional sector value as empty. |
| `Other` with no custom text | Form omits `industrySector`; it does not submit literal `Other`. |
| Duplicate form email | No unique constraint and no generic dedupe. A second form row can be inserted. |
| Form after chat for same email | Existing chat row is upgraded in place to form, consent true, current form attribution, status new. |
| Chat sees existing form email | It does not modify the form row. |
| Chat has email but no extracted name | No row is saved because save requires both extracted name and email. |
| Chat extraction failure | Conversation continues; extraction is non-critical. No row is saved for that turn unless prior extraction already saved one. |
| Chat DB save failure | Error is logged server-side; SSE continues and can finish successfully. The client is not told that persistence failed. |
| AI provider failure before/while streaming | Server emits an SSE error event after flushing headers and closes; client replaces the last bubble with its friendly error text. |
| Public form DB failure | HTTP 500 with `Failed to submit your details. Please try again.`; no email is attempted. |
| Network failure on form | Client shows the thrown error message or generic fallback and re-enables submit. |
| Double-click form submit | Button is disabled after the handler starts, but there is no server idempotency key or general dedupe. |
| Bot/spam | No CAPTCHA, honeypot, behavioral detection, or waitlist-specific rate limiter is implemented. |
| IP privacy | Only a SHA-256 hash of the selected IP string is stored; no raw IP column exists. |
| Registration attribution failure | Registration succeeds; lead update is logged and skipped. |
| Email provider unavailable during registration | User creation is rolled back and registration returns 503; this is account verification behavior, not waitlist capture. |
| Unauthorized admin route | 401 when unauthenticated; 403 for wrong role. |
| Marketing sees another marketer's lead | Backend scope excludes it; UI also only selects owned rows. |
| Marketing claims already claimed lead | 409 `Lead is already claimed.` |
| Delete | Admin/super-admin only; permanent database deletion, no restore. |
| Calendar linked to new lead | Creating the event changes status to contacted and sets `contactedAt`. |

## 13. SellBuyLink porting checklist

Rebuild these items to reproduce JOBSAGE as documented; do not add controls or behaviors not listed.

### Public page

- [ ] Add exactly one public page at `/get-started`; do not add `/waitlist`.
- [ ] Render the sticky header, logo, `Sign in`, hero, badge, heading, paragraph, three bullets, two tabs, footer, and privacy-policy link with the exact copy above.
- [ ] Default to the chat tab; provide the form tab and the chat-to-form switch.
- [ ] Load sector options from a public endpoint backed by the sponsor/company-sector source, sort them, exclude exact `Other`, append `Other`, and cache for one hour.
- [ ] Reproduce form initial state and controls, including required contact fields, optional sector, conditional custom sector, and consent checkbox.
- [ ] Preserve the currently surprising non-rendered `desiredRole` and `additionalMessage` state behavior if exact compatibility is required; do not silently expose new fields.
- [ ] Capture only current URL UTM parameters at form submit; send `landingPath` and `document.referrer`; do not add user-agent capture or first-touch persistence.
- [ ] Use a JSON `POST` without an API key or public session requirement.
- [ ] Keep the consent check on both client and server.
- [ ] Disable the form during submission, but do not add idempotency/deduplication beyond chat-to-form upgrade.
- [ ] Implement the exact success/loading/error text and success links; do not add a duplicate/already-signed-up state.

### Chat

- [ ] Implement the initial assistant message exactly.
- [ ] Send `{message, history}` as JSON and return SSE with `text`, optional `error`, and terminal `done/extracted` events.
- [ ] Limit server model history to the last 12 supplied entries.
- [ ] Use the two-call extraction behavior: conversational response first, structured extraction after at least two user turns.
- [ ] Extract only `name`, `email`, `phone`, `industrySector`, and `desiredRole`.
- [ ] Require extracted name and email before saving a chat row.
- [ ] Save partial chat data progressively, with `source = chat`, `status = new`, `gdprConsent = false`, and the current timestamp in `gdprConsentedAt` as the existing implementation does.
- [ ] Do not attach form UTM/referrer/path/IP metadata to chat saves.
- [ ] Leave an existing form row unchanged when chat later sees its email.
- [ ] Prefill the form from extracted data but do not auto-submit it.
- [ ] Reproduce the distinct server/client chat failure messages and the post-header SSE failure semantics.

### Backend and database

- [ ] Create PostgreSQL `social_leads` with every column, nullability, default, status/source values, indexes, and FK behavior listed above.
- [ ] Preserve the historical migration sequence, especially initial non-null phone followed by nullable phone.
- [ ] Do not add a unique email constraint or generic duplicate handling if exact behavior is required.
- [ ] Lower-case email on capture and registration attribution.
- [ ] Hash the selected client IP with SHA-256 and store only the hash.
- [ ] Implement form upgrade of a chat row and the separate duplicate-form behavior.
- [ ] Implement registration attribution by normalized email, updating all matches, and make lead attribution non-fatal to registration.
- [ ] Expose public sector, form-submit, and SSE-chat routes even though they are absent from the existing OpenAPI document; if port documentation is generated, document this intentional parity gap.
- [ ] Implement CRM list, stats, assignee, claim, status, bulk status, bulk assignee, and delete routes with the exact role restrictions and status codes.
- [ ] Do not add waitlist-specific CSRF, CAPTCHA, rate limiting, webhooks, notification email, unsubscribe, or export.

### Admin operations

- [ ] Add `/admin/leads` guarded for admin, super-admin, and marketing roles.
- [ ] Give admin/super-admin the full projection and destructive delete/assignment operations.
- [ ] Give marketing reduced fields, own/unassigned scope, claim, owned status updates, and personal performance metrics.
- [ ] Include the status process bar and exact empty/loading/error/deletion copy.
- [ ] Add `/admin/calendar` and the lead-to-calendar link only if reproducing the related operational surface.
- [ ] Ensure scheduling a manual event for a new lead changes it to contacted; do not mark it contacted merely on claim or page open.
- [ ] Do not add CSV export, restore, public counts, or an audit history unless intentionally departing from JOBSAGE behavior.

### Integrations and configuration

- [ ] Provide PostgreSQL configuration (`DATABASE_URL` and the repository's documented PG variables).
- [ ] Provide the OpenAI proxy base URL and key for chat; keep their values secret.
- [ ] If reproducing account registration, provide the shared Resend and email URL configuration; do not mistake account verification for waitlist confirmation.
- [ ] Do not connect capture to Mailchimp, ConvertKit, Loops, HubSpot, Slack, Google Sheets, Airtable, or a waitlist webhook because JOBSAGE does not.
- [ ] Do not infer behavioral analytics from unrelated platform analytics code.

## 14. Verification notes

The implementation inventory was checked against:

- route registration in `App.tsx` and `routes/index.ts`;
- public form/chat/sector references in `GetStartedPage.tsx` and `leads.ts`;
- all `social_leads` schema/migration files present in `lib/db/drizzle`;
- auth conversion update in `auth.ts`;
- email/OpenAI/database bootstrap modules;
- authenticated lead paths in `openapi.yaml`;
- lead route tests in `artifacts/api-server/src/__tests__/routes/leads.test.ts`; and
- repository-wide targeted search for `/waitlist`, waitlist forms, `social_leads`, public lead endpoints, analytics, CAPTCHA, and third-party lead destinations.

No application code, database schema, environment value, secret, third-party record, or product behavior was modified by this documentation task.