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
- `lib/auth-web` — `@workspace/auth-web` — custom email+password useAuth hook

### Tech Stack
- **Frontend**: React 18, Vite, TailwindCSS v4, shadcn/ui, Framer Motion, React Query, wouter
- **Backend**: Express 5, tsx (dev), esbuild (prod)
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Custom email+password — bcryptjs + session cookie + Resend for transactional emails
- **Storage**: Replit Object Storage (`@google-cloud/storage` adapter)
- **API Contract**: OpenAPI 3.1 → Orval codegen

## Database Schema

### `sessions` — DB-backed session store (connect-pg-simple, cookie name `sid`)
### `users` — Users: email, password_hash, email_verified, verify/reset tokens, role (candidate|admin|reviewer), firstName, lastName
### `profiles` — Candidate onboarding profile (profession, specialty, qualifications, visa status)
### `consent_logs` — GDPR consent capture per user with IP hash
### `documents` — Document metadata after object-storage uploads
### `rulesets` — Published GMC/NMC/HCPC ruleset versions
### `ruleset_rules` — Individual eligibility rules per ruleset
### `decision_records` — Eligibility outcomes per user per ruleset (eligible/not_eligible/ineligible, reviewFlagged)
### `roles` — Available clinical/academic roles for opportunity matching
### `remediation_plans` — Auto-generated action plans for ineligible/not_eligible candidates
### `remediation_steps` — Individual steps (title, gap, pathway, source, cost/timeline ranges)
### `review_cases` — Flagged decisions queued for human reviewer annotation
### `review_annotations` — Reviewer notes per review case

## Auth Flow

1. User visits `/login` → enters email + password
2. Backend validates credentials (bcrypt) + checks `email_verified`
3. Session cookie (`sid`) set on success → redirect to `/`
4. `useAuth()` from `@workspace/auth-web` provides `user`, `isLoading`, `isAuthenticated`
5. `AuthGuard` checks auth → consent → profile → routes accordingly
6. Email verification: token link → `GET /api/auth/verify-email?token=...` → session created → redirect
7. Password reset: `/forgot-password` → Resend email → `/reset-password?token=...`

## API Routes

All routes under `/api`:

### Auth
- `GET /api/auth/user` — current authenticated user
- `POST /api/auth/register` — register (sends Resend verification email; rolls back on send failure)
- `GET /api/auth/verify-email?token=` — verify email token, create session
- `POST /api/auth/login` — email+password login
- `POST /api/auth/logout` — clear session
- `POST /api/auth/forgot-password` — send reset link (anti-enumeration)
- `POST /api/auth/reset-password` — set new password via token
- `POST /api/auth/resend-verification` — resend verification email

### Storage
- `POST /api/storage/uploads/request-url` — get presigned upload URL
- `GET /api/storage/public-objects/:filePath` — serve public file
- `GET /api/storage/objects/:objectPath` — serve private file

### Profiles & Consent
- `GET/PUT /api/profiles/me` — candidate profile CRUD
- `GET/POST /api/consent` — consent status and capture

### Documents
- `GET/POST /api/documents` — document list and registration
- `POST /api/documents/upload` — multipart file upload (PDF/JPEG/PNG, max 5 MB)
- `DELETE /api/documents/:id` — document deletion

### Eligibility
- `POST /api/eligibility/evaluate` — run eligibility check (rules engine)
- `GET /api/eligibility/history` — list past decisions
- `GET /api/eligibility/results/:id` — single decision result

### Remediation
- `GET /api/remediation/plan` — get/generate remediation plan
- `PATCH /api/remediation/steps/:id` — update step status
- `PATCH /api/remediation/plans/:id/ordering` — save step order
- `GET /api/ai/remediation-suggestions/:planId` — AI-generated step ordering (gpt-4o)

### Opportunities & Sponsorship
- `GET /api/roles` — matched roles for current candidate
- `GET /api/sponsorship/feasibility/:roleId` — visa sponsorship feasibility

### Admin
- `GET /api/admin/review-queue` — list review cases (admin/reviewer)
- `GET /api/admin/review-queue/:caseId` — case detail with profile snapshot
- `POST /api/admin/review-queue/:caseId/annotate` — add annotation
- `GET /api/admin/audit/decisions` — decision export (JSON or CSV)
- `GET /api/admin/audit/consents` — paginated consent log
- Admin CRUD: rulesets, rules, roles

## Frontend Pages

- **LandingPage** `/landing` — public marketing with Get Started / Sign In CTAs
- **LoginPage** `/login` — email + password sign in
- **RegisterPage** `/register` — create account (sends verification email)
- **ForgotPasswordPage** `/forgot-password` — request reset link
- **ResetPasswordPage** `/reset-password?token=` — set new password
- **ConsentPage** `/consent` — GDPR consent gate
- **OnboardingPage** `/onboarding` — multi-step profile wizard
- **DashboardPage** `/` — overview with profile completion + quick links
- **ProfilePage** `/profile` — editable profile
- **DocumentsPage** `/documents` — document upload & management
- **EligibilityPage** `/eligibility` — run checks, view history, outcome badges
- **OpportunitiesPage** `/opportunities` — matched roles + sponsorship feasibility
- **PathPage** `/path` — remediation plan, step tracking, AI ordering suggestions
- **ReviewQueuePage** `/review-queue` — human reviewer queue (reviewer/admin)
- **AdminAuditPage** `/admin/audit` — decision audit export + consent log (admin)
- **AdminRulesetsPage** `/admin/rulesets` — ruleset management (admin)
- **AdminRolesPage** `/admin/roles` — roles management (admin)

## Environment Variables

- `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — PostgreSQL
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` — Object storage
- `RESEND_API_KEY` — Resend transactional email API key (secret)
- `EMAIL_FROM` — Sender address (shared env, `noreply@jobsage.co.uk`)
- `APP_URL` — Base URL for email links (shared env, `https://jobsage.co.uk`)
- `SESSION_SECRET` — Express session signing secret
- `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI proxy

## Development Notes

- Run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Run `pnpm --filter @workspace/db run push` after changing DB schema in `lib/db/src/schema/`
- Rebuild libs: `pnpm exec tsc --build lib/db lib/api-zod lib/api-client-react lib/auth-web`
- Session store table is `sessions` — managed by connect-pg-simple, do not rename

## Completed Tasks

- **Task #1**: Project scaffold — auth, profiles, consent, documents, storage
- **Task #2**: Regulatory rules engine and eligibility evaluation (GMC/NMC/HCPC rules)
- **Task #3**: Opportunity matching, visa sponsorship feasibility, remediation plans
- **Task #4**: AI pathway prioritisation (gpt-4o), human review queue, audit export, role enforcement
- **Task #5**: Replace Replit Auth with custom email+password auth via Resend; rename lib/replit-auth-web → lib/auth-web
