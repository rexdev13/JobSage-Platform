# JOBSAGE — Release Notes
**Version:** Internal Build · Sprint Week  
**Period:** Wednesday 12 August – Sunday 16 August 2026  
**Environment:** Development Preview  
**Base URL:** https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev

---

## Table of Contents
1. [New Features](#new-features)
2. [AI & Automation](#ai--automation)
3. [UI Improvements](#ui-improvements)

---

## New Features

---

### 1. Waitlist Lead Capture System

Candidates can join the JOBSAGE waitlist via two routes: a structured **waitlist form** or an **AI onboarding chat**. Every submission is stored, tagged by source, and visible to admins in real time.

- **Dual-source capture** — leads arrive from the waitlist form (`/get-started`) or from conversational AI chat on the same page. Each record is tagged `chat` or `form` so origin is always clear.
- **AI chat progressive saving** — the chat endpoint saves partial data on every exchange turn. If a user drops off mid-conversation, whatever was collected (name, email, phone, sector) is already persisted.
- **Smart deduplication** — if someone chats first and then fills in the form, the form submission upgrades the existing chat record rather than creating a duplicate entry.
- **Automatic conversion tracking** — when a waitlisted lead creates a full account at `/register`, their lead record is automatically promoted to `Registered` status and linked to their new user ID.

**🔗 Links**
- Waitlist page: [`/get-started`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/get-started)
- Admin leads table: [`/admin/leads`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/leads)

**🧪 How to Test**

*Form flow:*
1. Open [`/get-started`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/get-started) in an incognito window and click the **Form** tab.
2. Fill in a name, email, phone, and sector, then submit.
3. Log in to [`/admin/leads`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/leads) — the submission should appear with source badge **Form**.

*Chat flow:*
1. On the same page, switch to the **Chat** tab.
2. Converse with the AI through a few turns without completing the full flow.
3. Check the admin leads table — a partial record should already be saved with source badge **AI Chat**.

*Conversion tracking:*
1. Use the email from a waitlist lead to register a new account at [`/register`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/register).
2. Return to the admin leads table — the lead's status should have automatically changed to **Registered**.

---

### 2. Admin Leads Dashboard

A full CRM-style leads management table accessible to admin and super_admin accounts.

- **Searchable, paginated table** — search by name or email across all leads; results are paged at 25 per page.
- **Inline status control** — every row has a labelled status dropdown (with a chevron arrow to indicate interactivity). Options: New, Contacted, Registered, Unqualified. Changes save instantly without a page reload.
- **Multi-select with bulk actions** — tick individual rows or use the header checkbox to select all leads on the page. The bulk action bar then appears with:
  - **Bulk status update** — pick a status and press Apply to update all selected leads at once.
  - **Bulk delete** — removes all selected leads after confirming in an in-app modal (not a browser popup).
- **Source badges** — each row displays a coloured badge indicating whether the lead came from the AI Chat or the Form.

**🔗 Links**
- Admin login: [`/admin/login`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/login)
- Leads table: [`/admin/leads`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/leads)

**🧪 How to Test**

*Inline status change:*
1. Log in at [`/admin/login`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/login) using `admin@jobsage.co.uk`.
2. Navigate to [`/admin/leads`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/leads).
3. Click the status dropdown on any row and change it — confirm the badge colour updates immediately.

*Bulk status change:*
1. Tick two or more checkboxes — the bulk action bar should appear above the table.
2. Choose a status from the **Set status…** dropdown and click **Apply**.
3. Confirm all selected rows now show the new status.

*Bulk delete:*
1. Select one or more leads via their checkboxes.
2. Click **Delete** — an in-app modal should appear (not a browser alert) showing the count.
3. Confirm — the leads should be removed and the count in the page header should decrease.

*Search:*
1. Type a partial name or email into the search box.
2. Confirm the table filters live; clearing the box restores all results.

---

## AI & Automation

---

### 3. AI CV Gap Analysis

A candidate-facing tool that scores a candidate's profile against a specific job vacancy and returns structured feedback — all within a slide-out panel, no page navigation required.

- Triggered from any vacancy row on the Opportunities page.
- Powered by `gpt-4o-mini`, results are structured into three sections: **Matches** (existing strengths), **Gaps** (missing criteria from the JD), and **Optimisation Steps** (concrete actions to take before applying).
- **Hard-capped at 10 analyses per user** — enforced server-side. The trigger button is disabled with a clear message once the limit is reached.

**🔗 Links**
- Opportunities page: [`/opportunities`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/opportunities)

**🧪 How to Test**
1. Log in as a candidate and go to [`/opportunities`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/opportunities).
2. Find any vacancy and click the **CV Gap Analysis** trigger button on that row.
3. A slide-out sheet should open and the AI analysis should load — confirm it shows Matches, Gaps, and Optimisation Steps sections.
4. Repeat up to 10 times with different vacancies — on the 11th attempt, confirm the button is disabled and a usage-limit message is shown.

---

### 4. AI CV Enhancement — Professional Summary Generator

Candidates can generate a polished, UK-standard professional summary directly from their profile data using AI.

- Accessible from the CV section of the candidate profile page.
- Two modes: **General** (a broad, role-agnostic summary) and **Focused** (the candidate specifies a target job title or direction and the AI tailors the output accordingly).
- The generated text is shown in an editable preview — the candidate can review and adjust before saving.

**🔗 Links**
- Profile page: [`/profile`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/profile)

**🧪 How to Test**
1. Log in as a candidate and navigate to [`/profile`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/profile).
2. Find the **✨ Enhance CV** button in the CV section.
3. Select **General** mode and generate — confirm a professional summary appears in the preview editor.
4. Clear the result, select **Focused** mode, enter a job title (e.g. "Senior Software Engineer"), and generate again — confirm the output references the specified role.
5. Edit the text in the preview, then save — confirm the updated summary is reflected on the profile.

---

### 5. AI CV Enhancement — PDF Export & Primary CV Integration

The CV Enhancement feature now generates a download-ready PDF that is saved as the candidate's active CV and flows directly into job applications.

- Built with `pdfkit` server-side, the PDF follows UK CV formatting conventions: contact block, section headers, bullet points, and consistent typographic hierarchy.
- On confirmation, the generated PDF **replaces** the candidate's primary CV in their document library.
- The saved record is flagged to prevent the AI extraction pipeline from re-processing a document it generated — avoiding redundant calls and data overwrite.
- When the candidate next applies for a role, the AI-generated CV is attached automatically, exactly as an uploaded CV would be.

**🔗 Links**
- Profile page: [`/profile`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/profile)
- Documents page: [`/documents`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/documents)
- Applications page: [`/applications`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/applications)

**🧪 How to Test**
1. Complete the CV Enhancement flow (Feature 4 above) and confirm the generated summary.
2. After saving, navigate to [`/documents`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/documents) — a new PDF should appear as the primary CV with today's date.
3. Download the PDF and verify it is formatted correctly (contact details, professional summary, sections).
4. Apply for any vacancy on [`/opportunities`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/opportunities) — confirm the AI-generated CV is attached to the application on [`/applications`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/applications).

---

## UI Improvements

---

### 6. Global Logo — Increased Size & Consistency

The JOBSAGE logo was standardised to use the official brand image asset (`logo.png`) across all pages, replacing the previous text + shield-icon placeholder that appeared on several screens.

| Surface | Size Applied |
|---------|-------------|
| Main app sidebar | `h-12` |
| Mobile header | `h-9` |
| Login & Register pages | `h-11 md:h-12` |
| Forgot / Reset Password | `h-11 md:h-12` |
| Get Started & Onboarding | `h-10 md:h-12` |
| Admin login (dark background) | `h-11 md:h-12` + brightness filter |
| Consent page | `h-11 md:h-12` |

**🔗 Links to verify**
- [`/login`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/login)
- [`/register`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/register)
- [`/forgot-password`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/forgot-password)
- [`/admin/login`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/login)
- [`/get-started`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/get-started)

**🧪 How to Test**
1. Visit each link above — confirm the JOBSAGE logo image appears in place of any text or icon placeholder.
2. Resize the browser window to a mobile viewport — confirm the logo scales correctly and remains legible.
3. On [`/admin/login`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/admin/login) (dark background) — confirm the logo is visible and bright against the dark header.

---

### 7. External Apply Button — Improved Visibility

The small external-link icon previously shown on vacancy rows was replaced with a clearly labelled **"Apply on company's website"** button.

**🔗 Links**
- Opportunities page: [`/opportunities`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/opportunities)

**🧪 How to Test**
1. Log in and navigate to [`/opportunities`](https://23c98aa3-1203-40d8-a2e6-823a6b5f7f9b-00-1tujigjox0n0r.kirk.replit.dev/opportunities).
2. Find a vacancy that has an external apply URL.
3. Confirm the row shows a full **"Apply on company's website"** button rather than a small icon.
4. Click the button — confirm it opens the correct external URL in a new tab.

---

*Prepared by JOBSAGE Engineering · August 2026*
