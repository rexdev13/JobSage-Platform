# JOBSAGE — Release Notes
**Version:** Internal Build · Sprint Week  
**Period:** Wednesday 12 August – Sunday 16 August 2026  
**Status:** Deployed to Development · Pending Production Publish

---

## Table of Contents
1. [New Features](#new-features)
2. [AI & Automation](#ai--automation)
3. [Backend & Data](#backend--data)
4. [Admin & Operations](#admin--operations)
5. [UI Improvements](#ui-improvements)
6. [Bug Fixes](#bug-fixes)

---

## New Features

### Waitlist Lead Capture System
A fully end-to-end lead capture pipeline was built from the ground up.

- **Dual-source capture:** Leads can now be collected from two distinct entry points — the **waitlist form** (manual, structured submission) and the **AI onboarding chat** (conversational, progressive collection). Every lead is tagged with a `source` field (`chat` or `form`) so their origin is always traceable.
- **AI chat progressive upsert:** Each turn of the AI onboarding conversation now upserts any extracted fields (name, email, phone, industry sector) in real time. If the same email later completes the form, the form submission upgrades the existing chat record rather than creating a duplicate entry.
- **Seamless form-to-chat handoff:** Candidates who start via chat and finish via the form are deduped correctly at the email level, ensuring a clean CRM view with no phantom entries.
- **Automatic status promotion:** When a lead with a known email completes full registration (`POST /auth/register`), their lead record is automatically updated to `status = registered` and linked to their new user account via `converted_user_id`. No manual step is required.

### Admin Leads Dashboard
A dedicated lead management table was added to the admin panel.

- **Full CRM table:** Displays all waitlist leads with name, email, phone, industry sector, source badge (AI Chat / Form), status, and date.
- **Inline status control:** Each row has a labelled dropdown (with chevron indicator) to change a lead's CRM status (`New → Contacted → Registered → Unqualified`) without leaving the table. Changes save immediately.
- **Bulk selection:** Checkboxes on every row and a select-all toggle in the column header allow multi-lead selection.
- **Bulk status update:** With leads selected, admins can set a single status across all of them in one action using the bulk status picker and Apply button.
- **Bulk delete with in-app confirmation:** Selected leads can be deleted with a single click. A purpose-built in-app confirmation dialog (using the Shadcn `AlertDialog` component) replaces the browser's native `confirm()` popup, showing a clear count and consequence before committing.
- **Search & pagination:** A live search box filters leads by name or email. Results are paginated at 25 per page with Previous / Next controls and a total count indicator.

---

## AI & Automation

### AI CV Gap Analysis
A candidate-facing tool that compares a candidate's profile against a specific vacancy.

- Implemented as a **slide-out Shadcn Sheet** triggered from any vacancy row — no page navigation required.
- Powered by `gpt-4o-mini`, the analysis categorises findings into three structured sections: **Matches** (strengths the candidate already has), **Gaps** (areas missing from the JD), and **Optimisation Steps** (concrete actions to improve fit before applying).
- **Usage cap enforced at 10 analyses per user** — a hard server-side counter prevents runaway API costs while keeping the feature accessible for normal use. Once exhausted, the trigger button is disabled with a clear message.

### AI CV Enhancement — Professional Summary Generator
Candidates can now generate a polished, UK-standard professional summary directly from their profile.

- A **"✨ Enhance CV"** action was added to the CV section of the candidate profile.
- Supports two modes: **General** (a broad, role-agnostic summary) and **Focused** (the candidate supplies a specific job title or direction, and the AI tailors the summary accordingly).
- Output is drafted in a clean editor before the candidate confirms, giving full review control before anything is saved.

### AI CV Enhancement — PDF Export & Primary CV Integration
The CV Enhancement feature was extended to produce a download-ready, fully formatted PDF.

- Built on **`pdfkit`** (server-side), the generated document follows UK CV formatting conventions: section headers, bullet points, contact block, and proper typographic hierarchy.
- On confirmation, the PDF is **saved as the candidate's primary CV**, replacing any previously uploaded file in the standard object storage pipeline.
- The saved record is explicitly flagged `isParsed: true` so the AI extraction pipeline does not re-process a document it generated — preventing redundant API calls and avoiding data overwrite.
- The PDF integrates transparently into the existing job application flow: when a candidate applies for a role, the AI-generated CV is attached automatically, exactly as a manually uploaded CV would be.

---

## Backend & Data

### `social_leads` Database Table
A new schema and migration were introduced to persist all waitlist leads.

- **Migration `0010_social_leads.sql`:** Creates the `social_leads` table with columns for `first_name`, `last_name`, `email`, `phone`, `industry_sector`, `status` (enum: `new | contacted | registered | unqualified`), `source` (enum: `chat | form`), `converted_user_id` (FK to users), UTM tracking fields (`utm_source`, `utm_medium`, `utm_campaign`), and `created_at`.
- **Migration `0011_social_leads_phone_nullable.sql`:** Relaxed the `phone` column to `NULL`-able so that AI chat leads captured before phone is collected are valid and saveable immediately.
- The schema is now committed to the migration history (`meta/_journal.json`) so it is reproducible on fresh database provisioning.

### Leads API Endpoints
Full REST surface for lead management was added to the API server:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/leads` | List all leads (paginated, searchable) |
| `POST` | `/api/leads/chat` | AI chat SSE endpoint — upserts extracted fields per turn |
| `POST` | `/api/leads/submit` | Form submission — upserts or upgrades an existing chat lead |
| `PATCH` | `/api/leads/:id/status` | Update a single lead's status |
| `PATCH` | `/api/leads/bulk-status` | Update status on multiple leads in one request |
| `DELETE` | `/api/leads` | Bulk delete leads by ID array |

All write and read endpoints require `admin` or `super_admin` role. The public `chat` and `submit` endpoints are rate-controlled separately.

---

## Admin & Operations

### Admin Account Provisioning Script
A one-time Supabase Admin API script was written to bootstrap the two official JOBSAGE operator accounts:

- `admin@jobsage.co.uk` — role: `super_admin`
- `support@jobsage.co.uk` — role: `super_admin`

The script creates each user via the Supabase Admin SDK (bypassing email verification), sets their hashed password, and writes the corresponding row in the `users` table with the correct `role` field. This avoids the need for the accounts to go through the public registration flow and ensures they are immediately active.

### Super Admin — Leads Access Fix
`GET /api/leads` was previously restricted to the `admin` role only, causing `super_admin` accounts to receive a `403 Forbidden` response when navigating to the Waitlist Leads page. The middleware guard was updated to accept both `admin` and `super_admin`, consistent with all other admin-only endpoints.

---

## UI Improvements

### Global Logo — Increased Prominence
The JOBSAGE logo was replaced with the official brand image asset (`logo.png`) and resized upward across all surfaces for stronger visual identity:

| Surface | Size |
|---------|------|
| Main app sidebar | `h-12` |
| Mobile header | `h-9` |
| Auth pages (Login, Register, Forgot/Reset Password) | `h-11 md:h-12` |
| Get Started / Onboarding pages | `h-10 md:h-12` |
| Admin login (dark background variant) | `h-11 md:h-12` with `brightness-150` filter |
| Consent page | `h-11 md:h-12` |

Previously, several pages still rendered a text + shield-icon placeholder. All instances now render the logo image.

### External Apply Button — Improved Visibility
The small external-link icon previously shown on vacancy rows to redirect candidates to the employer's website was replaced with a clearly labelled **"Apply on company's website"** button. The change improves discoverability and reduces confusion for candidates who missed the icon.

---

## Bug Fixes

| Area | Fix |
|------|-----|
| **Leads — 403 on /admin/leads** | `GET /api/leads` now accepts `super_admin` role in addition to `admin`. |
| **Chat leads — incomplete records** | The AI chat endpoint previously only triggered a save on name + email extraction. It now upserts all available fields on every turn, so no collected data is lost if the user exits mid-conversation. |
| **Lead deduplication** | Form submissions from a user who previously chatted no longer create a second lead row. The submit endpoint matches on normalised email and upgrades the existing record. |
| **CV PDF — redundant AI extraction** | AI-generated CVs are now saved with `isParsed: true`, preventing the background extraction job from processing a document the system itself produced. |
| **Status dropdown — no affordance** | The inline status badge on the leads table had no visual indicator that it was interactive. A `ChevronDown` icon is now pinned to the right of the dropdown, toggling to a spinner during a save. |

---

*Prepared by JOBSAGE Engineering · August 2026*
