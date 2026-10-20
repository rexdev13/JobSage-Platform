# Local release verification — JOBSAGE Smart Apply 0.4.22

Prepared 20 October 2026. No production publication, Chrome dashboard upload,
store submission or real employer application was performed.

## Final package

- Store ZIP: `artifacts/chrome-extension/release/jobsage-smart-apply-extension-v0.4.22.zip`
- Website source ZIP: `artifacts/jobsage-web/public/jobsage-smart-apply-extension.zip`
- Both files: **165,926 bytes**, byte-for-byte identical.
- SHA-256:
  `d103d71ccfc65f57d10ed5579c8d3cfd841bd962c578ceddd7b3424d00e5a438`
- ZIP integrity checked; every packaged entry matches the final `dist` output.
- Actual manifest: MV3, version 0.4.22, four permissions (`cookies`, `storage`,
  `webNavigation`, `downloads`), HTTPS host/content-script access, no `tabs`.
- Packaged environment resolves to `https://jobsage.co.uk/api`; no Replit
  development host or working development selector is included.
- No source maps or dependencies directory in the archive. Inspected packaged
  JavaScript and popup HTML: executable files are local; no remote dynamic import,
  remote `importScripts`, `eval` or `new Function` pattern was found.
- External resources include Google Fonts CSS/fonts, not executable extension
  code. API responses are data/text, not executed scripts.
- Detailed machine inspection:
  `generated-artifacts/extension-privacy-verification/package-inspection.json`.

## Checks actually run

1. OpenAPI generation and shared-library TypeScript build.
2. Extension, API server and JOBSAGE web app type checks: all passed.
3. Final extension Vitest suite: **146 tests in 19 files passed**.
4. Smart Apply API route Vitest suite: **17 tests passed**. Uses synthetic
   sessions, database/provider/storage mocks, not real candidate data.
5. Actual background module with a mocked Chrome API: tests cover trusted
   same/new-tab navigation correlation, redirects, unrelated destinations,
   cleanup, tab/site consent isolation, no-consent structured/streaming requests,
   API bypass rejection and withdrawal.
6. Backend route tests include authentication requirements, consent rejection,
   sensitive-text rejection and exclusion of raw CV/private notes from the
   extension mapping provider payload.
7. Sensitive field getter tests throw if a completion check reads health/bank/
   card/disability values; all pass. Content guard tests distinguish professional
   healthcare experience from personal medical disclosures.
8. One isolated Playwright pass using the actual version 0.4.22 content bundle
   and a mocked Chrome bridge on a locally fulfilled synthetic HTTPS page:
   - tracked activation and basic profile fill;
   - consent prompt before mapping, refusal with zero AI request, retry/acceptance;
   - streamed sample answer and insertion;
   - withdrawal then refusal prevents another sample AI stream;
   - default-off memory, opt-in automatic capture, disable prevents update,
     confirmed Delete all;
   - CV-specific file attachment and no-input download fallback;
   - synthetic application logging success;
   - manual content activation via message listener;
   - unsupported page remains usable without helper injection.
   All external extension-journey network requests were blocked, including
   Google Fonts. Browser report and fixture:
   `generated-artifacts/extension-privacy-verification/run-record.md`.
9. Development API/web workflows restarted and confirmed running; schema-drift
   startup check passed. Development external jobs and email delivery were off.
10. Public-in-preview `/extension-privacy` inspected in a browser and screenshot,
    showing 20 October 2026 wording. This was the development preview, not the
    production domain.

The final archive was rebuilt after the browser pass; final unit/type checks
cover the tightened scraper, sensitive-text safeguards and wording changes.

## Limits — do not overstate

- No installed Chrome extension or Chrome Web Store review was exercised.
  Popup-to-content manual activation was mocked, not a real popup click.
- Navigation/redirect/new-tab behavior was checked in background-unit harnesses,
  not against live employer systems.
- No live JOBSAGE sign-in, real cookie exchange, real CV object retrieval,
  real OpenAI call or employer submission was performed.
- The browser test does not independently validate background/backend consent
  enforcement; separate unit/route tests cover those boundaries.
- Regex safeguards are not a proven redactor. Full CV files remain unredacted,
  and candidate-authored free text remains supported. Health/financial handling
  cannot be categorically denied in the Privacy answers.
- Provider terms, real staff access, retention operations, mailbox control and
  dashboard state remain owner-confirmation gates.
- Public policy/download were not changed by this work. Publish and verify
  them before distributing the ZIP; the new extension AI endpoints require the
  corrected backend release.

Final paste-ready fields and upload steps:
[`PRIVACY-ANSWERS.md`](PRIVACY-ANSWERS.md).
