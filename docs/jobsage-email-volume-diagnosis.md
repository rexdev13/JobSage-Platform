# JOBSAGE email volume and content diagnosis

**Status:** Read-only investigation; no production or cron configuration changes made.  
**Evidence window:** `2026-09-16 19:29:35 UTC` through `2026-09-23 19:29:35 UTC`, queried from the production read replica on 2026-09-23.  
**Privacy:** Recipient addresses, names, company names, vacancy titles, message bodies, tokens, provider credentials, and raw error bodies are intentionally omitted.

## Short verdict

1. JOBSAGE has one Resend client with eight outbound template functions; the code does not persist a complete outbound-email ledger.
2. Confirmed production proxies are one waitlist confirmation, two speculative-CV employer sends, and two candidate confirmation attempts in seven days.
3. Job-alert activity is real but not directly countable as email: nine users had 38 user-days of sponsor-vacancy claims covering 1,565 vacancy rows.
4. Production sync logs show 3,004 company-site error batches and 25,270 row errors; this is a strong non-email noise candidate, not proof of email volume.
5. Several senders treat a resolved Resend promise as success without checking `result.error`, so “sent” can be reported before provider acceptance is known.
6. The employer-contact route returns `sent: true` before its fire-and-forget email finishes; auth routes can also return safe success text after a send failure.
7. The waitlist path records provider IDs and errors, but form/chat dispatch is background work and has no durable atomic send claim.
8. No Resend event export/API result, deployed log stream, or cron-job.org history was available, so delivered/bounced counts and native cron email volume cannot be proven.
9. Expected HTTP `409` backpressure and probe `504` finalization responses are documented; cron-job.org failure notifications could be noisy if configured to alert on either.
10. First action: inspect cron-job.org notification filters and history; then fix provider-result handling and add privacy-safe outbound reconciliation in code.

## 1. Application outbound-email inventory

All application mail in the inspected code goes through the `Resend` client constructed in `artifacts/api-server/src/lib/email.ts`. The sender is `EMAIL_FROM` when configured, otherwise the code uses a JOBSAGE no-reply fallback. Production `EMAIL_FROM` was not read during this investigation.

