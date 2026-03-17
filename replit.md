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

## Frontend Pages

- **LandingPage** — public marketing page with sign-in CTA
- **ConsentPage** — GDPR consent gate (shown after first login)
- **OnboardingPage** — multi-step profile wizard (4 steps)
- **DashboardPage** — overview with profile completion, quick links
- **ProfilePage** — editable profile form
- **DocumentsPage** — document upload and management
- **Placeholders** — Eligibility, Path, Review Queue, Role Mgmt, Audit Logs

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

## Upcoming Tasks

- **Task #2**: Regulatory rules engine and eligibility evaluation (GMC/NMC/HCPC rules)
- **Task #3**: Opportunity matching, visa sponsorship feasibility, remediation plans
- **Task #4**: AI prioritisation, human review queue, compliance audit tools

## Development Notes

- Run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Run `pnpm --filter @workspace/db run push` after changing DB schema in `lib/db/src/schema/`
- Auth templates live in `.local/skills/replit-auth/templates/`
- Object storage templates live in `.local/skills/object-storage/templates/`

## Session Table Naming

The session store table is named `sessions` (not `user_sessions`). This is intentional and required: Replit Auth uses `connect-pg-simple` which defaults to a table named `sessions`. Renaming it would break the auth system without additional configuration. The `sessions` table is managed by the auth middleware and should not be touched manually.
