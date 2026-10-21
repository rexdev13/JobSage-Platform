# JOBSAGE Smart Apply — Privacy answers for 0.4.23

Prepared locally on 21 October 2026. Nothing in this guide means the website has
been published, a dashboard ZIP uploaded, or the item submitted.

## Package and release boundary

- Store ZIP: `artifacts/chrome-extension/release/jobsage-smart-apply-extension-v0.4.23.zip`
- Matching website source: `artifacts/jobsage-web/public/jobsage-smart-apply-extension.zip`
- Manifest version: **0.4.23**
- Permissions: `cookies`, `storage`, `webNavigation`, `downloads`
- Host/content-script access: `https://*/*`
- Production API: `https://jobsage.co.uk/api`
- No separate `tabs` permission; tab query, messaging, activation and navigation
  remain supported through the retained APIs and HTTPS host access.
- Backend, `/privacy`, `/extension-privacy`, and download changes must be
  published together **before** distributing this ZIP: its AI routes are new.

## Ready-to-paste Privacy fields

### Single purpose

```text
Help JOBSAGE candidates complete employer job application forms using their saved profile and optional AI assistance, attach their CV, and record the same applications in their JOBSAGE tracker.
```

### Privacy policy URL

```text
https://jobsage.co.uk/extension-privacy
```

### cookies justification

```text
Read the candidate's existing JOBSAGE session cookie on jobsage.co.uk to authenticate profile retrieval, CV retrieval and application-tracker requests. The extension does not read employer-site cookies or store the JOBSAGE credential in extension storage.
```

### storage justification

```text
Store helper preferences and dismissed hostnames; retain tab activation and application-link/redirect context in browser-session storage. Answer remembering is off until the candidate enables it. While enabled, eligible candidate edits are saved automatically in this browser with question, hostname/path, employer scope and usage metadata for reuse. Disable stops saving/reuse; individual and Delete all controls erase answers. The full profile and CV are not persisted in extension storage.
```

### webNavigation justification

```text
Associate the exact application link selected in JOBSAGE with the correct employer tab through same-tab redirects and newly opened tabs, so the helper activates on that application and tracker records retain the selected role. Navigation metadata is used for that application correlation, not to build an unrelated browsing-history database.
```

### downloads justification

```text
Let the candidate save their own current JOBSAGE CV through Chrome's Save As flow when the employer page has no compatible CV upload control. The visible helper initiates this fallback; it does not download unrelated browsing data or read arbitrary local files.
```

### HTTPS host access / content-script justification

```text
Employer and applicant-tracking-system domains and redirect destinations cannot be listed in advance. HTTPS access lets the extension recognise supported forms, communicate with the active employer tab, and follow a JOBSAGE-selected application across redirects/new tabs. The helper is activated by a tracked JOBSAGE application or the candidate's extension-icon action. It reads relevant application labels, options, supported values and role context. JOBSAGE API requests use HTTPS. For AI mapping/drafting, selected professional facts and application context are processed by OpenAI through Replit AI Integrations. Filled fields and attached CVs are available to employer-site scripts before final submission.
```

There is **no `tabs` justification** for this release because that permission
has been removed from the actual manifest.

### Remote code

Select **No, I am not using remote code.**

```text
All executable extension JavaScript is included in the uploaded package. Remote responses are profile/CV data, structured mappings or generated answer text, not executable code, and are not evaluated as code. The helper requests Google Fonts CSS/font resources; these are not remotely hosted JavaScript or WebAssembly.
```

### Third-party/data-use explanation, if a reviewer requests one

```text
The extension authenticates to JOBSAGE over HTTPS. JOBSAGE sends application questions, field labels/options, job context, saved application facts and filtered CV evidence to OpenAI through Replit AI Integrations for mapping and drafting. Private profile notes are excluded. Common sensitive disclosure lines and personal email addresses are filtered from CV text, but complete redaction is not guaranteed. Contact and eligibility facts may support exact saved answers; the login email is not used as the employer contact address. Sensitive disclosures and declarations remain candidate-controlled. Answer remembering is a separate, default-off choice and, while enabled, automatically stores eligible candidate edits locally with application source metadata. Google Fonts requests disclose normal request metadata such as IP address, browser headers and a referrer permitted by the employer page. Entering data or attaching a CV exposes it to the employer site and its scripts immediately; the site may autosave or upload it before final submission.
```

## Data-category selections

Google's User Data FAQ explicitly includes local-only processing/storage and
cloud-file access. These choices describe what the **retained flows handle**,
not just what goes to OpenAI. No category is selected solely because the
manifest has broad HTTPS access.