| ID / function | Trigger and recipient rule | Subject / template | Frequency controls | Soft-fail / 409 behavior | Noise risk |
|---|---|---|---|---|---|
| E1 `sendWaitlistWelcomeEmail` | Public lead form and chat capture; the submitted address. Form and chat routes dispatch in the background after the API response. | “We've received your information — JOBSAGE”; generic received-details confirmation. | Form route attempts per accepted submission. Chat sends when a phone is present and `waitlistConfirmationSentAt` is absent. No cross-request claim/lock before the send. | Checks `result.error` and persists either provider ID/sent time or last error. A send failure does not change the already-returned form `201`. No HTTP `409` path in the mail function. | Medium. Form/chat can race on an address because the check and send are separate; repeat chat requests are guarded by the stored sent timestamp only after delivery. |
| E2 `sendVerificationEmail` | Registration, candidate self-service resend, and admin resend; the account email. | `JOBSAGE: Verify your email address`; 24-hour token link. | Registration once per new account. Candidate resend has a process-local cooldown. Admin resend has no mail-specific cooldown. | Does not inspect `result.error`; callers only catch a thrown promise. Candidate resend returns the safe response even after a caught failure. Admin returns `503` only for a thrown failure; no `409` in the provider path. | Medium to high during repeated registration/resend attempts. The self-service cooldown is in-memory and is not shared across workers/restarts. |
| E3 `sendPasswordResetEmail` | Candidate forgot-password, admin reset, and super-admin marketing-account invitation; the requested account email. | `JOBSAGE: Reset your password`; invitation also uses this reset template, with a one-hour reset token in normal reset flow. | No cooldown in forgot-password or admin paths. One request can replace the prior reset token. | Does not inspect `result.error`. Forgot-password intentionally returns the same safe response whether or not a send succeeds; admin returns `503` only on throw; super-admin deletes the newly created account only on throw. No `409` in the provider path. | High as a code-level noise candidate because repeated requests are not debounced and provider errors can be invisible. |
| E4 `sendJobAlertEmail` | Daily scheduler at 07:00 Europe/London; candidate profiles with alert preference other than `off`, eligible profession category, and a stored user email. | With roles: `JOBSAGE: N new role(s) matching your profile`; otherwise daily/weekly alert subject. HTML separates “Roles You Can Apply to Now” and “Roles Worth Working Towards”. | Profile checkpoint enforces daily or weekly interval. Sponsor vacancy URLs are durably deduplicated. Checkpoint is restored when no roles exist or the promise throws. | Does **not** inspect `result.error`; a provider-level structured error can still advance `lastAlertSentAt` and retain sponsor claims. Scheduler logs a failure only when the function throws. No `409` in the provider path. | High. One email can contain many roles; a provider structured error can suppress retry; the body’s eligibility wording depends on current decision/profile state. Sponsor roles use the latest eligibility decision without the regulator-role registration gate used for regulator roles. |
| E5 `sendCandidateContactEmail` | Employer contact API; the candidate’s account email after a candidate message row is inserted. | Caller-supplied subject; body says the candidate has a new message from the company and links to the inbox. | None. One email attempt per employer contact request. | Does not inspect `result.error`. The route starts a fire-and-forget send and immediately returns `201` with `sent: true`; a later throw is only logged. No `409` in the provider path. | High. Repeated employer clicks create separate messages and email attempts; response wording can claim sent before the provider result is known. |
| E6 `sendSpeculativeCVToOps` | Speculative-CV application flow; resolved employer contact, employer account, sponsor contact, or operations fallback. Candidate alias is Reply-To, not the From address. | `Application: <candidate> — <vacancy or company>`; PDF and optional cover letter attached. | Application delivery-attempt rows and application state control retries. A missing direct destination is pending/ops follow-up rather than a direct Resend send. | Calls `assertEmailConfiguration`, checks `result.error`, and throws on provider rejection. Caller persists delivered/pending/failed state only after this step. No `409` in the provider path. | Medium. Resends are deliberate and persisted, but retry controls and missing-contact follow-up can still create repeated employer outreach if operators retry without checking the attempt state. |
| E7 `sendSpeculativeCVNotification` | Called for the candidate only after E6 reports employer email delivered; candidate account email. | `JOBSAGE: Your speculative CV to <company> has been delivered/sent`; states whether delivery was direct or routed to the JOBSAGE team. | At most once per successful E6 call in the current request; no separate provider ledger or idempotency key. | Does not inspect `result.error`; caller catches only throws and does not change the already-persisted employer delivery state. No `409` in the provider path. | Medium to high. The “delivered” wording means Resend accepted the employer send, not that the employer mailbox accepted it; a candidate notification can silently fail. |
| E8 `sendEmployerReplyNotification` | Inbound Resend webhook after an employer reply is stored and, where matched, the application status is advanced; candidate account email. | `JOBSAGE: <category> from <company>`; includes the employer reply and inbox/tracker links. | Resend inbound webhook deduplicates by external message ID; no outbound notification ledger. | Does not inspect `result.error`. Webhook returns `200` after logging a thrown notification failure, so Resend does not retry the inbound event. No application `409` path. | Medium. A single inbound message should produce one notification, but a structured outbound error is invisible and the already-stored application state remains advanced. |

### Application path details

- E1 is called from `routes/leads.ts` for both the public form and chat. The form returns `201` before the background send finishes. Chat marks a request `queued`, but the send is also background work.
- E2 is called by registration, candidate resend, and admin resend. The candidate resend cooldown is a process-local `Map`, not a database or shared-worker control.
- E3 is called by candidate forgot-password, admin reset, and super-admin marketing-account creation.
- E4 is started from `index.ts` in all environments. Production starts the alert scheduler, while the short vacancy pipelines are externalized.
- E5 inserts the candidate message first, then starts the provider call without awaiting it.
- E6/E7 are separate application and candidate-notification sends. E7 is not a confirmation that the candidate mailbox accepted the message.
- E8 is the only outbound path caused by an inbound employer email. The inbound webhook itself is not outbound mail.

## 2. Schedulers and non-email alert sources

### In-process schedules

