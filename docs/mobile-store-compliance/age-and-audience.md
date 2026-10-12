# JOBSAGE audience and age-gate record

Status: **18+ product audience is owner-confirmed; store declarations still need review.**

## Confirmed product facts

- JOBSAGE is intended for adults aged **18 and over**.
- Candidate and employer registration both display a separate “I am 18 or older” confirmation.
- Both account-creation API routes independently require `ageConfirmed === true`; otherwise they return an age-confirmation error.
- This is user self-attestation only. The registration gate does not collect a date of birth and does not verify identity or age.
- No child-directed feature, child account type, parental consent flow or age-verification provider was identified in the reviewed registration flow.

## Store form handling

Do not describe the self-attestation as verified age. Answer each store's audience/content-rating questionnaire from the actual shipped feature set, including user messaging, user profiles, public vacancy content, AI-generated career/application guidance and employer-posted job content. The owner/legal reviewer must confirm any market-specific age rule and the final rating.

## Evidence and limits

- `artifacts/jobsage-web/src/pages/RegisterPage.tsx`
- `artifacts/jobsage-web/src/pages/employer/EmployerRegisterPage.tsx`
- `artifacts/api-server/src/routes/auth.ts` (`/auth/register`, `/auth/employer-register`)
- `artifacts/api-server/src/__tests__/routes/auth.test.ts` verifies the server rejects missing or non-boolean age confirmation.

This record does not replace the Apple age-rating or Google Play target-audience/content-rating forms. Neither has been submitted.
