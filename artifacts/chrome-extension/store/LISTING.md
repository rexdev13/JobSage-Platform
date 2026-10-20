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

• Recognises supported job application forms locally when the helper is active
• Helps you fill in applications using the profile you've already built on JOBSAGE — qualifications, registration details, work history
• Lets you save application details to your JOBSAGE tracker, so your pipeline stays organised
• Opens automatically for tracked applications started from JOBSAGE, or on other pages when you activate it from the extension icon

HOW IT WORKS

Sign in to your free JOBSAGE account at jobsage.co.uk and install the extension. Start an application from a JOBSAGE role to open the assistant automatically on the employer site. On another employer page, click the JOBSAGE extension icon and choose “Use JOBSAGE on this page.” The helper checks for supported application forms locally. Review suggested answers, complete sensitive or personal declarations yourself, and save application details to your JOBSAGE tracker.

PRIVACY

Smart Apply reads your JOBSAGE sign-in cookie only on jobsage.co.uk. It checks pages locally for supported application forms, and reads relevant form labels, role details and page URLs only in application flows. When Smart Apply maps profile facts into a tracked application form, or you request an AI-drafted answer, JOBSAGE sends the relevant question, role context and profile/CV facts to OpenAI for processing. The extension does not send form data directly to employers; information reaches an employer when you submit its form. No analytics or advertising trackers are included. Full privacy policy: https://jobsage.co.uk/extension-privacy

A free JOBSAGE account is required.
```

## Privacy tab

**Single purpose description**

```
Helps JOBSAGE users fill in job application forms on employer websites using their JOBSAGE profile, and save application details in their JOBSAGE application tracker.
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
Stores interface preferences, dismissed sites, and answers the candidate explicitly saves to the local answer library. Short-lived session storage carries only a JOBSAGE-selected application link through employer redirects. It is not a general browsing history and does not cache the full profile or CV.
```

- `downloads`:

```
Lets the candidate save their own current JOBSAGE CV only when an employer form does not expose a compatible CV upload field. The download is initiated from the visible JOBSAGE helper and is never used to download browsing data.
```

- Host permission `https://*/*`:

```
Candidates apply on hundreds of employer career sites whose domains cannot be enumerated in advance. This permission lets the extension detect supported forms locally and retain a JOBSAGE-selected application link through an employer-site redirect. Extension API requests go to JOBSAGE; when structured mapping runs in a tracked application flow or a user requests AI drafting, JOBSAGE sends the necessary question, role context and profile/CV facts to OpenAI for processing. The extension reads the JOBSAGE session cookie only on jobsage.co.uk and does not directly send form data to employers.
```

- All-HTTPS content-script use:

```
Candidates apply on hundreds of different employer career sites (NHS Jobs, Trac, individual hospital and care-provider sites) whose domains cannot be enumerated in advance. The content script runs a lightweight local check; the assistant opens automatically for tracked applications started from JOBSAGE or after the candidate activates it from the extension icon. It reads relevant form labels and role context only on active application pages. Details leave the browser only for JOBSAGE features the candidate uses; when structured mapping runs in a tracked application flow or AI drafting is requested, JOBSAGE sends the necessary question, role context and profile/CV facts to OpenAI for processing.
```

- `webNavigation`:

```
Carries the exact application URL selected from a JOBSAGE opportunity through employer-site redirects, so the candidate can return to the correct role and save it in their tracker. It does not collect a general browsing history.
```

- `tabs`:

```
Queries the active tab only so the candidate can open or reopen the JOBSAGE helper on the current page. The extension does not read a list of browsing tabs or collect unrelated tab URLs.
```

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package; nothing is loaded from external servers.)

**Data usage disclosures** — tick:

- "Personally identifiable information" → collected (profile and CV facts, used to fill forms or to provide requested AI assistance) — *used for app functionality only*
- "Authentication information" → collected (JOBSAGE session cookie) — *used for app functionality only*
- "Website content" → collected (form fields on job application pages) — *used for app functionality only*
- "Web history" → collected only for application flows (the JOBSAGE-selected role URL is carried through redirects and may be saved to the user's tracker) — *used for app functionality only*

**Third-party processing:** disclose that JOBSAGE sends relevant application question/context and candidate profile/CV facts to OpenAI when structured mapping runs in a tracked application flow or the user requests AI drafting. Do not claim that no data is shared with third parties.

Certify all three statements: data is not sold, not used for unrelated purposes, not used for creditworthiness/lending.

## Graphic assets

- **Screenshots (required, 1–5):** three 1280×800 PNGs are included in `store/screenshots/`. They use clearly marked synthetic demo data: (1) the assistant on a supported application form, (2) reviewing an AI-drafted application answer, and (3) the JOBSAGE tracker.
- **Small promo tile (optional):** 440×280.
- **Marquee promo (optional):** 1400×560.
- Store icon 128×128 is already in the package (`icons/icon128.png`) and is uploaded automatically with the zip.