| Work | Schedule / environment | Observable result |
|---|---|---|
| Candidate job alerts | Daily at 07:00 Europe/London, all environments | One candidate email per eligible profile when new roles are assembled; skips `off` and interval-ineligible profiles. |
| Sponsor register sync | Daily at 02:00 Europe/London | Console errors and sync-log rows; no Resend call. |
| Daily register pipeline | Daily at 04:00 Europe/London | Runs register sync again, then logs completion; no Resend call. |
| Sponsor vacancy cleanup | Daily at 03:30 Europe/London | Deletes only positively dead rows older than 24 hours; console errors only. |
| Apply-URL backfills | Daily at 03:00 Europe/London | Console errors only; no Resend call. |
| Development board checker | Every six hours at `06/12/18/00`-style configured intervals, Europe/London | In production it is disabled; development logs and sync rows only. |
| Development company-site discovery | Hourly at minute 17, Europe/London | In production it is disabled; development logs and sync rows only. |
| Development liveness sweep | 01:30, 07:30, 13:30, 19:30 Europe/London | In production it is disabled; development logs and sync rows only. |
| Calendly synchronization | Every 10 minutes, with one startup sync | Console logs only; not an email path. |

Production `index.ts` explicitly states that external HTTP cron owns board, company-site, and liveness batches. The in-process board/company-site/liveness schedules are only started outside production.

### External HTTP vacancy jobs

The authenticated `POST /api/internal/vacancy-jobs` route accepts `job_board`, `company_site`, `company_site_probe`, `liveness`, `contact`, `reed_professions`, and `additional_boards`. The documented cron-job.org schedule is:

| Kind | Documented schedule | Default / maximum | Response semantics |
|---|---|---:|---|
| Board | `0 2,8,14,20 * * *` Europe/London | 50 / 50 employers | `200` summary; `done` indicates whether the queue page ended. |
| Company site | `17 * * * *` | 10 / 10 employers | `200` summary; partial/failed rows appear in counters and sync logs. |
| Company-site probe | `30 3,5,9,11,15,17,21,23 * * *` | 30 / 30 employers | `200` summary or `504` if its absolute HTTP budget is reached. |
| Liveness | `30 1,7,13,19 * * *` | 40 / 50 URLs | `200` summary; deadline handling keeps the writer lock safe. |
| Contact | `47 3 * * *` | 5 / 5 employers | `200` summary; zero selected may still mean retry/backoff work exists. |
| Reed/additional boards | Cursor jobs every two hours in the documented minute slots | 1 / 2 profession pages | `200` summary with cursor; cursor remains on a failed/cooldown category. |

Important status distinctions:

- `409` means the shared PostgreSQL writer lock is already owned by another batch. It is documented expected backpressure, not a vacancy-data failure.
- Probe `504` means the short HTTP budget ended while safe finalization may still be settling; it is documented retryable backpressure, not proof that the batch failed.
- `500` is an unhandled application failure; `401` is an invalid job secret; `503` is missing configuration or a disabled AI-cap precondition.
- `200` can contain partial, failed, empty, deferred, or not-done counters. It is a successful HTTP request, not necessarily a fully completed queue.
- The app emits console `pipeline-tick` lines and writes `vacancy_sync_log` rows. No scheduler branch found sends a Resend email for these outcomes.

### Cron-job.org native notifications versus JOBSAGE mail

The repository documents how to configure cron-job.org requests but does not contain the cron-job.org account’s notification settings or history. Therefore it cannot prove whether native email notifications are enabled, who receives them, or how many were sent.

Safe signals for separating the two sources:

1. **Headers:** JOBSAGE app mail has the configured JOBSAGE sender display/domain and Resend provider headers; native cron mail has cron-job.org/provider return-path and message headers. Inspect headers, not only the visible subject.
2. **Subject:** app subjects follow the E1–E8 patterns above. Native cron subjects normally identify a monitored job, URL, HTTP status, or execution failure; the exact configured wording is unavailable here.
3. **Timing and status:** match native messages to cron-job.org execution history and HTTP status. A 409 or probe 504 can be a native notification even though the application treats it as expected retryable contention.
4. **Provider evidence:** a Resend message/event ID or Resend export proves an app/provider path; a cron-job.org execution/message record proves a native notification. The current database stores a provider ID only for successful waitlist confirmations and does not store a shared outbound ID for the other paths.

## 3. Seven-day production evidence

### What can be counted safely