| Category | Select | Actual handling in the corrected release |
| --- | --- | --- |
| Personally identifiable information | Yes | Retrieves and fills candidate names, JOBSAGE alias, telephone and address/profile facts; retrieves the candidate's full CV file. |
| Health information | Yes | The complete, unredacted CV is retrieved and attached/downloaded. It can contain the candidate's medical history. Candidate-authored free text is also supported; heuristic content checks cannot establish a categorical exclusion. Dedicated health controls are checked locally for completion but never remembered or AI-filled. CV evidence is filtered for common sensitive disclosures before AI processing; complete redaction is not guaranteed. |
| Financial and payment information | Yes | The same complete-file CV flow and candidate-authored free text have no verified content-level exclusion of financial information. There is no payment-card, account-balance or banking feature. Dedicated financial controls are excluded and obvious financial text is blocked; that is not proof of zero handling in full files/free text. |
| Authentication information | Yes | Reads the JOBSAGE session cookie and uses it as a bearer credential for JOBSAGE API requests. No employer passwords are collected. |
| Personal communications | Yes | Candidate-authored requests and generated application-answer text are handled by the AI assistant. This does **not** mean the extension reads email, SMS or other sites' chat histories. |
| Location | Yes | Candidate city/postcode/country can be retrieved and filled; network services receive IP/request metadata. No GPS or continuous location tracking is implemented. |
| Web history | Yes | Application URLs, redirect/new-tab correlation metadata, dismissed hostnames and local answer source paths are handled. Not a comprehensive browsing-history database. |
| User activity | Yes | Relevant form input/change/blur events, helper actions, local answer-use metadata and submission-confirmation signals are handled. No general keylogger or advertising analytics is present. |
| Website content | Yes | Reads application labels/options, relevant job descriptions, supported values and hyperlinks; writes approved/profile answers to employer fields. |

**Why health/financial are not unchecked:** removing unnecessary field reads
and raw-CV-to-AI processing reduces exposure, but preserving full CV attachment
and free-text assistance leaves real, unredacted content paths. The release does
not contain a verified general-purpose sensitive-data redactor. Declaring zero
handling would overstate the fix. This is a flow-specific rationale, not a
blanket "select all to be safe" rule. Do not describe healthcare profession,
registration status or years of work by themselves as the candidate's health.

Use **application functionality** as the purpose where the dashboard asks.
AI processing is a service-provider transfer, not a claim of "no sharing".

## Limited Use certifications — owner confirmation required

The dashboard statements are:

1. Not sold to third parties outside approved use cases.
2. Not used or transferred for purposes unrelated to the extension's core functionality.
3. Not used or transferred for creditworthiness or lending.

The inspected extension has no sale, advertising, lending or credit-scoring
integration. However these are publisher-wide attestations, not facts that can
be established from extension source alone. Confirm the operational/provider
facts below before checking them. Do not certify an unverified policy promise.

## Genuinely unresolved facts

- Applicable Replit/OpenAI contract, prompt/output retention, abuse-monitoring
  retention, training/secondary-use terms and deletion arrangements. An API
  request or model name does not prove a zero-retention or no-training contract.
- Which people actually have access to extension-derived account/tracker data,
  request logs and support material, and whether access/transfers stay within
  Chrome's Limited Use exceptions. The general service policy's broad
  recruitment/support access cannot alone establish that restriction.
- Actual account/log/backup/provider erasure procedures and timelines. No new
  retention period or technical enforcement claim was invented.
- Ownership and monitoring of the publisher contact email and public policy
  contact mailbox. Source text cannot establish mailbox control.
- Current dashboard-uploaded package/version, publisher email verification and
  any review notes. No dashboard action was taken in this work.

These are release/attestation checks, not a request to disclose credentials.

## Exact publication and upload sequence (not performed)

1. Confirm the facts above and resolve any mismatch between operations and the
   Limited Use commitments. Keep the policy truthful.
2. In Replit open **Publishing**, inspect the existing production target/custom
   domain, then use **Publish/Republish** to publish this project's corrected
   API, web policies and website ZIP together. Do not create a second production
   app or upload the extension to Chrome first.
3. In a signed-out/private browser open `https://jobsage.co.uk/privacy` and
   `https://jobsage.co.uk/extension-privacy`. Confirm the latter says **21 October
   2026**, explains Replit/OpenAI, filtered CV evidence, Fonts, automatic opt-in memory,
   unredacted CV handling and pre-submission employer access.
4. Download `https://jobsage.co.uk/jobsage-smart-apply-extension.zip` afresh
   (avoid a cached browser download). Inspect its `manifest.json`: **0.4.23**,
   the four listed permissions, no `tabs`; compare SHA-256 with the local
   release ZIP. Do not claim the public artifact matches until this succeeds.
5. Confirm the new authenticated API routes exist and the installed extension
   can fill supported fields without an AI-consent modal using a synthetic
   candidate. Do not send real applications or use customer information.
6. Open `https://chrome.google.com/webstore/devconsole` under the correct
   publisher. Choose the existing **JOBSAGE Smart Apply** item, **Package →
   Upload new package**, and select the exact versioned release ZIP above.
   Confirm the dashboard shows **0.4.22**, not an older package.
7. Fill **Privacy practices** using these answers/categories; set the public
   policy URL. Confirm Limited Use attestations only after owner verification.
   Check listing/screenshots/distribution and provide safe reviewer test
   instructions if requested.
8. Save the dashboard draft. A later, separate owner decision can choose
   **Submit for review**. No submission or automatic publication was authorised.

## Publisher contact-email reminder

In Developer Dashboard open **Account** in the left menu → **Contact email**.
Use **Add email** if missing, or **Verify email** if unverified. Open the
verification link delivered to that mailbox, return to **Account**, and confirm
the address is verified. This is distinct from the Google sign-in email and
store-update notification settings. Check spam and mailbox access if the link
does not arrive. Verification cannot be completed by editing project files.

## Official references

- [Privacy practices fields and remote code](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ — includes local processing](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Publisher account and contact-email verification](https://developer.chrome.com/docs/webstore/set-up-account#verify-contact-email)
