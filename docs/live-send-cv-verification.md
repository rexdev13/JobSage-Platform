# Live Send CV verification

This guide proves the complete path with the deterministic `Test JobSage Email`
records. It does not require or print any Resend credential.

## 1. Check outbound configuration

The API logs a safe status line on startup:

- Ready: `Resend outbound email configured; approved sender ...`
- Not ready: `CRITICAL: outbound email is not ready — ...`

The diagnostic only reports whether `RESEND_API_KEY` is present and whether
`EMAIL_FROM` is a valid address. In production, Send CV fails and records a
failed delivery when either requirement is missing. The approved sender must
be a Resend-verified address, normally `noreply@jobsage.co.uk` or the value of
`EMAIL_FROM`. The candidate alias is never used as `From`.

The account owner must still verify the sender domain/address in Resend and
ensure its DNS requirements are complete. This cannot be configured from the
codebase.

## 2. Seed the proof sponsor and role

Use the candidate's normal login email to seed the persisted score used by the
real Opportunities ranking:

```sh
pnpm --filter @workspace/api-server run seed:test-email-vacancy -- \
  --candidate-email candidate@example.com
```

Alternatively, use a known user ID:

```sh
pnpm --filter @workspace/api-server run seed:test-email-vacancy -- \
  --candidate-user-id <candidate-user-id>
```

The command is safe to rerun. It updates the existing exact-name records
instead of inserting a second sponsor or role. It prints the sponsor ID, role
ID, London/NMC/live details, and whether a candidate score was persisted. The
recipient is the non-secret proof inbox `ifeo55394@gmail.com`.

Passing a candidate is important: the feed's actual ranking uses persisted
candidate scores before the normal `linkVerified`, eligibility, and role-ID
tie-breakers. The seed writes score `100` for the supplied candidate; it does
not add a special ranking exception or rely on `importedAt`.

## 3. Candidate UI proof

1. Open the deployed JOBSAGE site and sign in with the candidate login used in
   the seed command.
2. Open **Opportunities**.
3. Use the candidate's NMC/healthcare profile and London preference (or leave
   region preferences open). Confirm **Test JobSage Email** is at the top of
   the matching Opportunities grouping and shows the live/verified action.
4. Open that role and click **Send CV**. Select the candidate's PDF CV if the
   dialog asks, then submit.
5. Open **Application Tracker** and confirm the record shows **delivered** (not
   pending or failed). The response and tracker should retain the role title
   and the direct recipient route.
6. Check `ifeo55394@gmail.com`. Confirm the message has:
   - `From: JOBSAGE <noreply@jobsage.co.uk>` or the configured verified
     `EMAIL_FROM` address;
   - `Reply-To` set to the candidate's canonical JOBSAGE alias;
   - the candidate CV PDF attached (and the optional cover-letter PDF when
     selected);
   - `Test JobSage Email` in the subject/body and the candidate's alias in the
     employer contact instructions.

If the API returns a failed delivery, inspect the stored delivery error and
the startup configuration line first. A Resend provider rejection is persisted
as `failed`, never reported as delivered, and does not create a false candidate
inbox confirmation.