| Source / type | Count in the window | What the count means | What it does not prove |
|---|---:|---|---|
| Waitlist confirmation | 1 confirmed row, 1 with a stored provider ID; 1 new lead row; 0 error rows among leads created in-window | One form-sourced lead reached the waitlist sender and the app recorded provider acceptance metadata. The row’s current status was `unqualified`. | It is not a Resend delivered/bounced count, and existing rows whose error field changed later cannot be reconstructed as attempts. |
| Speculative-CV delivery attempts | 3 attempt rows: 2 `delivered`, 1 `pending` | Two employer sends were accepted by the app’s checked Resend call; one application remained pending without a completed direct send. | Pending does not identify an email attempt; the app can defer before calling Resend when no direct destination exists. Mailbox delivery is unavailable. |
| Speculative-CV delivered state | 2 applications, both `sponsor_contact_email`, on 2026-09-18 and 2026-09-23 UTC | Persisted application state says both employer sends completed and remained `cv_sent`. | It does not prove employer mailbox acceptance or candidate confirmation delivery. |
| Candidate confirmation side effect | 2 `system` inbox rows, one on each delivered application date | The application created the in-app “Speculative CV sent” notification after each checked employer send. | The separate candidate Resend call has no provider ID or durable send result. |
| Job-alert sponsor claims | 1,565 vacancy-delivery rows for 9 users; 38 distinct user-days with at least one row | Durable sponsor-vacancy claims show substantial alert-related activity from 2026-09-17 through 2026-09-23 UTC. | Rows are vacancies, not emails. A single email can contain many rows, regulator-only alerts do not create these rows, and `profiles.last_alert_sent_at` stores only the latest checkpoint. |
| Inbound employer-reply notifications | 0 `employer_reply` message rows; 0 with inbound Resend message IDs | No persisted employer reply was available in-window to trigger E8. | It does not prove there were no inbound webhook attempts rejected before insertion, nor does it count E8 sends outside the window. |
| New accounts / auth mail proxy | 0 users created and 0 new unverified users in-window; no matching email audit events | No recent registration volume is visible in this production snapshot. | Forgot-password, admin resend, or repeated verification attempts are not ledgered, so auth email volume is unavailable. |

### Non-email production signals

The production `vacancy_sync_log` read shows, in the same seven-day window:

- `company_site`: 3,165 batches total — 3,004 `error` status and 161 `success` status — with 25,270 accumulated row errors on the error-status batches.
- `job_board`: 277 successful batches and 0 recorded row errors.
- `liveness`: 281 successful batches and 0 recorded row errors.
- `company_site_probe`: 26 successful batches and 0 recorded row errors.
- Profession backfills: 221 successful batches across Reed, jobs.ac.uk, and Teaching Vacancies, with 0 recorded row errors.
- A further 443 successful rows have a null `job_kind` in the seven-day window, so they cannot be assigned to a current scheduler from this table alone.

These are application/database execution records, not email records. The unusually high company-site error-batch count is confirmed evidence of an operationally noisy path, but the cause could be duplicate/legacy callers, repeated short batches, or historical schema/job-kind behavior. Cron history is required before assigning it to a specific cron-job.org job.

### Evidence that is unavailable

- **Resend provider:** no provider event export/API result was available. Delivered, bounced, deferred, rejected, recipient-domain, message-ID, and exact-subject counts cannot be reported for E2–E8.
- **Application logs:** no seven-day deployed log stream was available. Current/working-tree code was inspected, but console line counts cannot be reconstructed from source.
- **cron-job.org:** no execution history, notification setting, recipient, retry, or native-message export was available.
- **Outbound ledger:** only waitlist has a stored provider ID; most send calls do not persist an outbound attempt, rendered template ID, result, or timestamp.
- **Message content:** exact recent message bodies were not available in the database and are intentionally not included.

## 4. Five noisiest identifiable types: recent state audit

The list combines measured activity with the strongest identifiable noise candidates where direct email volume is not observable. “Accurate” below means accurate relative to the persisted/application state and the provider acceptance boundary, not confirmed mailbox delivery.

