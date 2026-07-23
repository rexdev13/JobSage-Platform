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
