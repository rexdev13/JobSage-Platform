# Chrome Web Store listing copy — JOBSAGE Smart Apply

Store listing copy. The final corrected Privacy answers, data categories and
owner-confirmation gates for **0.4.22** are in
[`PRIVACY-ANSWERS.md`](PRIVACY-ANSWERS.md).

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
• Helps fill supported fields using your JOBSAGE profile and optional AI mapping of selected professional facts; unavailable or sensitive details remain for you to complete
• Lets you save application details to your JOBSAGE tracker, so your pipeline stays organised
• Opens automatically for tracked applications started from JOBSAGE, or on other pages when you activate it from the extension icon

HOW IT WORKS

Sign in to your free JOBSAGE account at jobsage.co.uk and install the extension. Start an application from a JOBSAGE role to open the assistant automatically on the employer site. On another employer page, click the JOBSAGE extension icon and choose “Use JOBSAGE on this page.” The helper checks for supported application forms locally. Review suggested answers, complete sensitive or personal declarations yourself, and save application details to your JOBSAGE tracker.

PRIVACY

Smart Apply reads your JOBSAGE sign-in cookie only on jobsage.co.uk. The active helper handles application labels/options, relevant role details, supported values and application URL metadata. Before AI mapping/drafting you choose whether JOBSAGE may send application context and selected professional profile facts to OpenAI through Replit AI Integrations; this extension AI flow does not automatically include raw CV text or private profile notes. Answer remembering is off until you enable automatic local saving/reuse of eligible edits, with disable/delete controls. Google Fonts requests disclose ordinary network metadata. Filled fields and complete, unredacted attached CVs are available to employer-site scripts before submission, including possible autosave/upload. No advertising analytics or general keylogger is included. Full privacy policy: https://jobsage.co.uk/extension-privacy

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
Stores helper preferences and dismissed hostnames. Default-off answer remembering automatically saves eligible candidate edits locally only after opt-in, with disable/delete controls. Session storage retains tab activation, AI consent and application-link/redirect metadata. The full profile and CV are not persisted in extension storage.
```

- `downloads`:

```
Lets the candidate save their own current JOBSAGE CV only when an employer form does not expose a compatible CV upload field. The download is initiated from the visible JOBSAGE helper and is never used to download browsing data.
```

- Host permission `https://*/*`:

```
Employer/ATS domains and redirect destinations cannot be listed in advance. HTTPS access supports form detection, current-tab messaging and application correlation through redirects/new tabs. AI mapping/drafting requires affirmative consent before application context and selected professional facts go through JOBSAGE/Replit/OpenAI. Filled fields and CV attachments are available to employer scripts before final submission.
```

- All-HTTPS content-script use:

```
The content script supports employer/ATS domains that cannot be listed in advance. The helper activates for a JOBSAGE-tracked application or an extension-icon action, handles relevant form/job context, and asks for affirmative consent before AI processing. The JOBSAGE-origin bridge correlates selected application links without mounting the employer helper on JOBSAGE pages.
```

- `webNavigation`:

```
Carries the exact application URL selected from a JOBSAGE opportunity through employer-site redirects, so the candidate can return to the correct role and save it in their tracker. It does not collect a general browsing history.
```

No `tabs` justification is needed: it is not requested by 0.4.22.

**Remote code:** No, I am not using remote code. All executable extension JavaScript is bundled. Google Fonts CSS/fonts and API data/text are remote resources, not remotely executed extension code.

**Data usage disclosures:** use the final category-by-category table in
`PRIVACY-ANSWERS.md`, including local handling and complete CV transfers.

**Third-party processing:** disclose consent-gated selected professional facts
and application context through Replit/OpenAI, Google Fonts request metadata
and pre-submission employer access. No automatic raw-CV/private-note inclusion
in extension AI prompts. Do not claim "no sharing".

Only certify the three Limited Use statements after the owner confirms the
provider and operational facts listed in `PRIVACY-ANSWERS.md`.

## Graphic assets

- **Screenshots (required, 1–5):** three 1280×800 PNGs are included in `store/screenshots/`. They use clearly marked synthetic demo data: (1) the assistant on a supported application form, (2) reviewing an AI-drafted application answer, and (3) the JOBSAGE tracker.
- **Small promo tile (optional):** 440×280.
- **Marquee promo (optional):** 1400×560.
- Store icon 128×128 is already in the package (`icons/icon128.png`) and is uploaded automatically with the zip.