| Type / recent masked example | State checked | Accuracy finding |
|---|---|---|
| **Job alert** — 2026-09-17 to 2026-09-23 UTC activity | 9 users, 38 user-days, 1,565 durable sponsor-vacancy rows. The scheduler queries active regulator roles newer than the checkpoint plus sponsor roles with a specific URL, deduplicates sponsor URLs, and sets the checkpoint before the send. | **Partially wrong risk.** The “new role” claim is supported for sponsor rows claimed after the checkpoint, but no body/provider event can verify the actual email. A structured Resend error is ignored, and sponsor roles use the latest eligibility decision without the regulator-role registration/licence gate, so an “apply now” section can be wrong for some profiles. |
| **Speculative-CV employer delivery** — two recent completed attempts | Both rows are `delivered`, route `sponsor_contact_email`, dates 2026-09-18 and 2026-09-23 UTC, and the app created two corresponding system inbox records. E6 checks `result.error` before persisting `email_sent=true`. | **Accurate at app/provider-acceptance level.** The database supports that two sends completed through the checked Resend call. Final employer mailbox delivery and attachment receipt are unavailable. |
| **Speculative-CV candidate confirmation** — two calls following those deliveries | E7 is called only after E6 reports success; the candidate-facing template says the CV was delivered/sent and links to the tracker. The two system inbox records corroborate the two application events. | **Partially wrong.** The “employer send completed” part matches state, but E7 ignores a structured provider error and has no outbound result record. “Delivered” must not be read as mailbox acceptance. |
| **Waitlist confirmation** — one form-sourced row on 2026-09-17 UTC | `waitlist_confirmation_sent_at` and a non-null provider ID are present; the row is form-sourced and currently `unqualified`; no in-window error row was recorded for the new lead. | **Accurate at recorded provider-acceptance level.** The confirmation says details were received, which matches the persisted lead. The API’s form success was returned before the background email completed, so the UI response itself is not delivery proof. |
| **Cron-job.org/native company-site failure notification candidate** — recent production execution state | 3,004 company-site error batches and 25,270 row errors are recorded, while the app has no Resend call in any vacancy scheduler. The documented one-hour company-site schedule and current log volume do not match without additional history. | **Partially wrong if attributed to JOBSAGE app mail; otherwise unproven.** The underlying error counters are real database evidence, but sender, recipient, notification setting, and exact native message are unavailable. A claim that these were JOBSAGE Resend emails is not supported. |

### Other code-level accuracy risks not selected as a measured top five

- **Employer contact:** no recent durable email example exists. The message row is persisted, the email is fire-and-forget, and the API returns `sent: true` immediately. This is a false-confidence risk, not evidence of recent volume.
- **Employer-reply notification:** no recent `employer_reply` row exists. If one appears, the inbound message/status can be persisted even if the outbound candidate notification later fails.
- **Verification/password reset:** no recent account-creation proxy exists. The copy and token lifetime are code-defined, but repeated forgot-password/admin sends are not countable from the current schema.

## 5. Ranked root causes

### Confirmed

1. **No shared outbound-email ledger.** Most paths do not persist a provider ID, attempt timestamp, result, sanitized type, or event reference. Volume and duplicate analysis therefore cannot be done from the database.
2. **Resolved Resend promise is treated as success in six generic paths.** E2, E3, E4, E5, E7, and E8 do not inspect `result.error`. This can advance checkpoints, return success, or store a state claim even when the provider returned a structured error.
3. **Employer contact reports success before delivery work completes.** E5 is deliberately fire-and-forget after the message insert and returns `sent: true`.
4. **The alert schedule is inherently repetitive.** E4 runs daily, and 38 user-days of sponsor claims were recorded in the window. Many vacancy rows can be packed into one message, so raw row volume can look like email volume.
5. **Company-site execution is demonstrably noisy.** 3,004 error batches and 25,270 row errors are recorded in seven days. This is a likely source of operator concern even though it does not send app mail.

### Likely but not proven with available production evidence

6. **Cron-job.org native failure notifications may be treating expected backpressure as failure.** The docs explicitly call `409` expected lock contention and probe `504` retryable finalization. The cron account’s filters and history are unavailable, so this remains a hypothesis.
7. **Duplicate or legacy company-site callers may exist.** The 3,165 company-site sync rows in seven days are not explained by the documented one-hour request alone. Cron execution history and deployment logs are needed before changing schedules.
8. **Alert copy/query mismatch can create inaccurate “apply now” claims.** The sponsor-role branch uses decision eligibility but not the regulator-role registration/licence check. A message-level example cannot be proved without a provider export or rendered-body capture.
9. **Waitlist duplicate sends are possible under concurrent form/chat requests.** The persisted sent timestamp is checked after separate reads, sends, and updates; no atomic claim spans both entry points. The seven-day data shows one confirmation, so this is a code risk rather than observed duplication.

