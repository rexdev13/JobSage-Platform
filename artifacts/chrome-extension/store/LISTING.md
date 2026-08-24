# Chrome Web Store listing copy — JOBSAGE Smart Apply

Copy-paste ready text for each field in the Developer Dashboard.

## Store listing

**Name** (max 75 chars)

```
JOBSAGE Smart Apply
```

**Short description / summary** (max 132 chars — this is the manifest `description`, shown in search results)

```
Fill in job applications on NHS Jobs, Trac and employer sites with your JOBSAGE profile — and track every application.
```

**Category:** Productivity → Workflow & Planning

**Language:** English (United Kingdom)

**Detailed description**

```
JOBSAGE Smart Apply is the companion extension for JOBSAGE (jobsage.co.uk), the career platform for international healthcare professionals building their career in the UK.

Applying for UK healthcare jobs means filling in the same details again and again across NHS Jobs, Trac, and dozens of employer career sites — and it's easy to lose track of what you've applied for. Smart Apply fixes both.

WHAT IT DOES

• Recognises job application forms on NHS Jobs, Trac and other employer sites as you browse
• Helps you fill in applications using the profile you've already built on JOBSAGE — qualifications, registration details, work history
• Automatically logs every application in your JOBSAGE tracker, so your pipeline is always up to date
• Shows a small sidebar assistant only on recognised application pages — it stays out of your way everywhere else

HOW IT WORKS

Sign in to your free JOBSAGE account at jobsage.co.uk, install the extension, and apply as normal. When Smart Apply detects a supported application form, the JOBSAGE assistant appears and offers to help. Everything you submit is recorded in your tracker on JOBSAGE.

PRIVACY

Smart Apply only talks to JOBSAGE. It reads your JOBSAGE sign-in cookie (for jobsage.co.uk only) to act on your behalf, and reads form fields and the current page URL on job application pages to help fill them in and connect a submitted application to the role you opened from JOBSAGE. It contains no analytics, no ads, and sends nothing to third parties. Full privacy policy: https://jobsage.co.uk/extension-privacy

A free JOBSAGE account is required.
```

## Privacy tab

**Single purpose description**

```
Helps JOBSAGE users fill in job application forms on employer websites using their JOBSAGE profile, and logs those applications in their JOBSAGE application tracker.
```

**Privacy policy URL**

```
https://jobsage.co.uk/extension-privacy
```

**Permission justifications**

- `cookies`:

```
The extension reads the user's existing JOBSAGE session cookie (jobsage.co.uk only) so it can authenticate API requests to JOBSAGE on the user's behalf — fetching their profile to fill application forms and saving applications to their tracker. No cookies from any other site are read.
```

- `storage`:

```
Stores small local UI preferences (such as sidebar open/closed state) in the browser. No browsing data or personal data is stored.
```

- `downloads`:

```
Lets the candidate save their own current JOBSAGE CV only when an employer form does not expose a compatible CV upload field. The download is initiated from the visible JOBSAGE helper and is never used to download browsing data.
```

- Host permission `https://*/*`:

```
Candidates apply on hundreds of employer career sites whose domains cannot be enumerated in advance. This permission lets the extension run its local application-form assistant and retain a JOBSAGE-originated application link through an employer-site redirect or confirmation page. The extension only communicates with JOBSAGE: it reads the JOBSAGE session cookie only on jobsage.co.uk and sends no data to employer sites or third parties.
```

- All-HTTPS content-script use:

```
Candidates apply on hundreds of different employer career sites (NHS Jobs, Trac, individual hospital and care-provider sites) whose domains cannot be enumerated in advance. The content script runs a lightweight local check on each page to detect whether it is a supported job application form; it only activates the assistant and reads form fields on recognised application pages. No page data leaves the browser except application details the user chooses to save to their own JOBSAGE tracker.
```

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package; nothing is loaded from external servers.)

**Data usage disclosures** — tick:

- "Personally identifiable information" → collected (name/contact details from the user's own JOBSAGE profile, used to fill forms) — *used for app functionality only*
- "Authentication information" → collected (JOBSAGE session cookie) — *used for app functionality only*
- "Website content" → collected (form fields on job application pages) — *used for app functionality only*

Certify all three statements: data is not sold, not used for unrelated purposes, not used for creditworthiness/lending.

## Graphic assets you must capture (not included here)

- **Screenshots (required, 1–5):** 1280×800 PNG. Suggested shots: (1) the assistant sidebar on an NHS Jobs/Trac application form, (2) an application auto-logged in the JOBSAGE tracker, (3) the JOBSAGE profile that powers form filling.
- **Small promo tile (optional):** 440×280.
- **Marquee promo (optional):** 1400×560.
- Store icon 128×128 is already in the package (`icons/icon128.png`) and is uploaded automatically with the zip.
