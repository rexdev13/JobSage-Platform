# Bounded production vacancy run plan — not executed

## Safety status

This plan did not call the vacancy worker. Use it only for a later, separately approved production run, after any sponsor URL changes have been reviewed and applied through the protected production importer. The resolver did not deploy or alter production. Already-running services may continue their own schedules independently; check their status before running this plan.

## Production path

Use the authenticated production HTTP worker at `POST $PRODUCTION_API_ORIGIN/api/internal/vacancy-jobs`, not the development-only `vacancy:sponsor-websites` CLI. There is no production direct-feeds-only job kind.

The production `company_site` job includes verified direct ATS feeds when a saved mapping supports one, then the normal company-site discovery path. Feed adapters run only with a verified mapping and keep their completeness/evidence rules. Employers without a usable direct feed can go through ordinary site discovery. This is one employer cohort, not one vacancy; one employer may yield multiple roles.

The endpoint requires the `x-jobsage-job-secret` header backed by the Replit secret `VACANCY_JOB_SECRET`. It refuses the request unless `VACANCY_AI_WEB_SEARCH_DAILY_CAP` is zero. Company-site batches default to at most 10 employers and cannot exceed 10; this pilot explicitly asks for one.

## One-request pilot command

Before running it later:

1. Confirm the production deployment contains the approved worker code and that the production AI web-search cap is still zero.
2. Check the external scheduler's latest batch history. Pause or coordinate it so this request is not competing with another caller.
3. Load the API origin and secret into the shell securely. Do not paste the secret into chat, shell history, or logs; do not enable shell tracing.
4. Run exactly one request and review the full response. Do not loop or automatically retry.

```sh
: "${PRODUCTION_API_ORIGIN:?Set the canonical production API origin}"
: "${VACANCY_JOB_SECRET:?Load this from Replit Secrets without printing it}"
curl --fail-with-body --silent --show-error --max-time 30 \
  "$PRODUCTION_API_ORIGIN/api/internal/vacancy-jobs" \
  -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET" \
  -H "content-type: application/json" \
  --data '{"kind":"company_site","limit":1}'
```

## Verify and stop

- Accept only a successful response showing `selected` no greater than 1, with `errors: 0`; retain `upserted`, duration, and the recorded `company_site` batch kind for review.
- Stop after this single employer, even if `done` is false. A false value means more eligible work remains; it is not permission to drain the queue.
- If the endpoint returns HTTP 409, respect `Retry-After` and verify the active batch has finished before considering another request. For HTTP 504 or a client timeout, do not retry immediately: the batch may still be settling. Check production batch history and the shared writer-lock status first.
- Review inserted/updated roles against company identity, source evidence, liveness, and candidate-visibility gates before approving a larger cohort.
- Only after the one-employer result is reviewed should an operator decide whether to run another explicitly bounded batch. Never run the development-only direct-feed switch against production.