### Not supported by available evidence

- A staging sender or wrong production environment caused the recent volume.
- Resend bounces or mailbox rejection caused the reported content problem.
- Inbound employer replies caused a recent notification spike; there were no persisted employer-reply rows in-window.

## 6. Prioritized next actions

1. **[Safe to change in cron UI now]** Review cron-job.org execution notifications and exclude expected `409` responses and company-site probe `504` responses from failure emails; alert on authentication/configuration errors and genuine `5xx` failures instead. Keep the request schedules unchanged until history confirms duplication.
2. **[Safe to change in cron UI now]** Confirm there is only one active caller per documented vacancy kind, disable tight automatic retries, and require `Retry-After` handling. Do not treat a `200` summary with `done=false` or deferred work as a failure email.
3. **[Requires code/configuration]** Centralize provider-result handling so every Resend call checks structured errors, records whether the provider accepted the request, and uses truthful response wording (`queued`, `accepted`, or `failed`) rather than a generic sent claim.
4. **[Requires code/configuration]** Add a privacy-safe durable outbound ledger with message type, trigger reference, masked recipient domain/role, provider ID, attempt/result timestamps, and sanitized error class; reconcile it with Resend webhooks/events.
5. **[Requires code/configuration]** Make waitlist dispatch idempotent across form and chat with a database claim or unique event key, while preserving retry after a real provider failure.
6. **[Requires code/configuration]** Reconcile alert eligibility and copy with the same registration/licence and live-vacancy rules used by Opportunities; keep the daily/weekly checkpoint and sponsor URL dedupe, but do not advance it on a provider structured error.
7. **[Blocked pending production evidence]** Obtain a redacted seven-day Resend event export/API report and cron-job.org execution/notification history, then join them by UTC timestamp, status, job kind, and masked domain. Do not use raw bodies or unmasked addresses.

## Follow-up evidence request

For a safe follow-up, operators need:

1. Resend event export for the evidence window with provider event type, timestamp, message ID, sender domain, masked recipient domain, and a subject hash or subject pattern.
2. cron-job.org history for every vacancy job with trigger time, HTTP status, retry count, notification setting, and masked notification recipient.
3. Deployed API logs for `[email]`, `[alert-scheduler]`, `[vacancy-job-http]`, `[pipeline-tick]`, and `[company-site-scheduler]`, with addresses and message bodies redacted.
4. Read-only production aggregates rerun from `social_leads`, `speculative_application_delivery_attempts`, `speculative_applications`, `profiles`, `job_alert_vacancy_deliveries`, `candidate_messages`, `audit_events`, and `vacancy_sync_log`.

Useful source searches used for this report:

```sh
rg -n 'resend\.emails\.send|send[A-Z].*Email' artifacts/api-server/src
rg -n 'cron\.schedule|/internal/vacancy-jobs|status\(409\)|status\(504\)' artifacts/api-server/src docs
```

## Source map

- `artifacts/api-server/src/lib/email.ts`
- `artifacts/api-server/src/lib/alertScheduler.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/routes/adminUsers.ts`
- `artifacts/api-server/src/routes/superAdmin.ts`
- `artifacts/api-server/src/routes/leads.ts`
- `artifacts/api-server/src/routes/employer.ts`
- `artifacts/api-server/src/routes/speculativeApplications.ts`
- `artifacts/api-server/src/routes/inboundEmail.ts`
- `artifacts/api-server/src/routes/internalVacancyJobs.ts`
- `artifacts/api-server/src/lib/vacancyCheckScheduler.ts`
- `artifacts/api-server/src/lib/companySiteScheduler.ts`
- `artifacts/api-server/src/lib/vacancyLivenessSweep.ts`
- `artifacts/api-server/src/lib/vacancyJobRunner.ts`
- `artifacts/api-server/src/index.ts`
- `docs/vacancy-jobs-http-cron.md`
- Production read-only aggregates from the tables listed in “Follow-up evidence request”.