# JOBSAGE

Decision-intelligence platform for regulated UK healthcare and academic professionals (doctors, nurses, allied health, clinical academics) to determine regulatory eligibility (GMC/NMC/HCPC), visa sponsorship feasibility, and receive personalized remediation plans.

## Architecture

### Monorepo Structure
- `artifacts/jobsage-web` — React + Vite frontend (port 18286, preview path `/`)
- `artifacts/api-server` — Express 5 backend (port 8080, path `/api`)
- `lib/db` — Drizzle ORM + PostgreSQL schema
- `lib/api-spec` — OpenAPI 3.1 spec + codegen
- `lib/api-zod` — Generated Zod schemas
- `lib/api-client-react` — Generated React Query hooks
- `lib/replit-auth-web` — Replit Auth hook for web

### Tech Stack
- **Frontend**: React 18, Vite, TailwindCSS v4, shadcn/ui, Framer Motion, React Query, wouter
- **Backend**: Express 5, tsx (dev), esbuild (prod)
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Replit Auth (OIDC) — `openid-client` v6
- **Storage**: Replit Object Storage (`@google-cloud/storage` adapter)
- **API Contract**: OpenAPI 3.1 → Orval codegen

## Database Schema

### `sessions` — Replit Auth session store (mandatory)
### `users` — Replit Auth user records + `role` column (candidate|admin|reviewer)
### `profiles` — Candidate onboarding profile (profession, specialty, qualifications, visa status)
### `consent_logs` — GDPR consent capture per user with IP hash
### `documents` — Document metadata after object-storage uploads

## API Routes

All routes are under `/api`:
- `GET /api/healthz` — health check
- `GET /api/auth/user` — current authenticated user
- `GET /api/login` — start OIDC browser login
- `GET /api/callback` — OIDC callback
- `GET /api/logout` — browser logout
- `POST /api/mobile-auth/token-exchange` — mobile OIDC code exchange
- `POST /api/mobile-auth/logout` — mobile session logout
- `POST /api/storage/uploads/request-url` — get presigned upload URL
- `GET /api/storage/public-objects/:filePath` — serve public file
- `GET /api/storage/objects/:objectPath` — serve private file
- `GET/PUT /api/profiles/me` — candidate profile CRUD
- `GET/POST /api/consent` — consent status and capture
- `GET/POST /api/documents` — document list and registration
- `POST /api/documents/upload` — multipart file upload (PDF/JPEG/PNG, max 5 MB), saves to object storage and registers in DB
- `DELETE /api/documents/:id` — document deletion

## Database Schema (Additional)

### `rulesets` — Published GMC/NMC/HCPC ruleset versions
### `ruleset_rules` — Individual eligibility rules per ruleset
### `decision_records` — Eligibility outcomes per user per ruleset (3 outcomes: eligible/not_eligible/ineligible, reviewFlagged)
### `roles` — Available clinical/academic roles for opportunity matching
### `remediation_plans` — Auto-generated action plans for ineligible/not_eligible candidates (with orderedStepIds JSON)
### `remediation_steps` — Individual steps (title, gap, pathway, source, cost/timeline ranges, rulesetVersion)
### `review_cases` — Flagged decisions queued for human reviewer annotation
### `review_annotations` — Reviewer notes per review case
### `audit_events` — (reserved) Generic audit event log

## API Routes (Additional)

- `GET/POST /api/eligibility/evaluate` — run eligibility check (rules engine)
- `GET /api/eligibility/history` — list past decisions
- `GET /api/eligibility/results/:id` — single decision result
- `GET /api/remediation/plan` — get/generate remediation plan
- `PATCH /api/remediation/steps/:id` — update step status
- `PATCH /api/remediation/plans/:id/ordering` — save candidate's preferred step order
- `GET /api/ai/remediation-suggestions/:planId` — AI-generated step ordering (OpenAI gpt-4o)
- `GET /api/admin/review-queue` — list review cases (admin/reviewer)
- `GET /api/admin/review-queue/:caseId` — case detail with profile snapshot
- `POST /api/admin/review-queue/:caseId/annotate` — add reviewer annotation, mark reviewed
- `GET /api/admin/audit/decisions` — anonymised decision export (JSON or CSV)
- `GET /api/admin/audit/consents` — paginated consent log
- `GET /api/roles` — matched roles for current candidate
- `GET /api/sponsorship/feasibility/:roleId` — visa sponsorship feasibility
- Admin CRUD: rulesets, rules, roles

## Frontend Pages

- **LandingPage** — public marketing page with sign-in CTA
- **ConsentPage** — GDPR consent gate (shown after first login)
- **OnboardingPage** — multi-step profile wizard (4 steps)
- **DashboardPage** — overview with profile completion, quick links
- **ProfilePage** — editable profile form
- **DocumentsPage** — document upload and management
- **EligibilityPage** — run eligibility checks, view history, outcome badges + DisclaimerBanner
- **OpportunitiesPage** — matched roles with sponsorship feasibility + DisclaimerBanner
- **PathPage** — remediation plan with step tracking + AI ordering suggestions panel + DisclaimerBanner
- **ReviewQueuePage** — human reviewer queue with case detail and annotation form (reviewer/admin)
- **AdminAuditPage** — decision audit export (JSON/CSV) and paginated consent log (admin)
- **AdminRulesetsPage** — ruleset management (admin)
- **AdminRolesPage** — roles management (admin)

## Frontend Auth Flow

1. User clicks "Sign In" → redirect to `/api/login`
2. OIDC callback → session cookie set → redirect to app
3. `useAuth()` from `@workspace/replit-auth-web` provides `user`, `isLoading`
4. `AuthGuard` component checks auth, then checks consent, then checks profile
5. If no consent → ConsentPage; if no profile → OnboardingPage; otherwise → main app

## Environment Variables

- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` — Object storage
- `REPL_ID`, `ISSUER_URL` (auto-set by Replit) — OIDC auth

## Completed Tasks

- **Task #1**: Project scaffold — auth, profiles, consent, documents, storage
- **Task #2**: Regulatory rules engine and eligibility evaluation (GMC/NMC/HCPC rules)
- **Task #3**: Opportunity matching, visa sponsorship feasibility, remediation plans with ruleId/rulesetVersion traceability
- **Task #4**: AI pathway prioritisation (gpt-4o), human review queue, audit export, consent log view, global disclaimer banners, role enforcement (requireReviewer)

## AI Integration

- Package: `lib/integrations-openai-ai-server` — wraps OpenAI SDK with Replit proxy
- `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` env vars auto-set
- Used in `/api/ai/remediation-suggestions/:planId` — gpt-4o with JSON mode

## Development Notes

- Run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Run `pnpm --filter @workspace/db run push` after changing DB schema in `lib/db/src/schema/`
- Auth templates live in `.local/skills/replit-auth/templates/`
- Object storage templates live in `.local/skills/object-storage/templates/`

## Session Table Naming

The session store table is named `sessions` (not `user_sessions`). This is intentional and required: Replit Auth uses `connect-pg-simple` which defaults to a table named `sessions`. Renaming it would break the auth system without additional configuration. The `sessions` table is managed by the auth middleware and should not be touched manually.
