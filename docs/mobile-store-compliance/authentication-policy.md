# Store authentication-method review

Status: **current method inventoried; final store review remains open.**

## Current methods found

- Candidate and employer accounts use JOBSAGE-managed email/password registration and sign-in; new candidate accounts require email verification.
- Registration requires server-enforced 18+ self-attestation.
- The reviewed login page has no Google, Facebook or other third-party sign-in button.
- Google OAuth scopes (`openid`, `email`, Calendar) belong to an optional marketer-only scheduling connection; this is not a user sign-in option.
- Native authentication uses the first-party secure mobile-session exchange; the password is not exposed to employer websites or external application destinations.

## Apple and Google review

Apple Guideline 4.8 is conditionally relevant when an app uses a third-party/social login service as the primary account sign-in; the current source does not show one. Re-audit if social sign-in is added. The optional staff calendar OAuth flow is not itself the consumer account login choice.

Google Play login/app-access instructions must provide a working reviewer path for every in-scope role or gated area. No reviewer credentials, test accounts or staff-role access are invented here; the store owner must provision restricted test accounts through the approved account process and avoid sending secrets in source or this document.

## Not proven

Native account creation/login parity, verification/reset links, passwordless reauthentication, role-specific review access, account switching and physical-device sign-out/session isolation have not received full end-to-end acceptance. In particular, the native session exchange is not proof of the recent reauthentication needed for deletion.
