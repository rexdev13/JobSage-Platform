# Chrome Web Store submission guide — JOBSAGE Smart Apply

**Current local release: 0.4.22.** Final paste-ready Privacy answers, category
reasons, operational confirmations and exact publication/upload sequence are
in [`store/PRIVACY-ANSWERS.md`](store/PRIVACY-ANSWERS.md).
No publication, dashboard upload or submission has been performed.

## Prepared for upload

- **Store package:** `release/jobsage-smart-apply-extension-v0.4.21.zip`
- **Listing copy and permission/data-use text:** `store/LISTING.md`
- **Screenshots:** three 1280×800 PNGs in `store/screenshots/`; each uses synthetic demo data.
- **Privacy policy:** `https://jobsage.co.uk/extension-privacy`
- **Production-only build:** `pnpm --filter jobsage-chrome-extension run package`

The package command builds with the development environment selector and Replit origin disabled, checks the generated bundle and manifest for development-only settings, creates the Chrome Web Store ZIP, and refreshes the website's direct-download ZIP.

## Before uploading

1. Confirm `https://jobsage.co.uk/extension-privacy` is live and includes the OpenAI processing disclosure for requested AI features.
2. Upload all three screenshots and check that their synthetic-data label is visible.
3. In the Privacy tab, disclose the exact application-flow URL handling under **Web history**, and disclose the limited OpenAI processing described in `store/LISTING.md`. Do not state that no data is shared with third parties.
4. Keep the broad HTTPS host-access justification with the listing: employer application forms and redirect destinations cannot be enumerated in advance.

## Step 1 — Developer account

1. Sign in to the Chrome Web Store Developer Dashboard with the account that should own the extension.
2. Complete the developer agreement and account registration.
3. Verify the contact email and set the publisher name to **JOBSAGE**.
4. Verify `jobsage.co.uk` as a publisher domain if available for the account.

## Step 2 — Upload the package

1. Create a new item and upload `release/jobsage-smart-apply-extension-v0.4.21.zip`.
2. Confirm the dashboard shows **JOBSAGE Smart Apply**, version **0.4.22**, and the expected permissions (no separate `tabs`).
3. Do not upload `dist/` as a folder or the website's direct-download ZIP.

## Step 3 — Complete the listing

Use `store/LISTING.md` for the copy-ready fields:

- **Store listing:** name, short and detailed descriptions, category, and language.
- **Graphic assets:** upload the three screenshots from `store/screenshots/`.
- **Privacy:** single-purpose description, policy URL, every permission justification, data-use disclosures, third-party processing, and the no-remote-code declaration.
- **Distribution:** choose the desired visibility and regions.

The extension requests `cookies`, `storage`, `webNavigation`, `tabs`, and `downloads`, and uses broad HTTPS access for employer application flows. Each permission has a justification in the listing file.

## Step 4 — Submit for review

Review times vary. Broad HTTPS access can receive additional scrutiny. Explain application-flow correlation, affirmative consent before AI mapping/drafting, selected professional facts through Replit/OpenAI, Google Fonts metadata, default-off automatic local answer remembering, and employer access on field fill/CV attachment before submission. Extension AI no longer automatically receives raw CV text or private notes.

After the listing is approved and its URL is available, set the public `VITE_CHROME_WEB_STORE_URL` build variable for the JOBSAGE web app and republish it. The install prompt will then show the Chrome Web Store button while keeping the manual ZIP install as a fallback.

## If a reviewer asks for changes

- **Broad host access:** use the host and content-script justifications in `store/LISTING.md`; do not claim that no data is shared with service providers.
- **Third-party data use:** use the explanation in `store/PRIVACY-ANSWERS.md`; both automatic mapping and requested drafting require affirmative AI consent.
- **Privacy policy:** provide `https://jobsage.co.uk/extension-privacy`.
- **Permission minimization:** `tabs` has been removed; four purpose-specific permissions and HTTPS host access remain. Reassess retained permissions only against actual API dependencies.

## Publishing updates

1. Increase the `version` in `manifest.json`.
2. Run `pnpm --filter jobsage-chrome-extension run package`.
3. Upload the newly generated versioned ZIP from `release/` in the Developer Dashboard.
4. Re-check listing disclosures and screenshots if the feature behavior or data handling changed.

## Current behavior in v0.4.22

- The store build connects only to `https://jobsage.co.uk`; it does not include the development selector or a Replit development origin.
- The extension reads the JOBSAGE session cookie only on `jobsage.co.uk`.
- Form detection runs locally. The helper fills only supported fields; candidates review answers and complete sensitive or personal declarations themselves.
- The helper opens automatically for a tracked application started from JOBSAGE. On an untracked employer page, the candidate clicks the extension icon and chooses **Use JOBSAGE on this page**.
- Application URLs are carried through employer redirects only when the flow starts from a JOBSAGE-selected link.
- AI answer drafting is candidate-requested. Both drafting and automatic structured mapping require affirmative consent before JOBSAGE sends application context and selected professional profile facts through Replit/OpenAI. Raw CV text and private notes are excluded from this extension AI flow.
- The CV is retrieved from the authenticated JOBSAGE API, attached only to a matching CV/resumé file input, and otherwise offered as a download.

The local website source now contains the matching ZIP. The public manual
download is unchanged until the owner republishes and verifies it. Publish the
new backend routes, both policies and download together before distributing
0.4.22. After store approval, the store installation URL can be configured
separately; do not invent a listing URL.
