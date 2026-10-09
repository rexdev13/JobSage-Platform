# Inbound Email Setup — `mail.jobsage.co.uk`

This document describes the one-time DNS and Resend configuration required to route
employer reply emails into the JOBSAGE platform inbox.

---

## How it works

1. When a candidate sends a speculative CV, the email is sent **from** their unique
   JOBSAGE alias (e.g. `john.smith.a1b2c3@mail.jobsage.co.uk`).
2. The employer's reply goes back **to** that alias.
3. Resend receives the inbound email (via MX records pointing at Resend's servers),
   then POSTs an `email.received` metadata event to our webhook endpoint.
4. The API retrieves full content and attachments from Resend's Receiving API.
5. The webhook resolves the alias → candidate, stores the message in the inbox,
   advances the speculative application status, and notifies the candidate.

---

## Step 1 — Resend domain setup

1. Log into the [Resend dashboard](https://resend.com/domains).
2. Click **Add Domain** and enter `mail.jobsage.co.uk`.
3. Choose **Inbound** as the domain purpose (or enable inbound after adding the domain).
4. Resend will show you the DNS records to add (SPF, DKIM, and MX).

---

## Step 2 — DNS records for `mail.jobsage.co.uk`

Add the following DNS records to your DNS provider for the subdomain `mail.jobsage.co.uk`:

### MX record (route inbound mail to Resend)
| Type | Name              | Value                     | Priority |
|------|-------------------|---------------------------|----------|
| MX   | mail.jobsage.co.uk  | inbound.resend.com        | 10       |

### SPF record (allow Resend to send outbound on your behalf)
| Type | Name              | Value                                              |
|------|-------------------|----------------------------------------------------|
| TXT  | mail.jobsage.co.uk  | v=spf1 include:_spf.resend.com ~all               |

### DKIM record (domain key for signing — Resend provides the value)
Resend generates a unique DKIM key per domain. Copy the TXT record value from the
Resend dashboard after adding the domain.

> **Note:** DNS propagation can take up to 48 hours. Resend will verify the domain
> once propagation is complete.

---

## Step 3 — Configure the inbound webhook in Resend

1. In the Resend dashboard, go to **Webhooks** → **Add Endpoint**.
2. Set the URL to:
   ```
   https://jobsage.co.uk/api/webhooks/inbound-email
   ```
3. Under **Events**, select `email.received`.
4. Copy the **Signing Secret** that Resend displays — it starts with `whsec_`.

---

## Step 4 — Set environment variables

Set the following environment variable in the JOBSAGE API server:

```
INBOUND_EMAIL_WEBHOOK_SECRET=whsec_<your-signing-secret-from-resend>
```

### How signature verification works

Resend uses [Svix](https://svix.com/) to sign webhook deliveries. Every inbound
request includes three HTTP headers:

| Header | Purpose |
|--------|---------|
| `svix-id` | Unique message ID |
| `svix-timestamp` | Unix timestamp of delivery |
| `svix-signature` | HMAC-SHA256 signature (`v1,<base64>`) |

The endpoint uses the official `svix` npm package to verify the signature against
your `INBOUND_EMAIL_WEBHOOK_SECRET` before processing any payload. Requests with
an invalid or missing signature are rejected with HTTP 401.

> **Production requirement:** `INBOUND_EMAIL_WEBHOOK_SECRET` **must** be set in
> production. The server will hard-reject all webhook requests (401) if the secret
> is missing in a production environment.
>
> **Development / testing:** If the secret is not set and `NODE_ENV` is not
> `production`, verification is skipped with a console warning. Never run without
> the secret in production.

---

## Step 5 — Test the integration

For candidate-alias replies, use the controlled local/staging runner below. A
current Resend delivery contains metadata and an `email_id`, not the full body;
the application fetches message content from Resend's Receiving API. Do not
paste a real message or signing secret into a shell command.

---

## Repeatable inbound employer-reply smoke test

The repository includes a non-mutating-fixture end-to-end runner at
`scripts/test-inbound-reply.ts`. It resolves the existing **john dev** candidate,
  requires the exact alias `john.dev.8b8431@mail.jobsage.co.uk`, posts a fixed
interview invitation from the test employer, and verifies both the durable inbox
message and the linked speculative-application status.

### Safe prerequisites

- Run against a local or staging API and database only. Do not point this test
  at production unless the single-use test fixture has been deliberately
  provisioned there.
- `DATABASE_URL` must point to the database containing the existing `john dev`
  candidate and exactly one open `Test JobSage Email` speculative application
  whose employer recipient is `ifeo55394@gmail.com` (or whose company name is
  `Test JobSage Email`).
- `API_BASE_URL` (or `INBOUND_EMAIL_API_URL`) must be the API origin, for
  example `http://localhost:5000`; the runner adds
  `/api/webhooks/inbound-email`.
- Set `NODE_ENV=development` or `NODE_ENV=test` when intentionally using the
  API's unsigned non-production bypass. When
  `INBOUND_EMAIL_WEBHOOK_SECRET` is set, the runner generates valid Svix
  `svix-id`, `svix-timestamp`, and HMAC signature headers without printing the
  secret or signature.
- The fixed external message ID is single-use because the webhook deduplicates
  it. The runner checks this before posting and never deletes an existing test
  row or changes fixtures to make the test pass.

Run it from the repository root:

```bash
API_BASE_URL=http://localhost:5000 \
NODE_ENV=development \
pnpm --filter @workspace/scripts test:inbound-reply
```

The command exits non-zero for missing fixtures, a reused message ID, a failed
HTTP response, malformed JSON, or any durable-state assertion. A successful
run prints only the API URL, non-secret row IDs, the application status
transition, and the fixed test alias/message ID. Example:

```text
PASS: inbound employer reply end-to-end smoke test
  API: http://localhost:5000/api/webhooks/inbound-email
  Candidate: john dev (candidate-id), alias john.dev.8b8431@mail.jobsage.co.uk
  Application: #42 (Test JobSage Email)
  Status: cv_sent -> interview_invited
  Inbox message: #99, external ID <inbound-e2e-test@testhospital.nhs.uk>
  HTTP: 200, ok=true, category=interview_invited
```

After a pass, sign in as **john dev**, open `/inbox`, and inspect the
**Test JobSage Email Recruitment** reply. Then open `/applications` and confirm the
**Interview Invited** badge. To run the scenario again, provision a new
controlled fixture and update the fixed message ID in the script; do not delete
the previous message to bypass webhook deduplication.

---

## Webhook payload format

Current Resend `email.received` webhooks contain email metadata and an
`email_id`. The application retrieves the message body and attachments through
the Receiving API:

```json
{
  "type": "email.received",
  "created_at": "2026-10-09T12:00:00.000Z",
  "data": {
    "from": "Sender Name <sender@company.com>",
    "to": ["alias@mail.jobsage.co.uk"],
    "received_for": ["alias@mail.jobsage.co.uk"],
    "subject": "Re: ...",
    "message_id": "<msg-id@company.com>",
    "email_id": "received-email-id",
    "attachments": [
      {
        "id": "attachment-id",
        "filename": "document.pdf",
        "content_type": "application/pdf"
      }
    ]
  }
}
```

The handler continues to accept the legacy `email.inbound_received` shape for
the existing controlled smoke test, but production Resend webhooks should use
`email.received`.

---

## Auto status classification

The webhook classifies each reply using keyword matching:

| Category          | Status set on application | Example keywords                        |
|-------------------|---------------------------|-----------------------------------------|
| `interview_invited` | `interview_invited`     | "interview", "schedule", "invite"       |
| `offer`           | `offer`                   | "pleased to offer", "job offer"         |
| `rejected`        | `rejected`                | "unfortunately", "not successful"       |
| `acknowledged`    | `acknowledged`            | (any other reply)                       |

Status is only advanced — a reply cannot move an application backward (except
`rejected` which always takes effect as a final state).

---

## Safety features

- **No-reply/automated senders** are silently ignored (no feedback loops).
- **Unknown aliases** (no matching candidate) return HTTP 200 to prevent Resend retries.
- **Duplicate candidate-reply deliveries** are deduplicated using the original
  message ID. Developer-mail forwards use the Resend send API idempotency key
  derived from the immutable received-email ID.
- **Rate limiting** caps inbound processing at 20 emails per minute per sender.
- The endpoint returns HTTP 200 for all "safe skip" cases so Resend does not retry.

---

## Developer verification mailbox forwarding

The API server forwards mail addressed exactly to `developer@jobsage.co.uk` to
the destination in `INBOUND_EMAIL_FORWARD_TO`. The destination is configuration,
not a source-code constant. If it is missing or invalid, the webhook returns a
retryable error instead of silently discarding the message.

Forwarding uses the Resend Receiving API to retain the original sender, recipient,
date, subject, message body, reply address, and attachments. The outbound message
uses JOBSAGE's configured Resend sender; the original sender details are shown in
the forwarded message. Attachments are downloaded from Resend's signed attachment
URLs and attached individually. Logs include only provider message IDs and
failure stage/status, never message content, sender, recipient, or attachment
names.

Set `INBOUND_EMAIL_FORWARD_TO` in the API server's environment to the intended
Gmail address. Configure the value in both the development environment and the
published app's Production environment if both need forwarding. Production
environment changes take effect only after publishing a new app version.

### Read-only configuration check

The last read-only check found `jobsage.co.uk` verified in Resend with its
Receiving MX record verified in `eu-west-1`. Public DNS currently returns that
same root MX record (`inbound-smtp.eu-west-1.amazonaws.com`, priority 10).
Resend already has an `email.received` webhook at
`https://jobsage.co.uk/api/webhooks/inbound-email`; the signing secret matched
the inspected workspace environment without exposing either secret value.

The existing `mail.jobsage.co.uk` MX record was left untouched. Its public MX
currently points to `inbound.resend.com`. No DNS records were changed. Resend's
public pricing currently lists inbound email on the Free plan, though the
account's active billing plan was not inspected. This read-only check and local
mocked tests are not proof of end-to-end delivery; a real received-and-forwarded
message has not been tested.

---

## Authenticated staging smoke test: Send CV direct-contact loop

Run this checklist after changing Send CV delivery, Resend, inbound DNS, or webhook
configuration. Use a staging candidate account and controlled mailboxes; do not use
a real candidate CV or an uncontrolled employer address.

### Preconditions

- Staging is configured with its own authenticated candidate account.
- The candidate has a real PDF CV in Documents.
- Company A has a stored sponsor contact, employer-profile contact, or registered
  employer-account email pointing to a controlled employer mailbox.
- Company B has no stored direct contact and therefore resolves only to the
  operations fallback mailbox.
- The controlled employer mailbox can reply to the candidate's generated
  `@mail.jobsage.co.uk` alias.
- Resend sending-domain DNS, inbound-domain MX records, `RESEND_API_KEY`, and
  `INBOUND_EMAIL_WEBHOOK_SECRET` are configured for staging. Record any
  infrastructure changes separately from application-code results.

### Direct send and attachment

1. Sign in as the staging candidate and open Opportunities.
2. Confirm Company A shows **Send CV** on an eligible vacancy and appears in the
   Send CV tab.
3. Send the selected PDF from the vacancy card.
4. Confirm the normal Apply/Smart Apply action is still available on that vacancy.
5. In the controlled employer mailbox, verify:
   - exactly one message arrives;
   - the recipient is the controlled direct employer address, not operations;
   - the selected PDF opens successfully;
   - subject/body content identify the expected candidate, company, and vacancy;
   - Reply-To is the candidate's generated JOBSAGE alias.
6. In the candidate tracker, confirm the vacancy-linked record contains the
   expected role/reference, `deliveryStatus=delivered`, `emailSent=true`, the
   actual recipient, the direct delivery route, PDF attachment type, and one
   delivery attempt.

### Reply ingestion

1. Reply from the controlled employer mailbox to the generated alias with a
   clearly classifiable response such as an interview invitation.
2. Confirm the signed Resend webhook is accepted once.
3. Confirm the candidate inbox receives the reply and the tracker status advances
   to the expected classification without creating a duplicate message.

### No-contact exclusion and failure handling

1. Confirm Company B has no Send CV action on vacancy cards and does not appear
   in the Send CV tab under equivalent search/region filters.
2. Submit an authenticated stale UI-style request for Company B with
   `requireDirectContact=true`; expect HTTP 422, no outbound message, and no
   successful tracker record.
3. Repeat the request without `requireDirectContact` only as a legacy/API
   compatibility check; verify it is explicitly recorded as `ops_fallback`, not
   presented as a direct employer delivery.
4. Temporarily force a controlled delivery rejection for Company A. Confirm the
   attempt is recorded as failed, `emailSent` remains false, the actual error and
   route are retained, and the tracker never displays “Delivered directly.”
5. Restore delivery and retry. Confirm the retry produces one successful direct
   message, increments delivery-attempt metadata correctly, and preserves the
   same vacancy-linked tracker identity.

Record the staging date, tester, candidate/company fixtures, message IDs, tracker
record IDs, observed routes/statuses, and pass/fail result in the release evidence.
Never copy API keys, webhook secrets, full CV contents, or uncontrolled personal
email addresses into that evidence.
