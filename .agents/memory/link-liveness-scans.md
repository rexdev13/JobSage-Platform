---
name: Link liveness scans
description: Gotchas for running/extending the job-link liveness sweep and full scans
---

- Aggregator domains (LinkedIn, Indeed, Reed, … — the shared vacancy-URL blocklist) can never be HTTP-verified; any sweep/scan must stamp `last_verified_at` on them (bulk, no politeness delay) or the backlog never drains and full scans loop forever. Their liveness stays 'unverified' by design; the UI badges them "not yet verified".
- Sponsor vacancy snapshots repeat the same URL across check dates — apply one verdict per URL (update WHERE url = …, index on url exists), not per row, or scans take 10x longer.
- Candidate-facing policy: dead apply links are suppressed (returned as null / excluded), unverified ones are shown with an amber badge, verified-live get "Link verified" + last-checked timestamp (`linkVerified`/`linkCheckedAt` in API payloads).
- Apply clicks must never wait for liveness. Open and record immediately; skip checks for live links verified within 12 hours, otherwise run only a 1.5-second background probe and propagate dead verdicts URL-wide.
- **Why:** ~10k stored sponsor-vacancy links, ~half on bot-blocking aggregators; naive per-row sequential checking made a full scan take hours instead of ~7 minutes.

## Running long backend jobs from the agent shell
- Background processes started via the shell (even setsid+nohup) are killed when the shell session ends. Run long jobs inside the API server process via an admin endpoint instead.
- To call admin endpoints in dev: insert a row into `user_sessions` (sid = random hex, sess = `{"user":{"id":<admin id>,"email":…,"role":"admin"}}`), then `Authorization: Bearer <sid>` against `http://localhost:80/api/...`.
