# Inbound Email Setup — `mail.jobsage.app`

This document describes the one-time DNS and Resend configuration required to route
employer reply emails into the JOBSAGE platform inbox.

---

## How it works

1. When a candidate sends a speculative CV, the email is sent **from** their unique
   JOBSAGE alias (e.g. `john.smith.a1b2c3@mail.jobsage.app`).
2. The employer's reply goes back **to** that alias.
3. Resend receives the inbound email (via MX records pointing at Resend's servers),
   then POSTs the parsed email to our webhook endpoint.
4. The webhook resolves the alias → candidate, stores the message in the inbox,
   advances the speculative application status, and notifies the candidate.

---

## Step 1 — Resend domain setup

1. Log into the [Resend dashboard](https://resend.com/domains).
2. Click **Add Domain** and enter `mail.jobsage.app`.
3. Choose **Inbound** as the domain purpose (or enable inbound after adding the domain).
4. Resend will show you the DNS records to add (SPF, DKIM, and MX).

---

## Step 2 — DNS records for `mail.jobsage.app`

Add the following DNS records to your DNS provider for the subdomain `mail.jobsage.app`:

### MX record (route inbound mail to Resend)
| Type | Name              | Value                     | Priority |
|------|-------------------|---------------------------|----------|
| MX   | mail.jobsage.app  | inbound.resend.com        | 10       |

### SPF record (allow Resend to send outbound on your behalf)
| Type | Name              | Value                                              |
|------|-------------------|----------------------------------------------------|
| TXT  | mail.jobsage.app  | v=spf1 include:_spf.resend.com ~all               |

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
3. Under **Events**, select `email.inbound_received`.
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

Use Resend's **Send Test Email** feature or `curl` to POST a sample payload:

```bash
curl -X POST https://jobsage.co.uk/api/webhooks/inbound-email \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_SECRET" \
  -d '{
    "type": "email.inbound_received",
    "data": {
      "from": "Hiring Manager <hr@testcompany.com>",
      "to": ["john.smith.a1b2c3@mail.jobsage.app"],
      "subject": "Re: [Speculative CV] John Smith → Test Company",
      "text": "Thank you for your application. We would love to invite you for an interview.",
      "messageId": "<test-12345@testcompany.com>"
    }
  }'
```

Expected response:
```json
{ "ok": true, "category": "interview_invited", "matchedApplicationId": 42 }
```

---

## Webhook payload format

Resend delivers inbound emails with this shape:

```json
{
  "type": "email.inbound_received",
  "created_at": "2025-01-01T12:00:00.000Z",
  "data": {
    "from": "Sender Name <sender@company.com>",
    "to": ["alias@mail.jobsage.app"],
    "subject": "Re: ...",
    "text": "Plain text body",
    "html": "<p>HTML body</p>",
    "headers": [{ "name": "Message-ID", "value": "<msg-id@company.com>" }],
    "messageId": "<msg-id@company.com>",
    "attachments": []
  }
}
```

The handler also accepts flat payloads (fields at root level) for forward
compatibility with future Resend API versions.

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
- **Duplicate deliveries** are deduplicated using the Resend `messageId`.
- **Rate limiting** caps inbound processing at 20 emails per minute per sender.
- The endpoint returns HTTP 200 for all "safe skip" cases so Resend does not retry.

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
  `@mail.jobsage.app` alias.
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
