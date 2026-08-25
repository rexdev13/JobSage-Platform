# Chrome Web Store submission guide — JOBSAGE Smart Apply

Everything is prepared; only the steps below require your Google account.

## What's already prepared

- **Submission zip:** `artifacts/chrome-extension/release/jobsage-smart-apply-extension-v0.4.9.zip`
  (regenerate any time with `pnpm --filter jobsage-chrome-extension run package` — this also refreshes the direct-download zip on the website)
- **Privacy policy (live page):** `https://jobsage.co.uk/extension-privacy`
- **All listing text and permission justifications:** `store/LISTING.md` (copy-paste ready)
- Manifest V3 with icons at 16/32/48/128 and the permissions needed for JOBSAGE tracking and CV fallback (`cookies`, `storage`, `downloads`, all-HTTPS host access for employer-site form detection and redirect tracking)

## Step 1 — Developer account (one-time, ~10 minutes)

1. Sign in to https://chrome.google.com/webstore/devconsole with the Google account that should own the extension (use a team/company account, not a personal one, if possible).
2. Accept the developer agreement and pay the **one-time $5 registration fee**.
3. In *Account* settings, verify your **contact email** (required before you can publish) and set publisher name to **JOBSAGE**.
4. Recommended: verify the `jobsage.co.uk` domain under *Account → Verified domains* (via Google Search Console) so the listing can display "by jobsage.co.uk".

## Step 2 — Upload

1. In the dashboard, click **+ New item** and upload `release/jobsage-smart-apply-extension-v0.4.9.zip`.
2. The dashboard parses the manifest and opens the draft listing.

## Step 3 — Fill in the listing

Open `store/LISTING.md` and paste each field:

- **Store listing tab:** description, category (Productivity → Workflow & Planning), language.
- **Graphic assets:** upload at least one 1280×800 screenshot (see the capture list at the bottom of LISTING.md — you need to take these; the store rejects listings without screenshots).
- **Privacy tab:** single-purpose description, privacy policy URL, per-permission justifications, data-usage disclosures, and the "no remote code" declaration — all provided verbatim in LISTING.md.
- **Distribution tab:** Public, free, all regions (or restrict to the UK if preferred — candidates are often applying from abroad, so worldwide is recommended).

## Step 4 — Submit for review

1. Click **Submit for review**.
2. Leave "Publish automatically after review" ON unless you want to time the launch.
3. **Expected review time:** because the content script matches `https://*/*` (broad host access), the extension goes through in-depth review — typically a few days, occasionally up to 2–3 weeks. This is normal; the justification text in LISTING.md addresses exactly what reviewers ask about.

## If the review asks questions / rejects

Common prompts and the answers:

- **"Why do you need access to all websites?"** → paste the broad-match justification from LISTING.md (employer application forms live on unenumerable domains; detection is local; data only goes to the user's own JOBSAGE account).
- **"Narrow your permissions"** → all-HTTPS host access is required because applicants move between unenumerable employer domains and ATS confirmation pages. The extension uses it only for local form detection and to retain a JOBSAGE-originated click through that application flow; it only communicates with JOBSAGE. If reviewers insist, a fallback is to enumerate the top domains (nhs.jobs, trac.jobs, etc.) and ship broader support later — but try the justification first.
- **"Where is your privacy policy?"** → https://jobsage.co.uk/extension-privacy

Reply via the dashboard's review thread; resubmission after edits restarts the review.

## Publishing updates later

1. Bump `version` in `manifest.json` (e.g. `0.2.1` — Chrome requires each upload to have a higher version).
2. Run `pnpm --filter jobsage-chrome-extension run package`.
3. In the dashboard: your item → **Package → Upload new package** → submit for review.

## Note on the current install flow

The website's "Load unpacked" download flow keeps working unchanged and stays useful while the store review is pending. Once the store listing is live, consider updating `SmartApplyExtensionPrompt.tsx` on the web app to link to the store page (one-click install) instead of the manual unzip instructions.

## Smart Apply v0.4.9 behaviour

- The helper can only prefill empty, visible, unambiguous contact fields. It never fills passwords, usernames, dates of birth, National Insurance/passport fields, or an ambiguous “Name” input.
- A tracked JOBSAGE application opens the helper and keeps a minimizable launcher available through ATS redirects. This only occurs after the first-party JOBSAGE page registers the exact outbound URL; a public `ref=jobsage` parameter alone never triggers prefill. Dismissing the helper on an unrelated site still works as before.
- NHS Jobs, Trac, and Workday use dedicated long-form selectors in addition to the generic question fallback:
  - **NHS Jobs:** supporting-information and personal-statement ids/names.
  - **Trac:** supporting-statement and `question…` textareas.
  - **Workday:** `data-automation-id` containers for question, long-text, supporting, and statement fields.
- The CV is downloaded from the authenticated JOBSAGE API, attached only to a matching CV/resumé file input, and otherwise downloaded with the instruction: **“Upload this file on the form.”**
