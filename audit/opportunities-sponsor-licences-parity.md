# Full audit: Opportunities → Sponsor Licences parity

**Scope:** Read-only audit. No implementation, migration, enrichment, publishing, or code changes were performed for the audit itself.

## Executive findings

The recent liveness work aligns the most important trust boundary:

- Both surfaces use fresh, confirmed-live Sponsor Licence vacancy links.
- The shared freshness standard is six hours.
- Dead URL evidence is preserved rather than reinterpreted as email-only.
- Vacancy-specific Send CV is independently enforced by the server.
- Employer-level speculative outreach and careers-site fallback remain separate.

The remaining parity gaps are:

1. **Outbound tracking is inconsistent.** Main Opportunities cards create a `link_clicked` application record, while the best-match strip, Send CV apply-only rows, and Sponsor Licence links use `openTrackedOutbound`, which only emits the extension event and opens the URL.
2. **Smart Apply semantics differ.** Opportunities exposes `SmartApplyModal`; Sponsor Licences primarily exposes tracked external Apply and CV outreach.
3. **Eligibility behavior differs.** Opportunities treats gaps as advisory; Sponsor Licences disables JOBSAGE CV submission when `isEligible === false`.
4. **Filtering and ranking differ.** Opportunities is candidate/vacancy-centric; Sponsor Licences is employer-centric, paginated, and register-metadata driven.
5. **Liveness states are less visible than the API contract.** Sponsor Licence rows are prefiltered to live, so users rarely see why stored evidence is unavailable.
6. **Contact enrichment currently uses paid AI web search.** `POST /sponsor-licences/:id/enrich` invokes `gpt-4o` with `web_search_preview`, which conflicts with the current no-paid-search constraint and should not be reused for parity work.

---

# Part 1 — Opportunities inventory

## Main surface

**File:** `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`

**Component:** `OpportunitiesPage`

**Main endpoint:** `GET /api/roles`

The page uses `useAuth`. The roles endpoint returns `401` when unauthenticated. AI matches are enabled only after authentication settles.

### Tabs

| Tab | Request | Purpose |
|---|---|---|
| `board` | `/roles?source=job_board` | Apply through supported job boards |
| `employers` | `/roles?source=company_site` | Apply through official company sites |
| `sendcv` | `/roles` without source | Find email-capable or verified-apply vacancies |

The initial tab can be selected through `?tab=`, but changing tabs does not update the URL.

### Request behavior

Relevant symbols:

- `OPPORTUNITIES_TIMEOUT_MS`
- `listMatchedRolesWithTimeout`
- `useQuery`
- `getListMatchedRolesQueryKey`

Behavior:

- 15-second client timeout.
- One retry.
- Previous data remains visible during refetch.
- Manual Retry action.
- Errors distinguish no-data failure from failure while displaying cached/previous data.
- No client pagination; the returned ranked catalogue is rendered directly.

## Server-side role assembly

**File:** `artifacts/api-server/src/routes/roles.ts`

`GET /roles` merges:

1. Curated/imported `roles`
2. Published employer `jobListings`
3. AI-discovered `sponsorLicenceVacancies`

Relevant symbols:

- `HAS_CONTACT_INFO`
- `employerJobHasContactInfo`
- `fetchSponsorVacanciesAsRoles`
- `presentApplyLink`
- `roleDedupKey`
- `SPONSOR_VACANCY_ID_OFFSET`
- `candidateBoardSourceForProfession`
- `hasFreshCandidateBoardSnapshot`
- `refreshCandidateBoardVacancies`

### ID spaces

- Curated roles: native role ID
- Employer listings: `jobListing.id + 1_000_000`
- Sponsor vacancies: `sponsorVacancy.id + 2_000_000`

### Contact inclusion

Candidate-facing roles must have at least one of:

- Non-dead apply URL
- Contact email
- Contact phone
- Contact website

A dead apply URL alone does not qualify as contact information.

### Profession and source filtering

Relevant symbols:

- `professionCategoryFor`
- `opportunityCategoriesMatch`
- `storedRegulatorMatchesCategory`
- `employerJobTargetsCategory`
- `classifyVacancyCategory`
- `isManualLabourTitle`

Behavior:

- Candidate profession maps to an opportunity category.
- Clearly mismatched categories are excluded.
- Manual-labour Sponsor Licence vacancies are excluded.
- Ambiguous Sponsor Licence vacancies are removed from the candidate response when `classifiedRelevant === false`.
- Candidates without a supported profession category receive an empty list.

### Deduplication

`roleDedupKey` normalizes employer/title pairs. Sponsor company-site vacancies are deduplicated against curated and employer-posted roles. Job-board handling intentionally differs so legitimate board records remain available.

### Region filtering

Server symbols:

- `roleMatchesPreferredRegions`
- `regionsOverlap`
- Candidate `preferredRegion`

Client symbols:

- `filterOpportunities`
- `hasRegionOverlap`
- `UK_REGIONS`

Unknown/empty target regions remain visible. `National / Multiple Regions` remains visible for regional selections. Client-selected regions are saved to the Professional Profile after a 300 ms debounce.

### Background discovery

When a candidate-specific board snapshot is stale or missing, `/roles?source=job_board` remains database-first and starts `refreshCandidateBoardVacancies(profile)` asynchronously. The current request does not wait for the discovery operation.

## Eligibility and safeguarding

Relevant symbols:

- `assessSponsorshipFeasibility`
- `getRoleEligibilityGaps`
- `getRoleSafeguarding`
- `assessSafeguarding`
- `safeguardingBlocksEligibility`
- `safeguardingGapText`

Fields include:

- `isEligible`
- `eligibilityGaps`
- `matchScore`
- `safeguarding`
- `requiredRegistration`
- `requiredDbsClearanceLevel`
- `requiredSafeguardingLevel`
- `sponsorshipOffered`
- `licensedSponsor`

Presentation:

- “Eligible Now”
- “Not Yet Eligible”
- DBS/safeguarding status badge
- Expandable eligibility notes
- Role-detail modal
- Remediation-path link

Eligibility notes are advisory on Opportunities. An ineligible candidate can still open the application flow; the action label changes from “Smart Apply” to “Apply.”

## Sponsorship presentation

Relevant fields:

- `licensedSponsor`
- `sponsorshipOffered`
- `sponsorshipStatus`

`LicensedSponsorBadge` explicitly warns that register membership does not prove that the vacancy offers sponsorship.

Sponsor vacancy inference uses:

- `inferVacancySponsorshipStatus`
- `confirmed`
- `not_offered`
- `unknown`

The card prominently shows licensed-sponsor membership, but does not consistently show all vacancy-level sponsorship states.

## Ranking

Server symbols:

- `computeMatchScore`
- `batchScoreRoles`
- `candidateMatchScoresTable`
- `sponsorLicenceVacancyScoresTable`
- `calculateBehaviouralRanking`
- `compareOpportunityRanking`
- `qualifiesForApplyFirst`
- `TOP_MATCH_MIN_SCORE`
- `careerFocusBoost`
- `specialtyBoost`
- `PENDING_AI_SCORE`

Ranking signals include eligibility, sponsorship fit, registration requirements, cached AI score, Sponsor vacancy score, specialty/career focus, saved vacancies, employer bookmarks, prior applications, and link clicks.

Client grouping:

- `groupRankedOpportunities`
- Up to five recommended roles
- Up to five roles at or above `CONSIDER_MIN_SCORE` (`40`)
- Remaining roles in “More Opportunities”

Bands:

- “Recommended — Apply First”
- “Worth Considering”
- “More Opportunities”

The client uses server order and does not perform an independent sort.

## Best Matches strip

**Component:** `BestMatchesStrip`

**Data:** `GET /roles/my-matches` through `useGetMyMatches({ limit: 200, source })`

Behavior:

- Shows up to three undismissed, unapplied AI matches.
- Shows score, explanation, reason, employer, and location.
- Allows favorite, dismiss, apply, employer website, Smart Apply, or View Path.
- Shows “Updated today” versus “Just scored.”
- Invalidates the main role list when matching settles.

Dismissal is optimistic locally, persisted through the dismiss endpoint, and has no Sponsor Licence equivalent.

## Favorites and saved state

**Component:** `FavoriteButton`

Used in best-match cards, role cards, Sponsor vacancy rows, and vacancy sheets. Sponsor vacancy favorites use the unified offset ID. Favorite activity contributes to behavioral ranking.

Opportunities has no current share/report action and no general-purpose hide action on normal role cards. Dismiss is limited to the AI queue.

## Vacancy liveness

**Files:**

- `artifacts/api-server/src/lib/vacancyLiveness.ts`
- `artifacts/api-server/src/lib/sponsorVacancyRoles.ts`

**Symbols:**

- `getVacancyLinkStatus`
- `presentApplyLink`
- `RECENT_VERIFY_SKIP_MS`

Statuses:

- `none`
- `live`
- `dead`
- `unverified`
- `inconclusive`
- `stale`

Server freshness is six hours. `presentApplyLink` preserves the stored URL and separately returns:

- `linkStatus`
- `linkVerified`
- `linkCheckedAt`

Sponsor-derived board and company-site rows require a fresh live deep link through `requireSpecificVacancyUrl` and `onlyVerifiedLive`.

### Click-time background check

Client symbols:

- `checkApplyLinkInBackground`
- `isFreshLiveApplyLink`
- `CLICK_HEALTH_TIMEOUT_MS`
- `FRESH_LINK_WINDOW_MS`

Behavior:

- Opens the vacancy immediately.
- Performs a bounded 1.5-second background check.
- Invalidates roles and matches if the URL is dead.
- Network failures/timeouts are inconclusive and do not block navigation.

Important mismatch: the client click helper skips checks for 12 hours, while the candidate-facing server standard is six hours.

### Liveness copy

Main cards show:

- “Link verified”
- “May not be active”
- “Link not yet verified”
- Dead-listing warning after a background check

Stale and inconclusive are not separately communicated.

## Apply and outbound tracking

### Main RoleCard

Relevant symbols:

- `trackAndOpen`
- `doApplyClick`
- `handleApplyClick`

Behavior:

1. Adds `ref=jobsage`.
2. Posts an application record with `applicationType: website` and `status: link_clicked`.
3. Emits `jobsage:outbound-application`.
4. Opens the URL.
5. Starts the background health check for vacancy URLs.
6. May show the extension nudge.

Outbound clicks are gated through `useExtensionGate`.

### Shared outbound helper

**File:** `artifacts/jobsage-web/src/lib/trackedOutbound.ts`

**Symbols:**

- `openTrackedOutbound`
- `openTrackedSponsorVacancy`

The helper adds `ref=jobsage`, emits the trusted extension event, and opens a new tab. It does not create an application record.

Therefore:

- Main RoleCard apply: extension event plus tracker record
- Best Matches apply: extension event only
- Send CV apply-only row: extension event only
- Sponsor vacancy/careers link: extension event only

This is the most important tracking parity gap.

## Apply URL and website fallback

**Helper:** `getOpportunityApplyAction`

Behavior:

- Exact vacancy URL takes priority.
- Contact website becomes “Open employer website” if no vacancy URL exists.
- Website URLs are normalized with `https://`.
- Main cards explain that the fallback opens the employer site rather than a verified vacancy.

LinkedIn and Indeed are rejected as Send CV apply routes through `isDisallowedSendCvApplyUrl` and `hasUsableSendCvApplyRoute`.

## Smart Apply

Components:

- `SmartApplyModal`
- `SmartApplyAssistant`
- `SmartApplyExtensionBanner`
- `SmartApplyExtensionNudge`
- `useExtensionGate`

The server owns application-critical profile readiness. Optional search preferences do not block Smart Apply. Successful submission invalidates roles and applications.

Sponsor Licences does not expose this exact ATS-prefill modal.

## Send CV tab

Helpers:

- `canSendCvForVacancy`
- `hasUsableSendCvApplyRoute`
- `shouldShowOnSendCvTab`
- `shouldShowSendCv`

Rows are shown when:

- Direct-email capability exists and the URL is absent or live, or
- A fresh, verified, non-LinkedIn/non-Indeed apply route exists

Rows are grouped by normalized employer name and searchable by employer, title, or location.

Actions include:

- Send/Resend CV
- Upload CV to send
- Apply via board/company site
- Smart Apply
- View live vacancy

`sendCvEligible === true` remains the strict direct-email capability flag.

## Send CV submission

**Component:** `SponsorVacancyApplyModal`

**Endpoint:** `POST /speculative-applications`

Payload may include:

- `companyName`
- `sponsorLicenceId`
- `vacancyTitle`
- `vacancyRef`
- `roleId`
- `vacancyUrl`
- `sourceType`
- `boardName`
- `requireDirectContact`
- `notes`
- `cvDocumentId`

Vacancy references:

- `role:<merged role id>`
- `sponsor-vacancy:<raw sponsor vacancy id>`

Server enforcement includes authentication, profile/JOBSAGE alias requirements, PDF CV retrieval, direct-contact requirements, stored-vacancy resolution, exact URL identity, fresh-live validation, persisted delivery attempts, delivery outcome, candidate confirmation, tracker/audit updates, and resend support.

The modal also supports multiple CVs, AI outreach assistance, AI cover letters, existing-send warnings, and next-match recommendations.

## Cover Letter and Readiness Check

Cover Letter:

- `CoverLetterModal`
- `useCoverLetterStream`
- `POST /cover-letter/generate-stream`
- Editable output, copy, download, regenerate, retry

Readiness Check:

- `GapAnalysisSheet`
- Sponsor vacancies use `/sponsor-licences/vacancies/:id/gap-analysis`
- Other roles use `/opportunities/roles/:id/gap-analysis`
- Shared monthly allowance of ten newly generated analyses

## Empty and error states

Opportunities distinguishes loading, timeout/error, stale-data retry, no profile, unsupported profession, no region matches, no Send CV routes, no AI matches, reviewed-all matches, missing CV, cover-letter failure, and submission failure.

## Dormant code

`ApplicationsTab`, `AppCard`, and application status configuration exist in `OpportunitiesPage.tsx`, but the current top-level tab union only contains `board`, `employers`, and `sendcv`. The tracker code is not reachable from this page.

## Responsive behavior

The web page is responsive rather than functionally different:

- Tab labels are hidden on small screens.
- Cards collapse to one column.
- Modals become bottom sheets.
- Buttons wrap.

---

# Part 2 — Sponsor Licences inventory

## Main surface

**Files:**

- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/api-server/src/routes/sponsorLicences.ts`

Title: “Visa Sponsoring Employers”

All page APIs require authentication. The global scan is admin-only.

## Sector-first navigation

Data:

- `GET /sponsor-licences/industry-counts`
- `GET /sponsor-licences/industries`

The initial view shows sector icons, sponsor counts, bookmark counts, overall totals, employers with JOBSAGE vacancies, register sync date, and a vacancy-index banner.

This employer/sector browsing experience has no direct Opportunities equivalent.

## Employer list

**Route:** `GET /sponsor-licences`

Parameters:

- `search`
- `route`
- `industry`
- `region[]`
- `hasVacancies`
- `bookmarkedOnly`
- `directContactOnly` (server-supported but not exposed in current page controls)
- `page`
- `limit`

Client behavior:

- 350 ms search debounce
- 20 employers per page
- Previous page retained while filters load
- Page reset after filter changes

## Employer filters

Available:

- Organisation name
- Worker route
- Industry
- Multiple register regions
- Has Vacancies
- Bookmarked
- Sector selection

Not available:

- Candidate profession/category
- Candidate saved profile regions
- Vacancy title/location search
- Vacancy source
- Vacancy sponsorship-confirmed state
- Vacancy eligibility
- Vacancy score threshold
- Direct Contact Only UI
- Explicit LinkedIn/Indeed filter

Sponsor region filtering uses register region, not vacancy target region.

## Employer ranking

Server ordering:

1. Employers with fresh live vacancies
2. Never-checked employers
3. Checked employers with no fresh live vacancies

Within live employers:

1. Best stored match score descending
2. Fresh-live vacancy count descending
3. Organisation name alphabetically

This is intentionally employer-centric and not equivalent to Opportunities’ vacancy ranking.

## Employer metadata

Cards show organisation, town/city, county, region, route, sub-route, rating, industry styling, fresh-live vacancy count, CV Sent state, last check time, 24-hour discovery-cache status, best-fit percentage, and bookmark state.

Register metadata is not presented as vacancy sponsorship proof.

## Vacancy expansion

**Component:** `VacancyMatchPanel`

**Endpoint:** `GET /sponsor-licences/:id/vacancies`

The server requires:

- `liveness = live`
- `lastVerifiedAt` within six hours

The client repeats:

- `linkStatus === "live"`
- `linkVerified === true`

Rows show title, location, salary, posted date, live-link badge, match percentage, eligibility, missing requirements, explanation, Readiness Check, favorite, external apply, and Send CV when allowed.

Rows sort by match score, newer ID, and title.

## On-demand checks and scoring

Expanding an employer with no check triggers `POST /sponsor-licences/:id/check-vacancies`.

If scores are missing, the vacancy endpoint calls `scoreVacanciesForCompany`. A scoring failure leaves the vacancy list available with null scores.

Unlike Opportunities, this surface can perform discovery/scoring during panel expansion.

## Refresh controls

Candidate-accessible:

- Refresh visible page
- Up to 20 employer IDs
- 45-second in-memory per-user cooldown
- 24-hour result-cache awareness
- New checks/cache hits/errors summary

Admin-only:

- Check All Vacancies
- Optional region selection
- Progress polling
- Cache-hit/new-check/error counts

These are Sponsor-only operational controls.

## Liveness and counts

Fresh live URL-backed, source-classified rows determine:

- `hasVacancies`
- `storedVacancyCount`
- `withVacancies`
- Has Vacancies filter
- Vacancy statistics
- Expanded actionable rows

The vacancy-stat endpoint requires live liveness, six-hour freshness, non-null source type, and non-null URL.

Non-live evidence is removed before rendering. Users see aggregate fallback copy but not the distinction between dead, stale, unverified, and inconclusive stored records.

## External apply and careers fallback

Vacancy apply uses `openTrackedSponsorVacancy`. It adds `ref=jobsage`, emits the extension event, and opens the posting.

Careers fallback uses `handleWebsiteApply`, which is extension-gated and opens the careers URL. If none exists, it expands Contact and shows guidance.

Neither helper creates an application tracker record.

The detail sheet also offers “View original posting.”

## Vacancy-specific Send CV

Requirements:

- Employer-level `sendCvEligible`
- Uploaded CV
- `isEligible !== false`
- Fresh-live vacancy row
- Server-side direct-contact and liveness enforcement

Uses `SponsorVacancyApplyModal` with raw `vacancyId`, `companyId`, exact URL, and `requireDirectContact`.

This differs from Opportunities, where eligibility gaps are advisory.

## Employer-level speculative CV

Available for direct-contact employers without tying outreach to a particular vacancy. It remains available when no vacancy is found or when stored vacancies have no actionable links. This is correctly different from vacancy-specific Send CV.

## Contact panel

Shows stored/enriched website, email, phone, address, refresh/discover controls, Google search, and Companies House links.

Endpoint:

- `POST /sponsor-licences/:id/enrich`

Risk:

- Uses OpenAI `gpt-4o` with `web_search_preview`.
- This is paid AI web search.
- It can overwrite stored fields with null when research fails.
- It should not be reused under the current no-paid-search and provenance/no-overwrite constraints.

## Bookmarks

Sponsor bookmarks are employer-level:

- `POST /sponsor-licences/:id/bookmark`
- `DELETE /sponsor-licences/:id/bookmark`

They support optimistic updates, rollback, bookmark filtering, sector counts, and behavioral ranking input.

Vacancy favorites remain separate and use the shared `FavoriteButton`.

## Readiness Check

Sponsor vacancies use the shared `GapAnalysisSheet` and shared monthly quota. The page displays match score, eligibility, missing requirements, explanation, and full Readiness Check.

## Sponsor-only failure and empty states

- Register sync failure warning
- Register not classified
- No matching sponsors
- Failed register load
- Vacancy check in progress
- No current vacancies
- Historical openings but no direct apply links
- No careers site
- Contact-enrichment failure
- Batch cooldown
- Batch partial failures
- Global scan progress

---

# Part 3 — Parity matrix

| Feature | Opportunities | Sponsor Licences | Gap | Suggested approach | Risk/design note |
|---|---|---|---|---|---|
| Authentication | Authenticated candidate feed | Authenticated register | Already aligned | Reuse shared helper | Both APIs require authentication |
| Core object | Vacancy-first | Employer-first with expanded vacancies | Different-by-design | Keep different | Do not flatten the directory |
| Profession filtering | Excludes unrelated vacancies | Industry-based employers; vacancy category not shown consistently | Partial | Adapt for employer context | One employer may cover multiple professions |
| Region filtering | Vacancy target region and saved profile preference | Employer register region, session-only | Partial | Adapt for employer context | These are different geography concepts |
| Saved region preference | Shared with Professional Profile | Not consumed | Missing | Reuse shared helper | Label any new vacancy-region filter clearly |
| Source tabs | Board/company site separated | Mixed expanded list | Missing | Port Opportunities logic | Preserve source transparency |
| Board exclusions | LinkedIn/Indeed rejected in Send CV routes | No explicit Sponsor control | Partial | Reuse shared helper | Keep source policy server-safe |
| Contact inclusion | Requires some route | Register employers can exist without contact | Different-by-design | Keep different | Directory entries remain useful |
| Fresh-live vacancy list | Fresh-live for source tabs | Fresh-live for counts and expansion | Already aligned | Reuse shared helper | Six-hour standard aligned |
| Link status | Six explicit statuses | Same API contract | Already aligned | Reuse shared helper | OpenAPI wording should describe enum, not a boolean |
| Status presentation | Generic verified/warning copy | Non-live rows hidden | Partial | Adapt for employer context | Consider disabled evidence summary |
| Dead-as-email-only | Blocked in UI and server | Blocked in UI and server | Already aligned | Reuse shared helper | Main trust requirement satisfied |
| Exact URL identity | Server enforced | Same endpoint enforcement | Already aligned | Reuse shared helper | Prevents crafted submissions |
| Click-time link check | Main cards check asynchronously | Sponsor apply does not use same helper | Missing | Reuse shared helper | Must not block navigation |
| Freshness messaging | Server six hours; click helper twelve | Server six hours; discovery cache 24h | Partial | Reuse shared helper | Separate discovery from link health |
| Outbound extension event | Emitted | Emitted | Already aligned | Reuse shared helper | Trusted first-party event retained |
| Tracker click record | Main cards create `link_clicked`; other routes do not | Not created | Partial | Reuse shared helper | Highest-priority parity defect |
| Apply action | Vacancy URL or website fallback | Vacancy URL and careers fallback | Partial | Adapt for employer context | Careers homepage is not a vacancy |
| Smart Apply | Dedicated ATS-prefill modal | No equivalent | Missing | Port Opportunities logic | Clarify ATS support first |
| Extension gate | Apply routes gated | Vacancy/careers actions gated; informational anchors differ | Partial | Reuse shared helper | Distinguish apply intent from contact browsing |
| Vacancy Send CV | Direct contact plus live/none status | Direct contact plus live row | Already aligned | Reuse shared helper | Server gate shared |
| Email-only vacancy | Supported for genuine URL-less direct contact | Expansion is URL/live oriented | Partial | Adapt for employer context | Never infer email-only from a dead URL |
| Employer speculative CV | Not primary card flow | Explicit feature | Different-by-design | Keep different | Appropriate directory behavior |
| CV upload gate | Send CV redirects to documents | Sponsor disables or links to upload | Already aligned | Reuse shared helper | Copy differs |
| Eligibility gate | Advisory | Blocks Sponsor CV action when false | Partial | Product decision | Avoid page-dependent policy |
| Multiple CV selection | Shared modal | Shared modal | Already aligned | Reuse shared helper | Same component |
| Cover letter | Standalone and modal | Modal only | Partial | Port Opportunities logic | Optional convenience |
| AI outreach assistant | Send CV modal | Same modal | Already aligned | Reuse shared helper | Shared implementation |
| Readiness Check | Shared sheet/quota | Shared sheet/quota | Already aligned | Reuse shared helper | Record-specific endpoints |
| Match score | Unified vacancy ranking | Best vacancy score plus row scores | Partial | Adapt for employer context | Do not call it employer quality |
| Ranking bands | Apply First/Worth Considering/More | No comparable bands | Missing | Adapt for employer context | Simple row sort may be enough |
| AI Best Matches | Top-three dismissible queue | None | Missing | Port only if desired | Could undermine directory browsing |
| Dismiss/hide | AI-match dismissal | None | Missing | Adapt for employer context | Decide employer vs vacancy hiding |
| Vacancy favorite | Shared | Shared offset ID | Already aligned | Reuse shared helper | Verify outbound identity separately |
| Employer bookmark | Behavioral signal only | Full UI/filter | Different-by-design | Keep different | Sponsor-only capability |
| Search | Employer/title/location in Send CV | Employer only | Partial | Adapt for employer context | Global search is separate scope |
| Pagination | No visible pagination | 20 employers/page | Different-by-design | Keep different | Register requires pagination |
| Cache UI | AI-score cache labels | Discovery/check cache labels | Different-by-design | Keep different | Do not equate with link verification |
| Manual refresh | Retry role query | Recheck visible employers | Different-by-design | Keep different | Sponsor checks are expensive |
| Admin scan | Not exposed | Region-aware global scan | Different-by-design | Keep different | Operational feature |
| Register warning | Not applicable | Visible | Different-by-design | Keep different | Sponsor-only trust metadata |
| Vacancy detail | Eligibility summary/modal | Description/action bottom sheet | Partial | Port selected fields | Add requirements if supported |
| Sponsorship disclaimer | Licensed-sponsor tooltip | Register framing; limited vacancy copy | Partial | Reuse shared helper | Avoid vacancy-level inference |
| Safeguarding badges | Explicit | Missing in Sponsor row | Missing | Port Opportunities logic | Response fields may need expansion |
| Required registration | Displayed | Missing in Sponsor response/UI | Missing | Port Opportunities logic | Scoring may already know it |
| Application state | Applied/CV Sent role IDs | Mostly company-level CV Sent | Partial | Reuse shared helper | Keep company and vacancy states separate |
| Next matches | May show three recommendations | Modal supports this only in non-speculative mode | Partial | Keep/adapt | Clarify Sponsor semantics |
| Share/report | Not present | Not present | Already aligned | Not applicable | No parity work |
| Contact enrichment | Not a primary Opportunity action | AI web-search enrichment | Different-by-design | Defer/replace | Conflicts with current constraint |

---

# Part 4 — Implementation map

## Must-match: quality and trust

### 1. Unify outbound tracking semantics

Reuse:

- `RoleCard.trackAndOpen`
- `openTrackedOutbound`
- `openTrackedSponsorVacancy`
- Application `link_clicked` contract

Potential files:

- `artifacts/jobsage-web/src/lib/trackedOutbound.ts`
- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`
- Application route/specification as required

Every application-intent click should consistently create a tracker record, while careers-homepage visits remain distinguishable from exact-vacancy clicks. Avoid double creation where RoleCard already posts manually.

### 2. Reuse background liveness checks on Sponsor vacancy clicks

Reuse:

- `checkApplyLinkInBackground`
- `getGetSponsorLicenceVacanciesQueryKey`
- Six-hour status semantics

Navigation must remain immediate. A newly dead URL should invalidate the employer’s vacancy list/count without blocking the click.

### 3. Separate discovery-cache copy from link-verification copy

Keep these concepts separate:

- 24-hour employer vacancy discovery cache
- Six-hour exact URL verification

“Checked within 24 hours” must never look equivalent to “link verified.”

### 4. Preserve explicit sponsorship semantics

Reuse:

- `LicensedSponsorBadge`
- `sponsorshipStatus`
- `inferVacancySponsorshipStatus`

Register membership must remain employer-level. Vacancy-confirmed sponsorship must come only from vacancy evidence.

### 5. Do not reuse current AI contact enrichment

Exclude `POST /sponsor-licences/:id/enrich` from parity work until it is replaced with permitted stored/official-site evidence, provenance, and no-overwrite behavior.

## Should-match: expected candidate behavior

6. Choose one eligibility policy across both pages.

7. Add Sponsor vacancy-level profession, registration, safeguarding, and requirement presentation.

8. Add Sponsor source/board labels and shared board exclusions.

9. Align per-vacancy Applied/CV Sent state using the unified ID space.

10. Decide whether supported Sponsor vacancies receive the dedicated Smart Apply action.

11. Add vacancy title/location search while preserving employer search and employer pagination.

## Adapt: employer semantics

12. Keep employer register region and candidate vacancy region as separate concepts.

13. Keep employer score explicitly framed as the best visible vacancy score.

14. Use separate labels for:

- Apply on employer site
- Smart Apply
- Send CV for a vacancy
- Send CV speculatively

15. Consider a non-actionable evidence summary for stale/dead/unverified rows without making them clickable or email-only.

## Defer or skip

- Opportunities self-promotion card
- Dormant tracker tab inside Opportunities
- AI Best Matches on the employer directory unless product intent changes
- Share/report actions
- Paid AI web-search enrichment
- Full Opportunities ranking bands inside every employer
- Company-wide scan controls on Opportunities

---

# Part 5 — Open questions

1. Should Sponsor Licence vacancies offer the ATS Smart Apply flow, or only tracked external Apply plus Send CV?
2. Should not-yet-eligible candidates continue with advisory messaging on both surfaces?
3. Should Sponsor Licences consume the saved Professional Profile region preference?
4. Should vacancy-region filtering occur inside each employer panel or across the employer list?
5. Should Sponsor vacancy clicks create website application tracker rows immediately?
6. Should careers-homepage visits count as applications, leads, or only outbound navigation?
7. Should stale/unverified/dead evidence be visible as non-actionable evidence?
8. Should Sponsor vacancy rows show `confirmed`, `not_offered`, or `unknown` sponsorship status?
9. Should Sponsor Licences expose the existing `directContactOnly` filter?
10. Should Sponsor rows show NHS Jobs/Reed/company-site source badges?
11. Should LinkedIn/Indeed restrictions apply to Sponsor actions outside the Send CV tab?
12. Should employer-level CV Sent be shown separately from vacancy-level CV Sent?
13. Should the client click-check window be changed to six hours?
14. Should Sponsor vacancy details include safeguarding and required-registration fields?
15. Is the dormant Applications tab intended to return, or should it be treated as obsolete?
16. Should contact enrichment be removed/replaced because it uses paid AI web search?

---

# Parity backlog

## P0 — Trust and consistency

1. Unify outbound application tracking across every vacancy and careers-site action.
2. Add non-blocking Sponsor vacancy link checking using the shared checker.
3. Resolve the six-hour versus twelve-hour exact-link freshness mismatch.
4. Separate 24-hour discovery-cache messaging from six-hour URL verification.
5. Expose explicit vacancy sponsorship status without conflating it with licence membership.
6. Remove paid AI web search from any parity implementation plan.

## P1 — Action parity

7. Choose and enforce one eligibility policy across Opportunities and Sponsor Licences.
8. Add exact vacancy Applied/CV Sent state to Sponsor rows.
9. Add Sponsor vacancy source/board labels and shared board exclusions.
10. Decide whether eligible Sponsor vacancies receive the dedicated Smart Apply action.
11. Return/display required registration and safeguarding requirements on Sponsor vacancies.

## P2 — Discovery parity

12. Add vacancy-title/location search while preserving employer search.
13. Add optional candidate-preferred vacancy-region filtering without replacing register-region filtering.
14. Expose the existing direct-contact-only server filter if the product wants a Send CV-oriented employer view.
15. Consider hidden/dismissed vacancy behavior separately from employer bookmarks.

## Intentionally different

- Sector-first employer browsing
- Employer bookmarks
- Register route/rating metadata
- Careers-site fallback
- Employer-level speculative CV
- Sponsor sync/check controls
- Employer pagination
- Best-vacancy score as an employer sorting aid# Full audit: Opportunities → Sponsor Licences parity

**Scope:** Read-only audit. No implementation, migration, enrichment, publishing, or code changes were performed for the audit itself.

## Executive findings

The recent liveness work aligns the most important trust boundary:

- Both surfaces use fresh, confirmed-live Sponsor Licence vacancy links.
- The shared freshness standard is six hours.
- Dead URL evidence is preserved rather than reinterpreted as email-only.
- Vacancy-specific Send CV is independently enforced by the server.
- Employer-level speculative outreach and careers-site fallback remain separate.

The remaining parity gaps are:

1. **Outbound tracking is inconsistent.** Main Opportunities cards create a `link_clicked` application record, while the best-match strip, Send CV apply-only rows, and Sponsor Licence links use `openTrackedOutbound`, which only emits the extension event and opens the URL.
2. **Smart Apply semantics differ.** Opportunities exposes `SmartApplyModal`; Sponsor Licences primarily exposes tracked external Apply and CV outreach.
3. **Eligibility behavior differs.** Opportunities treats gaps as advisory; Sponsor Licences disables JOBSAGE CV submission when `isEligible === false`.
4. **Filtering and ranking differ.** Opportunities is candidate/vacancy-centric; Sponsor Licences is employer-centric, paginated, and register-metadata driven.
5. **Liveness states are less visible than the API contract.** Sponsor Licence rows are prefiltered to live, so users rarely see why stored evidence is unavailable.
6. **Contact enrichment currently uses paid AI web search.** `POST /sponsor-licences/:id/enrich` invokes `gpt-4o` with `web_search_preview`, which conflicts with the current no-paid-search constraint and should not be reused for parity work.

---

# Part 1 — Opportunities inventory

## Main surface

**File:** `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`

**Component:** `OpportunitiesPage`

**Main endpoint:** `GET /api/roles`

The page uses `useAuth`. The roles endpoint returns `401` when unauthenticated. AI matches are enabled only after authentication settles.

### Tabs

| Tab | Request | Purpose |
|---|---|---|
| `board` | `/roles?source=job_board` | Apply through supported job boards |
| `employers` | `/roles?source=company_site` | Apply through official company sites |
| `sendcv` | `/roles` without source | Find email-capable or verified-apply vacancies |

The initial tab can be selected through `?tab=`, but changing tabs does not update the URL.

### Request behavior

Relevant symbols:

- `OPPORTUNITIES_TIMEOUT_MS`
- `listMatchedRolesWithTimeout`
- `useQuery`
- `getListMatchedRolesQueryKey`

Behavior:

- 15-second client timeout.
- One retry.
- Previous data remains visible during refetch.
- Manual Retry action.
- Errors distinguish no-data failure from failure while displaying cached/previous data.
- No client pagination; the returned ranked catalogue is rendered directly.

## Server-side role assembly

**File:** `artifacts/api-server/src/routes/roles.ts`

`GET /roles` merges:

1. Curated/imported `roles`
2. Published employer `jobListings`
3. AI-discovered `sponsorLicenceVacancies`

Relevant symbols:

- `HAS_CONTACT_INFO`
- `employerJobHasContactInfo`
- `fetchSponsorVacanciesAsRoles`
- `presentApplyLink`
- `roleDedupKey`
- `SPONSOR_VACANCY_ID_OFFSET`
- `candidateBoardSourceForProfession`
- `hasFreshCandidateBoardSnapshot`
- `refreshCandidateBoardVacancies`

### ID spaces

- Curated roles: native role ID
- Employer listings: `jobListing.id + 1_000_000`
- Sponsor vacancies: `sponsorVacancy.id + 2_000_000`

### Contact inclusion

Candidate-facing roles must have at least one of:

- Non-dead apply URL
- Contact email
- Contact phone
- Contact website

A dead apply URL alone does not qualify as contact information.

### Profession and source filtering

Relevant symbols:

- `professionCategoryFor`
- `opportunityCategoriesMatch`
- `storedRegulatorMatchesCategory`
- `employerJobTargetsCategory`
- `classifyVacancyCategory`
- `isManualLabourTitle`

Behavior:

- Candidate profession maps to an opportunity category.
- Clearly mismatched categories are excluded.
- Manual-labour Sponsor Licence vacancies are excluded.
- Ambiguous Sponsor Licence vacancies are removed from the candidate response when `classifiedRelevant === false`.
- Candidates without a supported profession category receive an empty list.

### Deduplication

`roleDedupKey` normalizes employer/title pairs. Sponsor company-site vacancies are deduplicated against curated and employer-posted roles. Job-board handling intentionally differs so legitimate board records remain available.

### Region filtering

Server symbols:

- `roleMatchesPreferredRegions`
- `regionsOverlap`
- Candidate `preferredRegion`

Client symbols:

- `filterOpportunities`
- `hasRegionOverlap`
- `UK_REGIONS`

Unknown/empty target regions remain visible. `National / Multiple Regions` remains visible for regional selections. Client-selected regions are saved to the Professional Profile after a 300 ms debounce.

### Background discovery

When a candidate-specific board snapshot is stale or missing, `/roles?source=job_board` remains database-first and starts `refreshCandidateBoardVacancies(profile)` asynchronously. The current request does not wait for the discovery operation.

## Eligibility and safeguarding

Relevant symbols:

- `assessSponsorshipFeasibility`
- `getRoleEligibilityGaps`
- `getRoleSafeguarding`
- `assessSafeguarding`
- `safeguardingBlocksEligibility`
- `safeguardingGapText`

Fields include:

- `isEligible`
- `eligibilityGaps`
- `matchScore`
- `safeguarding`
- `requiredRegistration`
- `requiredDbsClearanceLevel`
- `requiredSafeguardingLevel`
- `sponsorshipOffered`
- `licensedSponsor`

Presentation:

- “Eligible Now”
- “Not Yet Eligible”
- DBS/safeguarding status badge
- Expandable eligibility notes
- Role-detail modal
- Remediation-path link

Eligibility notes are advisory on Opportunities. An ineligible candidate can still open the application flow; the action label changes from “Smart Apply” to “Apply.”

## Sponsorship presentation

Relevant fields:

- `licensedSponsor`
- `sponsorshipOffered`
- `sponsorshipStatus`

`LicensedSponsorBadge` explicitly warns that register membership does not prove that the vacancy offers sponsorship.

Sponsor vacancy inference uses:

- `inferVacancySponsorshipStatus`
- `confirmed`
- `not_offered`
- `unknown`

The card prominently shows licensed-sponsor membership, but does not consistently show all vacancy-level sponsorship states.

## Ranking

Server symbols:

- `computeMatchScore`
- `batchScoreRoles`
- `candidateMatchScoresTable`
- `sponsorLicenceVacancyScoresTable`
- `calculateBehaviouralRanking`
- `compareOpportunityRanking`
- `qualifiesForApplyFirst`
- `TOP_MATCH_MIN_SCORE`
- `careerFocusBoost`
- `specialtyBoost`
- `PENDING_AI_SCORE`

Ranking signals include eligibility, sponsorship fit, registration requirements, cached AI score, Sponsor vacancy score, specialty/career focus, saved vacancies, employer bookmarks, prior applications, and link clicks.

Client grouping:

- `groupRankedOpportunities`
- Up to five recommended roles
- Up to five roles at or above `CONSIDER_MIN_SCORE` (`40`)
- Remaining roles in “More Opportunities”

Bands:

- “Recommended — Apply First”
- “Worth Considering”
- “More Opportunities”

The client uses server order and does not perform an independent sort.

## Best Matches strip

**Component:** `BestMatchesStrip`

**Data:** `GET /roles/my-matches` through `useGetMyMatches({ limit: 200, source })`

Behavior:

- Shows up to three undismissed, unapplied AI matches.
- Shows score, explanation, reason, employer, and location.
- Allows favorite, dismiss, apply, employer website, Smart Apply, or View Path.
- Shows “Updated today” versus “Just scored.”
- Invalidates the main role list when matching settles.

Dismissal is optimistic locally, persisted through the dismiss endpoint, and has no Sponsor Licence equivalent.

## Favorites and saved state

**Component:** `FavoriteButton`

Used in best-match cards, role cards, Sponsor vacancy rows, and vacancy sheets. Sponsor vacancy favorites use the unified offset ID. Favorite activity contributes to behavioral ranking.

Opportunities has no current share/report action and no general-purpose hide action on normal role cards. Dismiss is limited to the AI queue.

## Vacancy liveness

**Files:**

- `artifacts/api-server/src/lib/vacancyLiveness.ts`
- `artifacts/api-server/src/lib/sponsorVacancyRoles.ts`

**Symbols:**

- `getVacancyLinkStatus`
- `presentApplyLink`
- `RECENT_VERIFY_SKIP_MS`

Statuses:

- `none`
- `live`
- `dead`
- `unverified`
- `inconclusive`
- `stale`

Server freshness is six hours. `presentApplyLink` preserves the stored URL and separately returns:

- `linkStatus`
- `linkVerified`
- `linkCheckedAt`

Sponsor-derived board and company-site rows require a fresh live deep link through `requireSpecificVacancyUrl` and `onlyVerifiedLive`.

### Click-time background check

Client symbols:

- `checkApplyLinkInBackground`
- `isFreshLiveApplyLink`
- `CLICK_HEALTH_TIMEOUT_MS`
- `FRESH_LINK_WINDOW_MS`

Behavior:

- Opens the vacancy immediately.
- Performs a bounded 1.5-second background check.
- Invalidates roles and matches if the URL is dead.
- Network failures/timeouts are inconclusive and do not block navigation.

Important mismatch: the client click helper skips checks for 12 hours, while the candidate-facing server standard is six hours.

### Liveness copy

Main cards show:

- “Link verified”
- “May not be active”
- “Link not yet verified”
- Dead-listing warning after a background check

Stale and inconclusive are not separately communicated.

## Apply and outbound tracking

### Main RoleCard

Relevant symbols:

- `trackAndOpen`
- `doApplyClick`
- `handleApplyClick`

Behavior:

1. Adds `ref=jobsage`.
2. Posts an application record with `applicationType: website` and `status: link_clicked`.
3. Emits `jobsage:outbound-application`.
4. Opens the URL.
5. Starts the background health check for vacancy URLs.
6. May show the extension nudge.

Outbound clicks are gated through `useExtensionGate`.

### Shared outbound helper

**File:** `artifacts/jobsage-web/src/lib/trackedOutbound.ts`

**Symbols:**

- `openTrackedOutbound`
- `openTrackedSponsorVacancy`

The helper adds `ref=jobsage`, emits the trusted extension event, and opens a new tab. It does not create an application record.

Therefore:

- Main RoleCard apply: extension event plus tracker record
- Best Matches apply: extension event only
- Send CV apply-only row: extension event only
- Sponsor vacancy/careers link: extension event only

This is the most important tracking parity gap.

## Apply URL and website fallback

**Helper:** `getOpportunityApplyAction`

Behavior:

- Exact vacancy URL takes priority.
- Contact website becomes “Open employer website” if no vacancy URL exists.
- Website URLs are normalized with `https://`.
- Main cards explain that the fallback opens the employer site rather than a verified vacancy.

LinkedIn and Indeed are rejected as Send CV apply routes through `isDisallowedSendCvApplyUrl` and `hasUsableSendCvApplyRoute`.

## Smart Apply

Components:

- `SmartApplyModal`
- `SmartApplyAssistant`
- `SmartApplyExtensionBanner`
- `SmartApplyExtensionNudge`
- `useExtensionGate`

The server owns application-critical profile readiness. Optional search preferences do not block Smart Apply. Successful submission invalidates roles and applications.

Sponsor Licences does not expose this exact ATS-prefill modal.

## Send CV tab

Helpers:

- `canSendCvForVacancy`
- `hasUsableSendCvApplyRoute`
- `shouldShowOnSendCvTab`
- `shouldShowSendCv`

Rows are shown when:

- Direct-email capability exists and the URL is absent or live, or
- A fresh, verified, non-LinkedIn/non-Indeed apply route exists

Rows are grouped by normalized employer name and searchable by employer, title, or location.

Actions include:

- Send/Resend CV
- Upload CV to send
- Apply via board/company site
- Smart Apply
- View live vacancy

`sendCvEligible === true` remains the strict direct-email capability flag.

## Send CV submission

**Component:** `SponsorVacancyApplyModal`

**Endpoint:** `POST /speculative-applications`

Payload may include:

- `companyName`
- `sponsorLicenceId`
- `vacancyTitle`
- `vacancyRef`
- `roleId`
- `vacancyUrl`
- `sourceType`
- `boardName`
- `requireDirectContact`
- `notes`
- `cvDocumentId`

Vacancy references:

- `role:<merged role id>`
- `sponsor-vacancy:<raw sponsor vacancy id>`

Server enforcement includes authentication, profile/JOBSAGE alias requirements, PDF CV retrieval, direct-contact requirements, stored-vacancy resolution, exact URL identity, fresh-live validation, persisted delivery attempts, delivery outcome, candidate confirmation, tracker/audit updates, and resend support.

The modal also supports multiple CVs, AI outreach assistance, AI cover letters, existing-send warnings, and next-match recommendations.

## Cover Letter and Readiness Check

Cover Letter:

- `CoverLetterModal`
- `useCoverLetterStream`
- `POST /cover-letter/generate-stream`
- Editable output, copy, download, regenerate, retry

Readiness Check:

- `GapAnalysisSheet`
- Sponsor vacancies use `/sponsor-licences/vacancies/:id/gap-analysis`
- Other roles use `/opportunities/roles/:id/gap-analysis`
- Shared monthly allowance of ten newly generated analyses

## Empty and error states

Opportunities distinguishes loading, timeout/error, stale-data retry, no profile, unsupported profession, no region matches, no Send CV routes, no AI matches, reviewed-all matches, missing CV, cover-letter failure, and submission failure.

## Dormant code

`ApplicationsTab`, `AppCard`, and application status configuration exist in `OpportunitiesPage.tsx`, but the current top-level tab union only contains `board`, `employers`, and `sendcv`. The tracker code is not reachable from this page.

## Responsive behavior

The web page is responsive rather than functionally different:

- Tab labels are hidden on small screens.
- Cards collapse to one column.
- Modals become bottom sheets.
- Buttons wrap.

---

# Part 2 — Sponsor Licences inventory

## Main surface

**Files:**

- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/api-server/src/routes/sponsorLicences.ts`

Title: “Visa Sponsoring Employers”

All page APIs require authentication. The global scan is admin-only.

## Sector-first navigation

Data:

- `GET /sponsor-licences/industry-counts`
- `GET /sponsor-licences/industries`

The initial view shows sector icons, sponsor counts, bookmark counts, overall totals, employers with JOBSAGE vacancies, register sync date, and a vacancy-index banner.

This employer/sector browsing experience has no direct Opportunities equivalent.

## Employer list

**Route:** `GET /sponsor-licences`

Parameters:

- `search`
- `route`
- `industry`
- `region[]`
- `hasVacancies`
- `bookmarkedOnly`
- `directContactOnly` (server-supported but not exposed in current page controls)
- `page`
- `limit`

Client behavior:

- 350 ms search debounce
- 20 employers per page
- Previous page retained while filters load
- Page reset after filter changes

## Employer filters

Available:

- Organisation name
- Worker route
- Industry
- Multiple register regions
- Has Vacancies
- Bookmarked
- Sector selection

Not available:

- Candidate profession/category
- Candidate saved profile regions
- Vacancy title/location search
- Vacancy source
- Vacancy sponsorship-confirmed state
- Vacancy eligibility
- Vacancy score threshold
- Direct Contact Only UI
- Explicit LinkedIn/Indeed filter

Sponsor region filtering uses register region, not vacancy target region.

## Employer ranking

Server ordering:

1. Employers with fresh live vacancies
2. Never-checked employers
3. Checked employers with no fresh live vacancies

Within live employers:

1. Best stored match score descending
2. Fresh-live vacancy count descending
3. Organisation name alphabetically

This is intentionally employer-centric and not equivalent to Opportunities’ vacancy ranking.

## Employer metadata

Cards show organisation, town/city, county, region, route, sub-route, rating, industry styling, fresh-live vacancy count, CV Sent state, last check time, 24-hour discovery-cache status, best-fit percentage, and bookmark state.

Register metadata is not presented as vacancy sponsorship proof.

## Vacancy expansion

**Component:** `VacancyMatchPanel`

**Endpoint:** `GET /sponsor-licences/:id/vacancies`

The server requires:

- `liveness = live`
- `lastVerifiedAt` within six hours

The client repeats:

- `linkStatus === "live"`
- `linkVerified === true`

Rows show title, location, salary, posted date, live-link badge, match percentage, eligibility, missing requirements, explanation, Readiness Check, favorite, external apply, and Send CV when allowed.

Rows sort by match score, newer ID, and title.

## On-demand checks and scoring

Expanding an employer with no check triggers `POST /sponsor-licences/:id/check-vacancies`.

If scores are missing, the vacancy endpoint calls `scoreVacanciesForCompany`. A scoring failure leaves the vacancy list available with null scores.

Unlike Opportunities, this surface can perform discovery/scoring during panel expansion.

## Refresh controls

Candidate-accessible:

- Refresh visible page
- Up to 20 employer IDs
- 45-second in-memory per-user cooldown
- 24-hour result-cache awareness
- New checks/cache hits/errors summary

Admin-only:

- Check All Vacancies
- Optional region selection
- Progress polling
- Cache-hit/new-check/error counts

These are Sponsor-only operational controls.

## Liveness and counts

Fresh live URL-backed, source-classified rows determine:

- `hasVacancies`
- `storedVacancyCount`
- `withVacancies`
- Has Vacancies filter
- Vacancy statistics
- Expanded actionable rows

The vacancy-stat endpoint requires live liveness, six-hour freshness, non-null source type, and non-null URL.

Non-live evidence is removed before rendering. Users see aggregate fallback copy but not the distinction between dead, stale, unverified, and inconclusive stored records.

## External apply and careers fallback

Vacancy apply uses `openTrackedSponsorVacancy`. It adds `ref=jobsage`, emits the extension event, and opens the posting.

Careers fallback uses `handleWebsiteApply`, which is extension-gated and opens the careers URL. If none exists, it expands Contact and shows guidance.

Neither helper creates an application tracker record.

The detail sheet also offers “View original posting.”

## Vacancy-specific Send CV

Requirements:

- Employer-level `sendCvEligible`
- Uploaded CV
- `isEligible !== false`
- Fresh-live vacancy row
- Server-side direct-contact and liveness enforcement

Uses `SponsorVacancyApplyModal` with raw `vacancyId`, `companyId`, exact URL, and `requireDirectContact`.

This differs from Opportunities, where eligibility gaps are advisory.

## Employer-level speculative CV

Available for direct-contact employers without tying outreach to a particular vacancy. It remains available when no vacancy is found or when stored vacancies have no actionable links. This is correctly different from vacancy-specific Send CV.

## Contact panel

Shows stored/enriched website, email, phone, address, refresh/discover controls, Google search, and Companies House links.

Endpoint:

- `POST /sponsor-licences/:id/enrich`

Risk:

- Uses OpenAI `gpt-4o` with `web_search_preview`.
- This is paid AI web search.
- It can overwrite stored fields with null when research fails.
- It should not be reused under the current no-paid-search and provenance/no-overwrite constraints.

## Bookmarks

Sponsor bookmarks are employer-level:

- `POST /sponsor-licences/:id/bookmark`
- `DELETE /sponsor-licences/:id/bookmark`

They support optimistic updates, rollback, bookmark filtering, sector counts, and behavioral ranking input.

Vacancy favorites remain separate and use the shared `FavoriteButton`.

## Readiness Check

Sponsor vacancies use the shared `GapAnalysisSheet` and shared monthly quota. The page displays match score, eligibility, missing requirements, explanation, and full Readiness Check.

## Sponsor-only failure and empty states

- Register sync failure warning
- Register not classified
- No matching sponsors
- Failed register load
- Vacancy check in progress
- No current vacancies
- Historical openings but no direct apply links
- No careers site
- Contact-enrichment failure
- Batch cooldown
- Batch partial failures
- Global scan progress

---

# Part 3 — Parity matrix

| Feature | Opportunities | Sponsor Licences | Gap | Suggested approach | Risk/design note |
|---|---|---|---|---|---|
| Authentication | Authenticated candidate feed | Authenticated register | Already aligned | Reuse shared helper | Both APIs require authentication |
| Core object | Vacancy-first | Employer-first with expanded vacancies | Different-by-design | Keep different | Do not flatten the directory |
| Profession filtering | Excludes unrelated vacancies | Industry-based employers; vacancy category not shown consistently | Partial | Adapt for employer context | One employer may cover multiple professions |
| Region filtering | Vacancy target region and saved profile preference | Employer register region, session-only | Partial | Adapt for employer context | These are different geography concepts |
| Saved region preference | Shared with Professional Profile | Not consumed | Missing | Reuse shared helper | Label any new vacancy-region filter clearly |
| Source tabs | Board/company site separated | Mixed expanded list | Missing | Port Opportunities logic | Preserve source transparency |
| Board exclusions | LinkedIn/Indeed rejected in Send CV routes | No explicit Sponsor control | Partial | Reuse shared helper | Keep source policy server-safe |
| Contact inclusion | Requires some route | Register employers can exist without contact | Different-by-design | Keep different | Directory entries remain useful |
| Fresh-live vacancy list | Fresh-live for source tabs | Fresh-live for counts and expansion | Already aligned | Reuse shared helper | Six-hour standard aligned |
| Link status | Six explicit statuses | Same API contract | Already aligned | Reuse shared helper | OpenAPI wording should describe enum, not a boolean |
| Status presentation | Generic verified/warning copy | Non-live rows hidden | Partial | Adapt for employer context | Consider disabled evidence summary |
| Dead-as-email-only | Blocked in UI and server | Blocked in UI and server | Already aligned | Reuse shared helper | Main trust requirement satisfied |
| Exact URL identity | Server enforced | Same endpoint enforcement | Already aligned | Reuse shared helper | Prevents crafted submissions |
| Click-time link check | Main cards check asynchronously | Sponsor apply does not use same helper | Missing | Reuse shared helper | Must not block navigation |
| Freshness messaging | Server six hours; click helper twelve | Server six hours; discovery cache 24h | Partial | Reuse shared helper | Separate discovery from link health |
| Outbound extension event | Emitted | Emitted | Already aligned | Reuse shared helper | Trusted first-party event retained |
| Tracker click record | Main cards create `link_clicked`; other routes do not | Not created | Partial | Reuse shared helper | Highest-priority parity defect |
| Apply action | Vacancy URL or website fallback | Vacancy URL and careers fallback | Partial | Adapt for employer context | Careers homepage is not a vacancy |
| Smart Apply | Dedicated ATS-prefill modal | No equivalent | Missing | Port Opportunities logic | Clarify ATS support first |
| Extension gate | Apply routes gated | Vacancy/careers actions gated; informational anchors differ | Partial | Reuse shared helper | Distinguish apply intent from contact browsing |
| Vacancy Send CV | Direct contact plus live/none status | Direct contact plus live row | Already aligned | Reuse shared helper | Server gate shared |
| Email-only vacancy | Supported for genuine URL-less direct contact | Expansion is URL/live oriented | Partial | Adapt for employer context | Never infer email-only from a dead URL |
| Employer speculative CV | Not primary card flow | Explicit feature | Different-by-design | Keep different | Appropriate directory behavior |
| CV upload gate | Send CV redirects to documents | Sponsor disables or links to upload | Already aligned | Reuse shared helper | Copy differs |
| Eligibility gate | Advisory | Blocks Sponsor CV action when false | Partial | Product decision | Avoid page-dependent policy |
| Multiple CV selection | Shared modal | Shared modal | Already aligned | Reuse shared helper | Same component |
| Cover letter | Standalone and modal | Modal only | Partial | Port Opportunities logic | Optional convenience |
| AI outreach assistant | Send CV modal | Same modal | Already aligned | Reuse shared helper | Shared implementation |
| Readiness Check | Shared sheet/quota | Shared sheet/quota | Already aligned | Reuse shared helper | Record-specific endpoints |
| Match score | Unified vacancy ranking | Best vacancy score plus row scores | Partial | Adapt for employer context | Do not call it employer quality |
| Ranking bands | Apply First/Worth Considering/More | No comparable bands | Missing | Adapt for employer context | Simple row sort may be enough |
| AI Best Matches | Top-three dismissible queue | None | Missing | Port only if desired | Could undermine directory browsing |
| Dismiss/hide | AI-match dismissal | None | Missing | Adapt for employer context | Decide employer vs vacancy hiding |
| Vacancy favorite | Shared | Shared offset ID | Already aligned | Reuse shared helper | Verify outbound identity separately |
| Employer bookmark | Behavioral signal only | Full UI/filter | Different-by-design | Keep different | Sponsor-only capability |
| Search | Employer/title/location in Send CV | Employer only | Partial | Adapt for employer context | Global search is separate scope |
| Pagination | No visible pagination | 20 employers/page | Different-by-design | Keep different | Register requires pagination |
| Cache UI | AI-score cache labels | Discovery/check cache labels | Different-by-design | Keep different | Do not equate with link verification |
| Manual refresh | Retry role query | Recheck visible employers | Different-by-design | Keep different | Sponsor checks are expensive |
| Admin scan | Not exposed | Region-aware global scan | Different-by-design | Keep different | Operational feature |
| Register warning | Not applicable | Visible | Different-by-design | Keep different | Sponsor-only trust metadata |
| Vacancy detail | Eligibility summary/modal | Description/action bottom sheet | Partial | Port selected fields | Add requirements if supported |
| Sponsorship disclaimer | Licensed-sponsor tooltip | Register framing; limited vacancy copy | Partial | Reuse shared helper | Avoid vacancy-level inference |
| Safeguarding badges | Explicit | Missing in Sponsor row | Missing | Port Opportunities logic | Response fields may need expansion |
| Required registration | Displayed | Missing in Sponsor response/UI | Missing | Port Opportunities logic | Scoring may already know it |
| Application state | Applied/CV Sent role IDs | Mostly company-level CV Sent | Partial | Reuse shared helper | Keep company and vacancy states separate |
| Next matches | May show three recommendations | Modal supports this only in non-speculative mode | Partial | Keep/adapt | Clarify Sponsor semantics |
| Share/report | Not present | Not present | Already aligned | Not applicable | No parity work |
| Contact enrichment | Not a primary Opportunity action | AI web-search enrichment | Different-by-design | Defer/replace | Conflicts with current constraint |

---

# Part 4 — Implementation map

## Must-match: quality and trust

### 1. Unify outbound tracking semantics

Reuse:

- `RoleCard.trackAndOpen`
- `openTrackedOutbound`
- `openTrackedSponsorVacancy`
- Application `link_clicked` contract

Potential files:

- `artifacts/jobsage-web/src/lib/trackedOutbound.ts`
- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`
- Application route/specification as required

Every application-intent click should consistently create a tracker record, while careers-homepage visits remain distinguishable from exact-vacancy clicks. Avoid double creation where RoleCard already posts manually.

### 2. Reuse background liveness checks on Sponsor vacancy clicks

Reuse:

- `checkApplyLinkInBackground`
- `getGetSponsorLicenceVacanciesQueryKey`
- Six-hour status semantics

Navigation must remain immediate. A newly dead URL should invalidate the employer’s vacancy list/count without blocking the click.

### 3. Separate discovery-cache copy from link-verification copy

Keep these concepts separate:

- 24-hour employer vacancy discovery cache
- Six-hour exact URL verification

“Checked within 24 hours” must never look equivalent to “link verified.”

### 4. Preserve explicit sponsorship semantics

Reuse:

- `LicensedSponsorBadge`
- `sponsorshipStatus`
- `inferVacancySponsorshipStatus`

Register membership must remain employer-level. Vacancy-confirmed sponsorship must come only from vacancy evidence.

### 5. Do not reuse current AI contact enrichment

Exclude `POST /sponsor-licences/:id/enrich` from parity work until it is replaced with permitted stored/official-site evidence, provenance, and no-overwrite behavior.

## Should-match: expected candidate behavior

6. Choose one eligibility policy across both pages.

7. Add Sponsor vacancy-level profession, registration, safeguarding, and requirement presentation.

8. Add Sponsor source/board labels and shared board exclusions.

9. Align per-vacancy Applied/CV Sent state using the unified ID space.

10. Decide whether supported Sponsor vacancies receive the dedicated Smart Apply action.

11. Add vacancy title/location search while preserving employer search and employer pagination.

## Adapt: employer semantics

12. Keep employer register region and candidate vacancy region as separate concepts.

13. Keep employer score explicitly framed as the best visible vacancy score.

14. Use separate labels for:

- Apply on employer site
- Smart Apply
- Send CV for a vacancy
- Send CV speculatively

15. Consider a non-actionable evidence summary for stale/dead/unverified rows without making them clickable or email-only.

## Defer or skip

- Opportunities self-promotion card
- Dormant tracker tab inside Opportunities
- AI Best Matches on the employer directory unless product intent changes
- Share/report actions
- Paid AI web-search enrichment
- Full Opportunities ranking bands inside every employer
- Company-wide scan controls on Opportunities

---

# Part 5 — Open questions

1. Should Sponsor Licence vacancies offer the ATS Smart Apply flow, or only tracked external Apply plus Send CV?
2. Should not-yet-eligible candidates continue with advisory messaging on both surfaces?
3. Should Sponsor Licences consume the saved Professional Profile region preference?
4. Should vacancy-region filtering occur inside each employer panel or across the employer list?
5. Should Sponsor vacancy clicks create website application tracker rows immediately?
6. Should careers-homepage visits count as applications, leads, or only outbound navigation?
7. Should stale/unverified/dead evidence be visible as non-actionable evidence?
8. Should Sponsor vacancy rows show `confirmed`, `not_offered`, or `unknown` sponsorship status?
9. Should Sponsor Licences expose the existing `directContactOnly` filter?
10. Should Sponsor rows show NHS Jobs/Reed/company-site source badges?
11. Should LinkedIn/Indeed restrictions apply to Sponsor actions outside the Send CV tab?
12. Should employer-level CV Sent be shown separately from vacancy-level CV Sent?
13. Should the client click-check window be changed to six hours?
14. Should Sponsor vacancy details include safeguarding and required-registration fields?
15. Is the dormant Applications tab intended to return, or should it be treated as obsolete?
16. Should contact enrichment be removed/replaced because it uses paid AI web search?

---

# Parity backlog

## P0 — Trust and consistency

1. Unify outbound application tracking across every vacancy and careers-site action.
2. Add non-blocking Sponsor vacancy link checking using the shared checker.
3. Resolve the six-hour versus twelve-hour exact-link freshness mismatch.
4. Separate 24-hour discovery-cache messaging from six-hour URL verification.
5. Expose explicit vacancy sponsorship status without conflating it with licence membership.
6. Remove paid AI web search from any parity implementation plan.

## P1 — Action parity

7. Choose and enforce one eligibility policy across Opportunities and Sponsor Licences.
8. Add exact vacancy Applied/CV Sent state to Sponsor rows.
9. Add Sponsor vacancy source/board labels and shared board exclusions.
10. Decide whether eligible Sponsor vacancies receive the dedicated Smart Apply action.
11. Return/display required registration and safeguarding requirements on Sponsor vacancies.

## P2 — Discovery parity

12. Add vacancy-title/location search while preserving employer search.
13. Add optional candidate-preferred vacancy-region filtering without replacing register-region filtering.
14. Expose the existing direct-contact-only server filter if the product wants a Send CV-oriented employer view.
15. Consider hidden/dismissed vacancy behavior separately from employer bookmarks.

## Intentionally different

- Sector-first employer browsing
- Employer bookmarks
- Register route/rating metadata
- Careers-site fallback
- Employer-level speculative CV
- Sponsor sync/check controls
- Employer pagination
- Best-vacancy score as an employer sorting aid# Full audit: Opportunities → Sponsor Licences parity

**Scope:** Read-only audit. No implementation, migration, enrichment, publishing, or code changes were performed for the audit itself.

## Executive findings

The recent liveness work aligns the most important trust boundary:

- Both surfaces use fresh, confirmed-live Sponsor Licence vacancy links.
- The shared freshness standard is six hours.
- Dead URL evidence is preserved rather than reinterpreted as email-only.
- Vacancy-specific Send CV is independently enforced by the server.
- Employer-level speculative outreach and careers-site fallback remain separate.

The remaining parity gaps are:

1. **Outbound tracking is inconsistent.** Main Opportunities cards create a `link_clicked` application record, while the best-match strip, Send CV apply-only rows, and Sponsor Licence links use `openTrackedOutbound`, which only emits the extension event and opens the URL.
2. **Smart Apply semantics differ.** Opportunities exposes `SmartApplyModal`; Sponsor Licences primarily exposes tracked external Apply and CV outreach.
3. **Eligibility behavior differs.** Opportunities treats gaps as advisory; Sponsor Licences disables JOBSAGE CV submission when `isEligible === false`.
4. **Filtering and ranking differ.** Opportunities is candidate/vacancy-centric; Sponsor Licences is employer-centric, paginated, and register-metadata driven.
5. **Liveness states are less visible than the API contract.** Sponsor Licence rows are prefiltered to live, so users rarely see why stored evidence is unavailable.
6. **Contact enrichment currently uses paid AI web search.** `POST /sponsor-licences/:id/enrich` invokes `gpt-4o` with `web_search_preview`, which conflicts with the current no-paid-search constraint and should not be reused for parity work.

---

# Part 1 — Opportunities inventory

## Main surface

**File:** `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`

**Component:** `OpportunitiesPage`

**Main endpoint:** `GET /api/roles`

The page uses `useAuth`. The roles endpoint returns `401` when unauthenticated. AI matches are enabled only after authentication settles.

### Tabs

| Tab | Request | Purpose |
|---|---|---|
| `board` | `/roles?source=job_board` | Apply through supported job boards |
| `employers` | `/roles?source=company_site` | Apply through official company sites |
| `sendcv` | `/roles` without source | Find email-capable or verified-apply vacancies |

The initial tab can be selected through `?tab=`, but changing tabs does not update the URL.

### Request behavior

Relevant symbols:

- `OPPORTUNITIES_TIMEOUT_MS`
- `listMatchedRolesWithTimeout`
- `useQuery`
- `getListMatchedRolesQueryKey`

Behavior:

- 15-second client timeout.
- One retry.
- Previous data remains visible during refetch.
- Manual Retry action.
- Errors distinguish no-data failure from failure while displaying cached/previous data.
- No client pagination; the returned ranked catalogue is rendered directly.

## Server-side role assembly

**File:** `artifacts/api-server/src/routes/roles.ts`

`GET /roles` merges:

1. Curated/imported `roles`
2. Published employer `jobListings`
3. AI-discovered `sponsorLicenceVacancies`

Relevant symbols:

- `HAS_CONTACT_INFO`
- `employerJobHasContactInfo`
- `fetchSponsorVacanciesAsRoles`
- `presentApplyLink`
- `roleDedupKey`
- `SPONSOR_VACANCY_ID_OFFSET`
- `candidateBoardSourceForProfession`
- `hasFreshCandidateBoardSnapshot`
- `refreshCandidateBoardVacancies`

### ID spaces

- Curated roles: native role ID
- Employer listings: `jobListing.id + 1_000_000`
- Sponsor vacancies: `sponsorVacancy.id + 2_000_000`

### Contact inclusion

Candidate-facing roles must have at least one of:

- Non-dead apply URL
- Contact email
- Contact phone
- Contact website

A dead apply URL alone does not qualify as contact information.

### Profession and source filtering

Relevant symbols:

- `professionCategoryFor`
- `opportunityCategoriesMatch`
- `storedRegulatorMatchesCategory`
- `employerJobTargetsCategory`
- `classifyVacancyCategory`
- `isManualLabourTitle`

Behavior:

- Candidate profession maps to an opportunity category.
- Clearly mismatched categories are excluded.
- Manual-labour Sponsor Licence vacancies are excluded.
- Ambiguous Sponsor Licence vacancies are removed from the candidate response when `classifiedRelevant === false`.
- Candidates without a supported profession category receive an empty list.

### Deduplication

`roleDedupKey` normalizes employer/title pairs. Sponsor company-site vacancies are deduplicated against curated and employer-posted roles. Job-board handling intentionally differs so legitimate board records remain available.

### Region filtering

Server symbols:

- `roleMatchesPreferredRegions`
- `regionsOverlap`
- Candidate `preferredRegion`

Client symbols:

- `filterOpportunities`
- `hasRegionOverlap`
- `UK_REGIONS`

Unknown/empty target regions remain visible. `National / Multiple Regions` remains visible for regional selections. Client-selected regions are saved to the Professional Profile after a 300 ms debounce.

### Background discovery

When a candidate-specific board snapshot is stale or missing, `/roles?source=job_board` remains database-first and starts `refreshCandidateBoardVacancies(profile)` asynchronously. The current request does not wait for the discovery operation.

## Eligibility and safeguarding

Relevant symbols:

- `assessSponsorshipFeasibility`
- `getRoleEligibilityGaps`
- `getRoleSafeguarding`
- `assessSafeguarding`
- `safeguardingBlocksEligibility`
- `safeguardingGapText`

Fields include:

- `isEligible`
- `eligibilityGaps`
- `matchScore`
- `safeguarding`
- `requiredRegistration`
- `requiredDbsClearanceLevel`
- `requiredSafeguardingLevel`
- `sponsorshipOffered`
- `licensedSponsor`

Presentation:

- “Eligible Now”
- “Not Yet Eligible”
- DBS/safeguarding status badge
- Expandable eligibility notes
- Role-detail modal
- Remediation-path link

Eligibility notes are advisory on Opportunities. An ineligible candidate can still open the application flow; the action label changes from “Smart Apply” to “Apply.”

## Sponsorship presentation

Relevant fields:

- `licensedSponsor`
- `sponsorshipOffered`
- `sponsorshipStatus`

`LicensedSponsorBadge` explicitly warns that register membership does not prove that the vacancy offers sponsorship.

Sponsor vacancy inference uses:

- `inferVacancySponsorshipStatus`
- `confirmed`
- `not_offered`
- `unknown`

The card prominently shows licensed-sponsor membership, but does not consistently show all vacancy-level sponsorship states.

## Ranking

Server symbols:

- `computeMatchScore`
- `batchScoreRoles`
- `candidateMatchScoresTable`
- `sponsorLicenceVacancyScoresTable`
- `calculateBehaviouralRanking`
- `compareOpportunityRanking`
- `qualifiesForApplyFirst`
- `TOP_MATCH_MIN_SCORE`
- `careerFocusBoost`
- `specialtyBoost`
- `PENDING_AI_SCORE`

Ranking signals include eligibility, sponsorship fit, registration requirements, cached AI score, Sponsor vacancy score, specialty/career focus, saved vacancies, employer bookmarks, prior applications, and link clicks.

Client grouping:

- `groupRankedOpportunities`
- Up to five recommended roles
- Up to five roles at or above `CONSIDER_MIN_SCORE` (`40`)
- Remaining roles in “More Opportunities”

Bands:

- “Recommended — Apply First”
- “Worth Considering”
- “More Opportunities”

The client uses server order and does not perform an independent sort.

## Best Matches strip

**Component:** `BestMatchesStrip`

**Data:** `GET /roles/my-matches` through `useGetMyMatches({ limit: 200, source })`

Behavior:

- Shows up to three undismissed, unapplied AI matches.
- Shows score, explanation, reason, employer, and location.
- Allows favorite, dismiss, apply, employer website, Smart Apply, or View Path.
- Shows “Updated today” versus “Just scored.”
- Invalidates the main role list when matching settles.

Dismissal is optimistic locally, persisted through the dismiss endpoint, and has no Sponsor Licence equivalent.

## Favorites and saved state

**Component:** `FavoriteButton`

Used in best-match cards, role cards, Sponsor vacancy rows, and vacancy sheets. Sponsor vacancy favorites use the unified offset ID. Favorite activity contributes to behavioral ranking.

Opportunities has no current share/report action and no general-purpose hide action on normal role cards. Dismiss is limited to the AI queue.

## Vacancy liveness

**Files:**

- `artifacts/api-server/src/lib/vacancyLiveness.ts`
- `artifacts/api-server/src/lib/sponsorVacancyRoles.ts`

**Symbols:**

- `getVacancyLinkStatus`
- `presentApplyLink`
- `RECENT_VERIFY_SKIP_MS`

Statuses:

- `none`
- `live`
- `dead`
- `unverified`
- `inconclusive`
- `stale`

Server freshness is six hours. `presentApplyLink` preserves the stored URL and separately returns:

- `linkStatus`
- `linkVerified`
- `linkCheckedAt`

Sponsor-derived board and company-site rows require a fresh live deep link through `requireSpecificVacancyUrl` and `onlyVerifiedLive`.

### Click-time background check

Client symbols:

- `checkApplyLinkInBackground`
- `isFreshLiveApplyLink`
- `CLICK_HEALTH_TIMEOUT_MS`
- `FRESH_LINK_WINDOW_MS`

Behavior:

- Opens the vacancy immediately.
- Performs a bounded 1.5-second background check.
- Invalidates roles and matches if the URL is dead.
- Network failures/timeouts are inconclusive and do not block navigation.

Important mismatch: the client click helper skips checks for 12 hours, while the candidate-facing server standard is six hours.

### Liveness copy

Main cards show:

- “Link verified”
- “May not be active”
- “Link not yet verified”
- Dead-listing warning after a background check

Stale and inconclusive are not separately communicated.

## Apply and outbound tracking

### Main RoleCard

Relevant symbols:

- `trackAndOpen`
- `doApplyClick`
- `handleApplyClick`

Behavior:

1. Adds `ref=jobsage`.
2. Posts an application record with `applicationType: website` and `status: link_clicked`.
3. Emits `jobsage:outbound-application`.
4. Opens the URL.
5. Starts the background health check for vacancy URLs.
6. May show the extension nudge.

Outbound clicks are gated through `useExtensionGate`.

### Shared outbound helper

**File:** `artifacts/jobsage-web/src/lib/trackedOutbound.ts`

**Symbols:**

- `openTrackedOutbound`
- `openTrackedSponsorVacancy`

The helper adds `ref=jobsage`, emits the trusted extension event, and opens a new tab. It does not create an application record.

Therefore:

- Main RoleCard apply: extension event plus tracker record
- Best Matches apply: extension event only
- Send CV apply-only row: extension event only
- Sponsor vacancy/careers link: extension event only

This is the most important tracking parity gap.

## Apply URL and website fallback

**Helper:** `getOpportunityApplyAction`

Behavior:

- Exact vacancy URL takes priority.
- Contact website becomes “Open employer website” if no vacancy URL exists.
- Website URLs are normalized with `https://`.
- Main cards explain that the fallback opens the employer site rather than a verified vacancy.

LinkedIn and Indeed are rejected as Send CV apply routes through `isDisallowedSendCvApplyUrl` and `hasUsableSendCvApplyRoute`.

## Smart Apply

Components:

- `SmartApplyModal`
- `SmartApplyAssistant`
- `SmartApplyExtensionBanner`
- `SmartApplyExtensionNudge`
- `useExtensionGate`

The server owns application-critical profile readiness. Optional search preferences do not block Smart Apply. Successful submission invalidates roles and applications.

Sponsor Licences does not expose this exact ATS-prefill modal.

## Send CV tab

Helpers:

- `canSendCvForVacancy`
- `hasUsableSendCvApplyRoute`
- `shouldShowOnSendCvTab`
- `shouldShowSendCv`

Rows are shown when:

- Direct-email capability exists and the URL is absent or live, or
- A fresh, verified, non-LinkedIn/non-Indeed apply route exists

Rows are grouped by normalized employer name and searchable by employer, title, or location.

Actions include:

- Send/Resend CV
- Upload CV to send
- Apply via board/company site
- Smart Apply
- View live vacancy

`sendCvEligible === true` remains the strict direct-email capability flag.

## Send CV submission

**Component:** `SponsorVacancyApplyModal`

**Endpoint:** `POST /speculative-applications`

Payload may include:

- `companyName`
- `sponsorLicenceId`
- `vacancyTitle`
- `vacancyRef`
- `roleId`
- `vacancyUrl`
- `sourceType`
- `boardName`
- `requireDirectContact`
- `notes`
- `cvDocumentId`

Vacancy references:

- `role:<merged role id>`
- `sponsor-vacancy:<raw sponsor vacancy id>`

Server enforcement includes authentication, profile/JOBSAGE alias requirements, PDF CV retrieval, direct-contact requirements, stored-vacancy resolution, exact URL identity, fresh-live validation, persisted delivery attempts, delivery outcome, candidate confirmation, tracker/audit updates, and resend support.

The modal also supports multiple CVs, AI outreach assistance, AI cover letters, existing-send warnings, and next-match recommendations.

## Cover Letter and Readiness Check

Cover Letter:

- `CoverLetterModal`
- `useCoverLetterStream`
- `POST /cover-letter/generate-stream`
- Editable output, copy, download, regenerate, retry

Readiness Check:

- `GapAnalysisSheet`
- Sponsor vacancies use `/sponsor-licences/vacancies/:id/gap-analysis`
- Other roles use `/opportunities/roles/:id/gap-analysis`
- Shared monthly allowance of ten newly generated analyses

## Empty and error states

Opportunities distinguishes loading, timeout/error, stale-data retry, no profile, unsupported profession, no region matches, no Send CV routes, no AI matches, reviewed-all matches, missing CV, cover-letter failure, and submission failure.

## Dormant code

`ApplicationsTab`, `AppCard`, and application status configuration exist in `OpportunitiesPage.tsx`, but the current top-level tab union only contains `board`, `employers`, and `sendcv`. The tracker code is not reachable from this page.

## Responsive behavior

The web page is responsive rather than functionally different:

- Tab labels are hidden on small screens.
- Cards collapse to one column.
- Modals become bottom sheets.
- Buttons wrap.

---

# Part 2 — Sponsor Licences inventory

## Main surface

**Files:**

- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/api-server/src/routes/sponsorLicences.ts`

Title: “Visa Sponsoring Employers”

All page APIs require authentication. The global scan is admin-only.

## Sector-first navigation

Data:

- `GET /sponsor-licences/industry-counts`
- `GET /sponsor-licences/industries`

The initial view shows sector icons, sponsor counts, bookmark counts, overall totals, employers with JOBSAGE vacancies, register sync date, and a vacancy-index banner.

This employer/sector browsing experience has no direct Opportunities equivalent.

## Employer list

**Route:** `GET /sponsor-licences`

Parameters:

- `search`
- `route`
- `industry`
- `region[]`
- `hasVacancies`
- `bookmarkedOnly`
- `directContactOnly` (server-supported but not exposed in current page controls)
- `page`
- `limit`

Client behavior:

- 350 ms search debounce
- 20 employers per page
- Previous page retained while filters load
- Page reset after filter changes

## Employer filters

Available:

- Organisation name
- Worker route
- Industry
- Multiple register regions
- Has Vacancies
- Bookmarked
- Sector selection

Not available:

- Candidate profession/category
- Candidate saved profile regions
- Vacancy title/location search
- Vacancy source
- Vacancy sponsorship-confirmed state
- Vacancy eligibility
- Vacancy score threshold
- Direct Contact Only UI
- Explicit LinkedIn/Indeed filter

Sponsor region filtering uses register region, not vacancy target region.

## Employer ranking

Server ordering:

1. Employers with fresh live vacancies
2. Never-checked employers
3. Checked employers with no fresh live vacancies

Within live employers:

1. Best stored match score descending
2. Fresh-live vacancy count descending
3. Organisation name alphabetically

This is intentionally employer-centric and not equivalent to Opportunities’ vacancy ranking.

## Employer metadata

Cards show organisation, town/city, county, region, route, sub-route, rating, industry styling, fresh-live vacancy count, CV Sent state, last check time, 24-hour discovery-cache status, best-fit percentage, and bookmark state.

Register metadata is not presented as vacancy sponsorship proof.

## Vacancy expansion

**Component:** `VacancyMatchPanel`

**Endpoint:** `GET /sponsor-licences/:id/vacancies`

The server requires:

- `liveness = live`
- `lastVerifiedAt` within six hours

The client repeats:

- `linkStatus === "live"`
- `linkVerified === true`

Rows show title, location, salary, posted date, live-link badge, match percentage, eligibility, missing requirements, explanation, Readiness Check, favorite, external apply, and Send CV when allowed.

Rows sort by match score, newer ID, and title.

## On-demand checks and scoring

Expanding an employer with no check triggers `POST /sponsor-licences/:id/check-vacancies`.

If scores are missing, the vacancy endpoint calls `scoreVacanciesForCompany`. A scoring failure leaves the vacancy list available with null scores.

Unlike Opportunities, this surface can perform discovery/scoring during panel expansion.

## Refresh controls

Candidate-accessible:

- Refresh visible page
- Up to 20 employer IDs
- 45-second in-memory per-user cooldown
- 24-hour result-cache awareness
- New checks/cache hits/errors summary

Admin-only:

- Check All Vacancies
- Optional region selection
- Progress polling
- Cache-hit/new-check/error counts

These are Sponsor-only operational controls.

## Liveness and counts

Fresh live URL-backed, source-classified rows determine:

- `hasVacancies`
- `storedVacancyCount`
- `withVacancies`
- Has Vacancies filter
- Vacancy statistics
- Expanded actionable rows

The vacancy-stat endpoint requires live liveness, six-hour freshness, non-null source type, and non-null URL.

Non-live evidence is removed before rendering. Users see aggregate fallback copy but not the distinction between dead, stale, unverified, and inconclusive stored records.

## External apply and careers fallback

Vacancy apply uses `openTrackedSponsorVacancy`. It adds `ref=jobsage`, emits the extension event, and opens the posting.

Careers fallback uses `handleWebsiteApply`, which is extension-gated and opens the careers URL. If none exists, it expands Contact and shows guidance.

Neither helper creates an application tracker record.

The detail sheet also offers “View original posting.”

## Vacancy-specific Send CV

Requirements:

- Employer-level `sendCvEligible`
- Uploaded CV
- `isEligible !== false`
- Fresh-live vacancy row
- Server-side direct-contact and liveness enforcement

Uses `SponsorVacancyApplyModal` with raw `vacancyId`, `companyId`, exact URL, and `requireDirectContact`.

This differs from Opportunities, where eligibility gaps are advisory.

## Employer-level speculative CV

Available for direct-contact employers without tying outreach to a particular vacancy. It remains available when no vacancy is found or when stored vacancies have no actionable links. This is correctly different from vacancy-specific Send CV.

## Contact panel

Shows stored/enriched website, email, phone, address, refresh/discover controls, Google search, and Companies House links.

Endpoint:

- `POST /sponsor-licences/:id/enrich`

Risk:

- Uses OpenAI `gpt-4o` with `web_search_preview`.
- This is paid AI web search.
- It can overwrite stored fields with null when research fails.
- It should not be reused under the current no-paid-search and provenance/no-overwrite constraints.

## Bookmarks

Sponsor bookmarks are employer-level:

- `POST /sponsor-licences/:id/bookmark`
- `DELETE /sponsor-licences/:id/bookmark`

They support optimistic updates, rollback, bookmark filtering, sector counts, and behavioral ranking input.

Vacancy favorites remain separate and use the shared `FavoriteButton`.

## Readiness Check

Sponsor vacancies use the shared `GapAnalysisSheet` and shared monthly quota. The page displays match score, eligibility, missing requirements, explanation, and full Readiness Check.

## Sponsor-only failure and empty states

- Register sync failure warning
- Register not classified
- No matching sponsors
- Failed register load
- Vacancy check in progress
- No current vacancies
- Historical openings but no direct apply links
- No careers site
- Contact-enrichment failure
- Batch cooldown
- Batch partial failures
- Global scan progress

---

# Part 3 — Parity matrix

| Feature | Opportunities | Sponsor Licences | Gap | Suggested approach | Risk/design note |
|---|---|---|---|---|---|
| Authentication | Authenticated candidate feed | Authenticated register | Already aligned | Reuse shared helper | Both APIs require authentication |
| Core object | Vacancy-first | Employer-first with expanded vacancies | Different-by-design | Keep different | Do not flatten the directory |
| Profession filtering | Excludes unrelated vacancies | Industry-based employers; vacancy category not shown consistently | Partial | Adapt for employer context | One employer may cover multiple professions |
| Region filtering | Vacancy target region and saved profile preference | Employer register region, session-only | Partial | Adapt for employer context | These are different geography concepts |
| Saved region preference | Shared with Professional Profile | Not consumed | Missing | Reuse shared helper | Label any new vacancy-region filter clearly |
| Source tabs | Board/company site separated | Mixed expanded list | Missing | Port Opportunities logic | Preserve source transparency |
| Board exclusions | LinkedIn/Indeed rejected in Send CV routes | No explicit Sponsor control | Partial | Reuse shared helper | Keep source policy server-safe |
| Contact inclusion | Requires some route | Register employers can exist without contact | Different-by-design | Keep different | Directory entries remain useful |
| Fresh-live vacancy list | Fresh-live for source tabs | Fresh-live for counts and expansion | Already aligned | Reuse shared helper | Six-hour standard aligned |
| Link status | Six explicit statuses | Same API contract | Already aligned | Reuse shared helper | OpenAPI wording should describe enum, not a boolean |
| Status presentation | Generic verified/warning copy | Non-live rows hidden | Partial | Adapt for employer context | Consider disabled evidence summary |
| Dead-as-email-only | Blocked in UI and server | Blocked in UI and server | Already aligned | Reuse shared helper | Main trust requirement satisfied |
| Exact URL identity | Server enforced | Same endpoint enforcement | Already aligned | Reuse shared helper | Prevents crafted submissions |
| Click-time link check | Main cards check asynchronously | Sponsor apply does not use same helper | Missing | Reuse shared helper | Must not block navigation |
| Freshness messaging | Server six hours; click helper twelve | Server six hours; discovery cache 24h | Partial | Reuse shared helper | Separate discovery from link health |
| Outbound extension event | Emitted | Emitted | Already aligned | Reuse shared helper | Trusted first-party event retained |
| Tracker click record | Main cards create `link_clicked`; other routes do not | Not created | Partial | Reuse shared helper | Highest-priority parity defect |
| Apply action | Vacancy URL or website fallback | Vacancy URL and careers fallback | Partial | Adapt for employer context | Careers homepage is not a vacancy |
| Smart Apply | Dedicated ATS-prefill modal | No equivalent | Missing | Port Opportunities logic | Clarify ATS support first |
| Extension gate | Apply routes gated | Vacancy/careers actions gated; informational anchors differ | Partial | Reuse shared helper | Distinguish apply intent from contact browsing |
| Vacancy Send CV | Direct contact plus live/none status | Direct contact plus live row | Already aligned | Reuse shared helper | Server gate shared |
| Email-only vacancy | Supported for genuine URL-less direct contact | Expansion is URL/live oriented | Partial | Adapt for employer context | Never infer email-only from a dead URL |
| Employer speculative CV | Not primary card flow | Explicit feature | Different-by-design | Keep different | Appropriate directory behavior |
| CV upload gate | Send CV redirects to documents | Sponsor disables or links to upload | Already aligned | Reuse shared helper | Copy differs |
| Eligibility gate | Advisory | Blocks Sponsor CV action when false | Partial | Product decision | Avoid page-dependent policy |
| Multiple CV selection | Shared modal | Shared modal | Already aligned | Reuse shared helper | Same component |
| Cover letter | Standalone and modal | Modal only | Partial | Port Opportunities logic | Optional convenience |
| AI outreach assistant | Send CV modal | Same modal | Already aligned | Reuse shared helper | Shared implementation |
| Readiness Check | Shared sheet/quota | Shared sheet/quota | Already aligned | Reuse shared helper | Record-specific endpoints |
| Match score | Unified vacancy ranking | Best vacancy score plus row scores | Partial | Adapt for employer context | Do not call it employer quality |
| Ranking bands | Apply First/Worth Considering/More | No comparable bands | Missing | Adapt for employer context | Simple row sort may be enough |
| AI Best Matches | Top-three dismissible queue | None | Missing | Port only if desired | Could undermine directory browsing |
| Dismiss/hide | AI-match dismissal | None | Missing | Adapt for employer context | Decide employer vs vacancy hiding |
| Vacancy favorite | Shared | Shared offset ID | Already aligned | Reuse shared helper | Verify outbound identity separately |
| Employer bookmark | Behavioral signal only | Full UI/filter | Different-by-design | Keep different | Sponsor-only capability |
| Search | Employer/title/location in Send CV | Employer only | Partial | Adapt for employer context | Global search is separate scope |
| Pagination | No visible pagination | 20 employers/page | Different-by-design | Keep different | Register requires pagination |
| Cache UI | AI-score cache labels | Discovery/check cache labels | Different-by-design | Keep different | Do not equate with link verification |
| Manual refresh | Retry role query | Recheck visible employers | Different-by-design | Keep different | Sponsor checks are expensive |
| Admin scan | Not exposed | Region-aware global scan | Different-by-design | Keep different | Operational feature |
| Register warning | Not applicable | Visible | Different-by-design | Keep different | Sponsor-only trust metadata |
| Vacancy detail | Eligibility summary/modal | Description/action bottom sheet | Partial | Port selected fields | Add requirements if supported |
| Sponsorship disclaimer | Licensed-sponsor tooltip | Register framing; limited vacancy copy | Partial | Reuse shared helper | Avoid vacancy-level inference |
| Safeguarding badges | Explicit | Missing in Sponsor row | Missing | Port Opportunities logic | Response fields may need expansion |
| Required registration | Displayed | Missing in Sponsor response/UI | Missing | Port Opportunities logic | Scoring may already know it |
| Application state | Applied/CV Sent role IDs | Mostly company-level CV Sent | Partial | Reuse shared helper | Keep company and vacancy states separate |
| Next matches | May show three recommendations | Modal supports this only in non-speculative mode | Partial | Keep/adapt | Clarify Sponsor semantics |
| Share/report | Not present | Not present | Already aligned | Not applicable | No parity work |
| Contact enrichment | Not a primary Opportunity action | AI web-search enrichment | Different-by-design | Defer/replace | Conflicts with current constraint |

---

# Part 4 — Implementation map

## Must-match: quality and trust

### 1. Unify outbound tracking semantics

Reuse:

- `RoleCard.trackAndOpen`
- `openTrackedOutbound`
- `openTrackedSponsorVacancy`
- Application `link_clicked` contract

Potential files:

- `artifacts/jobsage-web/src/lib/trackedOutbound.ts`
- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`
- Application route/specification as required

Every application-intent click should consistently create a tracker record, while careers-homepage visits remain distinguishable from exact-vacancy clicks. Avoid double creation where RoleCard already posts manually.

### 2. Reuse background liveness checks on Sponsor vacancy clicks

Reuse:

- `checkApplyLinkInBackground`
- `getGetSponsorLicenceVacanciesQueryKey`
- Six-hour status semantics

Navigation must remain immediate. A newly dead URL should invalidate the employer’s vacancy list/count without blocking the click.

### 3. Separate discovery-cache copy from link-verification copy

Keep these concepts separate:

- 24-hour employer vacancy discovery cache
- Six-hour exact URL verification

“Checked within 24 hours” must never look equivalent to “link verified.”

### 4. Preserve explicit sponsorship semantics

Reuse:

- `LicensedSponsorBadge`
- `sponsorshipStatus`
- `inferVacancySponsorshipStatus`

Register membership must remain employer-level. Vacancy-confirmed sponsorship must come only from vacancy evidence.

### 5. Do not reuse current AI contact enrichment

Exclude `POST /sponsor-licences/:id/enrich` from parity work until it is replaced with permitted stored/official-site evidence, provenance, and no-overwrite behavior.

## Should-match: expected candidate behavior

6. Choose one eligibility policy across both pages.

7. Add Sponsor vacancy-level profession, registration, safeguarding, and requirement presentation.

8. Add Sponsor source/board labels and shared board exclusions.

9. Align per-vacancy Applied/CV Sent state using the unified ID space.

10. Decide whether supported Sponsor vacancies receive the dedicated Smart Apply action.

11. Add vacancy title/location search while preserving employer search and employer pagination.

## Adapt: employer semantics

12. Keep employer register region and candidate vacancy region as separate concepts.

13. Keep employer score explicitly framed as the best visible vacancy score.

14. Use separate labels for:

- Apply on employer site
- Smart Apply
- Send CV for a vacancy
- Send CV speculatively

15. Consider a non-actionable evidence summary for stale/dead/unverified rows without making them clickable or email-only.

## Defer or skip

- Opportunities self-promotion card
- Dormant tracker tab inside Opportunities
- AI Best Matches on the employer directory unless product intent changes
- Share/report actions
- Paid AI web-search enrichment
- Full Opportunities ranking bands inside every employer
- Company-wide scan controls on Opportunities

---

# Part 5 — Open questions

1. Should Sponsor Licence vacancies offer the ATS Smart Apply flow, or only tracked external Apply plus Send CV?
2. Should not-yet-eligible candidates continue with advisory messaging on both surfaces?
3. Should Sponsor Licences consume the saved Professional Profile region preference?
4. Should vacancy-region filtering occur inside each employer panel or across the employer list?
5. Should Sponsor vacancy clicks create website application tracker rows immediately?
6. Should careers-homepage visits count as applications, leads, or only outbound navigation?
7. Should stale/unverified/dead evidence be visible as non-actionable evidence?
8. Should Sponsor vacancy rows show `confirmed`, `not_offered`, or `unknown` sponsorship status?
9. Should Sponsor Licences expose the existing `directContactOnly` filter?
10. Should Sponsor rows show NHS Jobs/Reed/company-site source badges?
11. Should LinkedIn/Indeed restrictions apply to Sponsor actions outside the Send CV tab?
12. Should employer-level CV Sent be shown separately from vacancy-level CV Sent?
13. Should the client click-check window be changed to six hours?
14. Should Sponsor vacancy details include safeguarding and required-registration fields?
15. Is the dormant Applications tab intended to return, or should it be treated as obsolete?
16. Should contact enrichment be removed/replaced because it uses paid AI web search?

---

# Parity backlog

## P0 — Trust and consistency

1. Unify outbound application tracking across every vacancy and careers-site action.
2. Add non-blocking Sponsor vacancy link checking using the shared checker.
3. Resolve the six-hour versus twelve-hour exact-link freshness mismatch.
4. Separate 24-hour discovery-cache messaging from six-hour URL verification.
5. Expose explicit vacancy sponsorship status without conflating it with licence membership.
6. Remove paid AI web search from any parity implementation plan.

## P1 — Action parity

7. Choose and enforce one eligibility policy across Opportunities and Sponsor Licences.
8. Add exact vacancy Applied/CV Sent state to Sponsor rows.
9. Add Sponsor vacancy source/board labels and shared board exclusions.
10. Decide whether eligible Sponsor vacancies receive the dedicated Smart Apply action.
11. Return/display required registration and safeguarding requirements on Sponsor vacancies.

## P2 — Discovery parity

12. Add vacancy-title/location search while preserving employer search.
13. Add optional candidate-preferred vacancy-region filtering without replacing register-region filtering.
14. Expose the existing direct-contact-only server filter if the product wants a Send CV-oriented employer view.
15. Consider hidden/dismissed vacancy behavior separately from employer bookmarks.

## Intentionally different

- Sector-first employer browsing
- Employer bookmarks
- Register route/rating metadata
- Careers-site fallback
- Employer-level speculative CV
- Sponsor sync/check controls
- Employer pagination
- Best-vacancy score as an employer sorting aid# Full audit: Opportunities → Sponsor Licences parity

**Scope:** Read-only audit. No implementation, migration, enrichment, publishing, or code changes were performed for the audit itself.

## Executive findings

The recent liveness work aligns the most important trust boundary:

- Both surfaces use fresh, confirmed-live Sponsor Licence vacancy links.
- The shared freshness standard is six hours.
- Dead URL evidence is preserved rather than reinterpreted as email-only.
- Vacancy-specific Send CV is independently enforced by the server.
- Employer-level speculative outreach and careers-site fallback remain separate.

The remaining parity gaps are:

1. **Outbound tracking is inconsistent.** Main Opportunities cards create a `link_clicked` application record, while the best-match strip, Send CV apply-only rows, and Sponsor Licence links use `openTrackedOutbound`, which only emits the extension event and opens the URL.
2. **Smart Apply semantics differ.** Opportunities exposes `SmartApplyModal`; Sponsor Licences primarily exposes tracked external Apply and CV outreach.
3. **Eligibility behavior differs.** Opportunities treats gaps as advisory; Sponsor Licences disables JOBSAGE CV submission when `isEligible === false`.
4. **Filtering and ranking differ.** Opportunities is candidate/vacancy-centric; Sponsor Licences is employer-centric, paginated, and register-metadata driven.
5. **Liveness states are less visible than the API contract.** Sponsor Licence rows are prefiltered to live, so users rarely see why stored evidence is unavailable.
6. **Contact enrichment currently uses paid AI web search.** `POST /sponsor-licences/:id/enrich` invokes `gpt-4o` with `web_search_preview`, which conflicts with the current no-paid-search constraint and should not be reused for parity work.

---

# Part 1 — Opportunities inventory

## Main surface

**File:** `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`

**Component:** `OpportunitiesPage`

**Main endpoint:** `GET /api/roles`

The page uses `useAuth`. The roles endpoint returns `401` when unauthenticated. AI matches are enabled only after authentication settles.

### Tabs

| Tab | Request | Purpose |
|---|---|---|
| `board` | `/roles?source=job_board` | Apply through supported job boards |
| `employers` | `/roles?source=company_site` | Apply through official company sites |
| `sendcv` | `/roles` without source | Find email-capable or verified-apply vacancies |

The initial tab can be selected through `?tab=`, but changing tabs does not update the URL.

### Request behavior

Relevant symbols:

- `OPPORTUNITIES_TIMEOUT_MS`
- `listMatchedRolesWithTimeout`
- `useQuery`
- `getListMatchedRolesQueryKey`

Behavior:

- 15-second client timeout.
- One retry.
- Previous data remains visible during refetch.
- Manual Retry action.
- Errors distinguish no-data failure from failure while displaying cached/previous data.
- No client pagination; the returned ranked catalogue is rendered directly.

## Server-side role assembly

**File:** `artifacts/api-server/src/routes/roles.ts`

`GET /roles` merges:

1. Curated/imported `roles`
2. Published employer `jobListings`
3. AI-discovered `sponsorLicenceVacancies`

Relevant symbols:

- `HAS_CONTACT_INFO`
- `employerJobHasContactInfo`
- `fetchSponsorVacanciesAsRoles`
- `presentApplyLink`
- `roleDedupKey`
- `SPONSOR_VACANCY_ID_OFFSET`
- `candidateBoardSourceForProfession`
- `hasFreshCandidateBoardSnapshot`
- `refreshCandidateBoardVacancies`

### ID spaces

- Curated roles: native role ID
- Employer listings: `jobListing.id + 1_000_000`
- Sponsor vacancies: `sponsorVacancy.id + 2_000_000`

### Contact inclusion

Candidate-facing roles must have at least one of:

- Non-dead apply URL
- Contact email
- Contact phone
- Contact website

A dead apply URL alone does not qualify as contact information.

### Profession and source filtering

Relevant symbols:

- `professionCategoryFor`
- `opportunityCategoriesMatch`
- `storedRegulatorMatchesCategory`
- `employerJobTargetsCategory`
- `classifyVacancyCategory`
- `isManualLabourTitle`

Behavior:

- Candidate profession maps to an opportunity category.
- Clearly mismatched categories are excluded.
- Manual-labour Sponsor Licence vacancies are excluded.
- Ambiguous Sponsor Licence vacancies are removed from the candidate response when `classifiedRelevant === false`.
- Candidates without a supported profession category receive an empty list.

### Deduplication

`roleDedupKey` normalizes employer/title pairs. Sponsor company-site vacancies are deduplicated against curated and employer-posted roles. Job-board handling intentionally differs so legitimate board records remain available.

### Region filtering

Server symbols:

- `roleMatchesPreferredRegions`
- `regionsOverlap`
- Candidate `preferredRegion`

Client symbols:

- `filterOpportunities`
- `hasRegionOverlap`
- `UK_REGIONS`

Unknown/empty target regions remain visible. `National / Multiple Regions` remains visible for regional selections. Client-selected regions are saved to the Professional Profile after a 300 ms debounce.

### Background discovery

When a candidate-specific board snapshot is stale or missing, `/roles?source=job_board` remains database-first and starts `refreshCandidateBoardVacancies(profile)` asynchronously. The current request does not wait for the discovery operation.

## Eligibility and safeguarding

Relevant symbols:

- `assessSponsorshipFeasibility`
- `getRoleEligibilityGaps`
- `getRoleSafeguarding`
- `assessSafeguarding`
- `safeguardingBlocksEligibility`
- `safeguardingGapText`

Fields include:

- `isEligible`
- `eligibilityGaps`
- `matchScore`
- `safeguarding`
- `requiredRegistration`
- `requiredDbsClearanceLevel`
- `requiredSafeguardingLevel`
- `sponsorshipOffered`
- `licensedSponsor`

Presentation:

- “Eligible Now”
- “Not Yet Eligible”
- DBS/safeguarding status badge
- Expandable eligibility notes
- Role-detail modal
- Remediation-path link

Eligibility notes are advisory on Opportunities. An ineligible candidate can still open the application flow; the action label changes from “Smart Apply” to “Apply.”

## Sponsorship presentation

Relevant fields:

- `licensedSponsor`
- `sponsorshipOffered`
- `sponsorshipStatus`

`LicensedSponsorBadge` explicitly warns that register membership does not prove that the vacancy offers sponsorship.

Sponsor vacancy inference uses:

- `inferVacancySponsorshipStatus`
- `confirmed`
- `not_offered`
- `unknown`

The card prominently shows licensed-sponsor membership, but does not consistently show all vacancy-level sponsorship states.

## Ranking

Server symbols:

- `computeMatchScore`
- `batchScoreRoles`
- `candidateMatchScoresTable`
- `sponsorLicenceVacancyScoresTable`
- `calculateBehaviouralRanking`
- `compareOpportunityRanking`
- `qualifiesForApplyFirst`
- `TOP_MATCH_MIN_SCORE`
- `careerFocusBoost`
- `specialtyBoost`
- `PENDING_AI_SCORE`

Ranking signals include eligibility, sponsorship fit, registration requirements, cached AI score, Sponsor vacancy score, specialty/career focus, saved vacancies, employer bookmarks, prior applications, and link clicks.

Client grouping:

- `groupRankedOpportunities`
- Up to five recommended roles
- Up to five roles at or above `CONSIDER_MIN_SCORE` (`40`)
- Remaining roles in “More Opportunities”

Bands:

- “Recommended — Apply First”
- “Worth Considering”
- “More Opportunities”

The client uses server order and does not perform an independent sort.

## Best Matches strip

**Component:** `BestMatchesStrip`

**Data:** `GET /roles/my-matches` through `useGetMyMatches({ limit: 200, source })`

Behavior:

- Shows up to three undismissed, unapplied AI matches.
- Shows score, explanation, reason, employer, and location.
- Allows favorite, dismiss, apply, employer website, Smart Apply, or View Path.
- Shows “Updated today” versus “Just scored.”
- Invalidates the main role list when matching settles.

Dismissal is optimistic locally, persisted through the dismiss endpoint, and has no Sponsor Licence equivalent.

## Favorites and saved state

**Component:** `FavoriteButton`

Used in best-match cards, role cards, Sponsor vacancy rows, and vacancy sheets. Sponsor vacancy favorites use the unified offset ID. Favorite activity contributes to behavioral ranking.

Opportunities has no current share/report action and no general-purpose hide action on normal role cards. Dismiss is limited to the AI queue.

## Vacancy liveness

**Files:**

- `artifacts/api-server/src/lib/vacancyLiveness.ts`
- `artifacts/api-server/src/lib/sponsorVacancyRoles.ts`

**Symbols:**

- `getVacancyLinkStatus`
- `presentApplyLink`
- `RECENT_VERIFY_SKIP_MS`

Statuses:

- `none`
- `live`
- `dead`
- `unverified`
- `inconclusive`
- `stale`

Server freshness is six hours. `presentApplyLink` preserves the stored URL and separately returns:

- `linkStatus`
- `linkVerified`
- `linkCheckedAt`

Sponsor-derived board and company-site rows require a fresh live deep link through `requireSpecificVacancyUrl` and `onlyVerifiedLive`.

### Click-time background check

Client symbols:

- `checkApplyLinkInBackground`
- `isFreshLiveApplyLink`
- `CLICK_HEALTH_TIMEOUT_MS`
- `FRESH_LINK_WINDOW_MS`

Behavior:

- Opens the vacancy immediately.
- Performs a bounded 1.5-second background check.
- Invalidates roles and matches if the URL is dead.
- Network failures/timeouts are inconclusive and do not block navigation.

Important mismatch: the client click helper skips checks for 12 hours, while the candidate-facing server standard is six hours.

### Liveness copy

Main cards show:

- “Link verified”
- “May not be active”
- “Link not yet verified”
- Dead-listing warning after a background check

Stale and inconclusive are not separately communicated.

## Apply and outbound tracking

### Main RoleCard

Relevant symbols:

- `trackAndOpen`
- `doApplyClick`
- `handleApplyClick`

Behavior:

1. Adds `ref=jobsage`.
2. Posts an application record with `applicationType: website` and `status: link_clicked`.
3. Emits `jobsage:outbound-application`.
4. Opens the URL.
5. Starts the background health check for vacancy URLs.
6. May show the extension nudge.

Outbound clicks are gated through `useExtensionGate`.

### Shared outbound helper

**File:** `artifacts/jobsage-web/src/lib/trackedOutbound.ts`

**Symbols:**

- `openTrackedOutbound`
- `openTrackedSponsorVacancy`

The helper adds `ref=jobsage`, emits the trusted extension event, and opens a new tab. It does not create an application record.

Therefore:

- Main RoleCard apply: extension event plus tracker record
- Best Matches apply: extension event only
- Send CV apply-only row: extension event only
- Sponsor vacancy/careers link: extension event only

This is the most important tracking parity gap.

## Apply URL and website fallback

**Helper:** `getOpportunityApplyAction`

Behavior:

- Exact vacancy URL takes priority.
- Contact website becomes “Open employer website” if no vacancy URL exists.
- Website URLs are normalized with `https://`.
- Main cards explain that the fallback opens the employer site rather than a verified vacancy.

LinkedIn and Indeed are rejected as Send CV apply routes through `isDisallowedSendCvApplyUrl` and `hasUsableSendCvApplyRoute`.

## Smart Apply

Components:

- `SmartApplyModal`
- `SmartApplyAssistant`
- `SmartApplyExtensionBanner`
- `SmartApplyExtensionNudge`
- `useExtensionGate`

The server owns application-critical profile readiness. Optional search preferences do not block Smart Apply. Successful submission invalidates roles and applications.

Sponsor Licences does not expose this exact ATS-prefill modal.

## Send CV tab

Helpers:

- `canSendCvForVacancy`
- `hasUsableSendCvApplyRoute`
- `shouldShowOnSendCvTab`
- `shouldShowSendCv`

Rows are shown when:

- Direct-email capability exists and the URL is absent or live, or
- A fresh, verified, non-LinkedIn/non-Indeed apply route exists

Rows are grouped by normalized employer name and searchable by employer, title, or location.

Actions include:

- Send/Resend CV
- Upload CV to send
- Apply via board/company site
- Smart Apply
- View live vacancy

`sendCvEligible === true` remains the strict direct-email capability flag.

## Send CV submission

**Component:** `SponsorVacancyApplyModal`

**Endpoint:** `POST /speculative-applications`

Payload may include:

- `companyName`
- `sponsorLicenceId`
- `vacancyTitle`
- `vacancyRef`
- `roleId`
- `vacancyUrl`
- `sourceType`
- `boardName`
- `requireDirectContact`
- `notes`
- `cvDocumentId`

Vacancy references:

- `role:<merged role id>`
- `sponsor-vacancy:<raw sponsor vacancy id>`

Server enforcement includes authentication, profile/JOBSAGE alias requirements, PDF CV retrieval, direct-contact requirements, stored-vacancy resolution, exact URL identity, fresh-live validation, persisted delivery attempts, delivery outcome, candidate confirmation, tracker/audit updates, and resend support.

The modal also supports multiple CVs, AI outreach assistance, AI cover letters, existing-send warnings, and next-match recommendations.

## Cover Letter and Readiness Check

Cover Letter:

- `CoverLetterModal`
- `useCoverLetterStream`
- `POST /cover-letter/generate-stream`
- Editable output, copy, download, regenerate, retry

Readiness Check:

- `GapAnalysisSheet`
- Sponsor vacancies use `/sponsor-licences/vacancies/:id/gap-analysis`
- Other roles use `/opportunities/roles/:id/gap-analysis`
- Shared monthly allowance of ten newly generated analyses

## Empty and error states

Opportunities distinguishes loading, timeout/error, stale-data retry, no profile, unsupported profession, no region matches, no Send CV routes, no AI matches, reviewed-all matches, missing CV, cover-letter failure, and submission failure.

## Dormant code

`ApplicationsTab`, `AppCard`, and application status configuration exist in `OpportunitiesPage.tsx`, but the current top-level tab union only contains `board`, `employers`, and `sendcv`. The tracker code is not reachable from this page.

## Responsive behavior

The web page is responsive rather than functionally different:

- Tab labels are hidden on small screens.
- Cards collapse to one column.
- Modals become bottom sheets.
- Buttons wrap.

---

# Part 2 — Sponsor Licences inventory

## Main surface

**Files:**

- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/api-server/src/routes/sponsorLicences.ts`

Title: “Visa Sponsoring Employers”

All page APIs require authentication. The global scan is admin-only.

## Sector-first navigation

Data:

- `GET /sponsor-licences/industry-counts`
- `GET /sponsor-licences/industries`

The initial view shows sector icons, sponsor counts, bookmark counts, overall totals, employers with JOBSAGE vacancies, register sync date, and a vacancy-index banner.

This employer/sector browsing experience has no direct Opportunities equivalent.

## Employer list

**Route:** `GET /sponsor-licences`

Parameters:

- `search`
- `route`
- `industry`
- `region[]`
- `hasVacancies`
- `bookmarkedOnly`
- `directContactOnly` (server-supported but not exposed in current page controls)
- `page`
- `limit`

Client behavior:

- 350 ms search debounce
- 20 employers per page
- Previous page retained while filters load
- Page reset after filter changes

## Employer filters

Available:

- Organisation name
- Worker route
- Industry
- Multiple register regions
- Has Vacancies
- Bookmarked
- Sector selection

Not available:

- Candidate profession/category
- Candidate saved profile regions
- Vacancy title/location search
- Vacancy source
- Vacancy sponsorship-confirmed state
- Vacancy eligibility
- Vacancy score threshold
- Direct Contact Only UI
- Explicit LinkedIn/Indeed filter

Sponsor region filtering uses register region, not vacancy target region.

## Employer ranking

Server ordering:

1. Employers with fresh live vacancies
2. Never-checked employers
3. Checked employers with no fresh live vacancies

Within live employers:

1. Best stored match score descending
2. Fresh-live vacancy count descending
3. Organisation name alphabetically

This is intentionally employer-centric and not equivalent to Opportunities’ vacancy ranking.

## Employer metadata

Cards show organisation, town/city, county, region, route, sub-route, rating, industry styling, fresh-live vacancy count, CV Sent state, last check time, 24-hour discovery-cache status, best-fit percentage, and bookmark state.

Register metadata is not presented as vacancy sponsorship proof.

## Vacancy expansion

**Component:** `VacancyMatchPanel`

**Endpoint:** `GET /sponsor-licences/:id/vacancies`

The server requires:

- `liveness = live`
- `lastVerifiedAt` within six hours

The client repeats:

- `linkStatus === "live"`
- `linkVerified === true`

Rows show title, location, salary, posted date, live-link badge, match percentage, eligibility, missing requirements, explanation, Readiness Check, favorite, external apply, and Send CV when allowed.

Rows sort by match score, newer ID, and title.

## On-demand checks and scoring

Expanding an employer with no check triggers `POST /sponsor-licences/:id/check-vacancies`.

If scores are missing, the vacancy endpoint calls `scoreVacanciesForCompany`. A scoring failure leaves the vacancy list available with null scores.

Unlike Opportunities, this surface can perform discovery/scoring during panel expansion.

## Refresh controls

Candidate-accessible:

- Refresh visible page
- Up to 20 employer IDs
- 45-second in-memory per-user cooldown
- 24-hour result-cache awareness
- New checks/cache hits/errors summary

Admin-only:

- Check All Vacancies
- Optional region selection
- Progress polling
- Cache-hit/new-check/error counts

These are Sponsor-only operational controls.

## Liveness and counts

Fresh live URL-backed, source-classified rows determine:

- `hasVacancies`
- `storedVacancyCount`
- `withVacancies`
- Has Vacancies filter
- Vacancy statistics
- Expanded actionable rows

The vacancy-stat endpoint requires live liveness, six-hour freshness, non-null source type, and non-null URL.

Non-live evidence is removed before rendering. Users see aggregate fallback copy but not the distinction between dead, stale, unverified, and inconclusive stored records.

## External apply and careers fallback

Vacancy apply uses `openTrackedSponsorVacancy`. It adds `ref=jobsage`, emits the extension event, and opens the posting.

Careers fallback uses `handleWebsiteApply`, which is extension-gated and opens the careers URL. If none exists, it expands Contact and shows guidance.

Neither helper creates an application tracker record.

The detail sheet also offers “View original posting.”

## Vacancy-specific Send CV

Requirements:

- Employer-level `sendCvEligible`
- Uploaded CV
- `isEligible !== false`
- Fresh-live vacancy row
- Server-side direct-contact and liveness enforcement

Uses `SponsorVacancyApplyModal` with raw `vacancyId`, `companyId`, exact URL, and `requireDirectContact`.

This differs from Opportunities, where eligibility gaps are advisory.

## Employer-level speculative CV

Available for direct-contact employers without tying outreach to a particular vacancy. It remains available when no vacancy is found or when stored vacancies have no actionable links. This is correctly different from vacancy-specific Send CV.

## Contact panel

Shows stored/enriched website, email, phone, address, refresh/discover controls, Google search, and Companies House links.

Endpoint:

- `POST /sponsor-licences/:id/enrich`

Risk:

- Uses OpenAI `gpt-4o` with `web_search_preview`.
- This is paid AI web search.
- It can overwrite stored fields with null when research fails.
- It should not be reused under the current no-paid-search and provenance/no-overwrite constraints.

## Bookmarks

Sponsor bookmarks are employer-level:

- `POST /sponsor-licences/:id/bookmark`
- `DELETE /sponsor-licences/:id/bookmark`

They support optimistic updates, rollback, bookmark filtering, sector counts, and behavioral ranking input.

Vacancy favorites remain separate and use the shared `FavoriteButton`.

## Readiness Check

Sponsor vacancies use the shared `GapAnalysisSheet` and shared monthly quota. The page displays match score, eligibility, missing requirements, explanation, and full Readiness Check.

## Sponsor-only failure and empty states

- Register sync failure warning
- Register not classified
- No matching sponsors
- Failed register load
- Vacancy check in progress
- No current vacancies
- Historical openings but no direct apply links
- No careers site
- Contact-enrichment failure
- Batch cooldown
- Batch partial failures
- Global scan progress

---

# Part 3 — Parity matrix

| Feature | Opportunities | Sponsor Licences | Gap | Suggested approach | Risk/design note |
|---|---|---|---|---|---|
| Authentication | Authenticated candidate feed | Authenticated register | Already aligned | Reuse shared helper | Both APIs require authentication |
| Core object | Vacancy-first | Employer-first with expanded vacancies | Different-by-design | Keep different | Do not flatten the directory |
| Profession filtering | Excludes unrelated vacancies | Industry-based employers; vacancy category not shown consistently | Partial | Adapt for employer context | One employer may cover multiple professions |
| Region filtering | Vacancy target region and saved profile preference | Employer register region, session-only | Partial | Adapt for employer context | These are different geography concepts |
| Saved region preference | Shared with Professional Profile | Not consumed | Missing | Reuse shared helper | Label any new vacancy-region filter clearly |
| Source tabs | Board/company site separated | Mixed expanded list | Missing | Port Opportunities logic | Preserve source transparency |
| Board exclusions | LinkedIn/Indeed rejected in Send CV routes | No explicit Sponsor control | Partial | Reuse shared helper | Keep source policy server-safe |
| Contact inclusion | Requires some route | Register employers can exist without contact | Different-by-design | Keep different | Directory entries remain useful |
| Fresh-live vacancy list | Fresh-live for source tabs | Fresh-live for counts and expansion | Already aligned | Reuse shared helper | Six-hour standard aligned |
| Link status | Six explicit statuses | Same API contract | Already aligned | Reuse shared helper | OpenAPI wording should describe enum, not a boolean |
| Status presentation | Generic verified/warning copy | Non-live rows hidden | Partial | Adapt for employer context | Consider disabled evidence summary |
| Dead-as-email-only | Blocked in UI and server | Blocked in UI and server | Already aligned | Reuse shared helper | Main trust requirement satisfied |
| Exact URL identity | Server enforced | Same endpoint enforcement | Already aligned | Reuse shared helper | Prevents crafted submissions |
| Click-time link check | Main cards check asynchronously | Sponsor apply does not use same helper | Missing | Reuse shared helper | Must not block navigation |
| Freshness messaging | Server six hours; click helper twelve | Server six hours; discovery cache 24h | Partial | Reuse shared helper | Separate discovery from link health |
| Outbound extension event | Emitted | Emitted | Already aligned | Reuse shared helper | Trusted first-party event retained |
| Tracker click record | Main cards create `link_clicked`; other routes do not | Not created | Partial | Reuse shared helper | Highest-priority parity defect |
| Apply action | Vacancy URL or website fallback | Vacancy URL and careers fallback | Partial | Adapt for employer context | Careers homepage is not a vacancy |
| Smart Apply | Dedicated ATS-prefill modal | No equivalent | Missing | Port Opportunities logic | Clarify ATS support first |
| Extension gate | Apply routes gated | Vacancy/careers actions gated; informational anchors differ | Partial | Reuse shared helper | Distinguish apply intent from contact browsing |
| Vacancy Send CV | Direct contact plus live/none status | Direct contact plus live row | Already aligned | Reuse shared helper | Server gate shared |
| Email-only vacancy | Supported for genuine URL-less direct contact | Expansion is URL/live oriented | Partial | Adapt for employer context | Never infer email-only from a dead URL |
| Employer speculative CV | Not primary card flow | Explicit feature | Different-by-design | Keep different | Appropriate directory behavior |
| CV upload gate | Send CV redirects to documents | Sponsor disables or links to upload | Already aligned | Reuse shared helper | Copy differs |
| Eligibility gate | Advisory | Blocks Sponsor CV action when false | Partial | Product decision | Avoid page-dependent policy |
| Multiple CV selection | Shared modal | Shared modal | Already aligned | Reuse shared helper | Same component |
| Cover letter | Standalone and modal | Modal only | Partial | Port Opportunities logic | Optional convenience |
| AI outreach assistant | Send CV modal | Same modal | Already aligned | Reuse shared helper | Shared implementation |
| Readiness Check | Shared sheet/quota | Shared sheet/quota | Already aligned | Reuse shared helper | Record-specific endpoints |
| Match score | Unified vacancy ranking | Best vacancy score plus row scores | Partial | Adapt for employer context | Do not call it employer quality |
| Ranking bands | Apply First/Worth Considering/More | No comparable bands | Missing | Adapt for employer context | Simple row sort may be enough |
| AI Best Matches | Top-three dismissible queue | None | Missing | Port only if desired | Could undermine directory browsing |
| Dismiss/hide | AI-match dismissal | None | Missing | Adapt for employer context | Decide employer vs vacancy hiding |
| Vacancy favorite | Shared | Shared offset ID | Already aligned | Reuse shared helper | Verify outbound identity separately |
| Employer bookmark | Behavioral signal only | Full UI/filter | Different-by-design | Keep different | Sponsor-only capability |
| Search | Employer/title/location in Send CV | Employer only | Partial | Adapt for employer context | Global search is separate scope |
| Pagination | No visible pagination | 20 employers/page | Different-by-design | Keep different | Register requires pagination |
| Cache UI | AI-score cache labels | Discovery/check cache labels | Different-by-design | Keep different | Do not equate with link verification |
| Manual refresh | Retry role query | Recheck visible employers | Different-by-design | Keep different | Sponsor checks are expensive |
| Admin scan | Not exposed | Region-aware global scan | Different-by-design | Keep different | Operational feature |
| Register warning | Not applicable | Visible | Different-by-design | Keep different | Sponsor-only trust metadata |
| Vacancy detail | Eligibility summary/modal | Description/action bottom sheet | Partial | Port selected fields | Add requirements if supported |
| Sponsorship disclaimer | Licensed-sponsor tooltip | Register framing; limited vacancy copy | Partial | Reuse shared helper | Avoid vacancy-level inference |
| Safeguarding badges | Explicit | Missing in Sponsor row | Missing | Port Opportunities logic | Response fields may need expansion |
| Required registration | Displayed | Missing in Sponsor response/UI | Missing | Port Opportunities logic | Scoring may already know it |
| Application state | Applied/CV Sent role IDs | Mostly company-level CV Sent | Partial | Reuse shared helper | Keep company and vacancy states separate |
| Next matches | May show three recommendations | Modal supports this only in non-speculative mode | Partial | Keep/adapt | Clarify Sponsor semantics |
| Share/report | Not present | Not present | Already aligned | Not applicable | No parity work |
| Contact enrichment | Not a primary Opportunity action | AI web-search enrichment | Different-by-design | Defer/replace | Conflicts with current constraint |

---

# Part 4 — Implementation map

## Must-match: quality and trust

### 1. Unify outbound tracking semantics

Reuse:

- `RoleCard.trackAndOpen`
- `openTrackedOutbound`
- `openTrackedSponsorVacancy`
- Application `link_clicked` contract

Potential files:

- `artifacts/jobsage-web/src/lib/trackedOutbound.ts`
- `artifacts/jobsage-web/src/pages/SponsorLicencesPage.tsx`
- `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`
- Application route/specification as required

Every application-intent click should consistently create a tracker record, while careers-homepage visits remain distinguishable from exact-vacancy clicks. Avoid double creation where RoleCard already posts manually.

### 2. Reuse background liveness checks on Sponsor vacancy clicks

Reuse:

- `checkApplyLinkInBackground`
- `getGetSponsorLicenceVacanciesQueryKey`
- Six-hour status semantics

Navigation must remain immediate. A newly dead URL should invalidate the employer’s vacancy list/count without blocking the click.

### 3. Separate discovery-cache copy from link-verification copy

Keep these concepts separate:

- 24-hour employer vacancy discovery cache
- Six-hour exact URL verification

“Checked within 24 hours” must never look equivalent to “link verified.”

### 4. Preserve explicit sponsorship semantics

Reuse:

- `LicensedSponsorBadge`
- `sponsorshipStatus`
- `inferVacancySponsorshipStatus`

Register membership must remain employer-level. Vacancy-confirmed sponsorship must come only from vacancy evidence.

### 5. Do not reuse current AI contact enrichment

Exclude `POST /sponsor-licences/:id/enrich` from parity work until it is replaced with permitted stored/official-site evidence, provenance, and no-overwrite behavior.

## Should-match: expected candidate behavior

6. Choose one eligibility policy across both pages.

7. Add Sponsor vacancy-level profession, registration, safeguarding, and requirement presentation.

8. Add Sponsor source/board labels and shared board exclusions.

9. Align per-vacancy Applied/CV Sent state using the unified ID space.

10. Decide whether supported Sponsor vacancies receive the dedicated Smart Apply action.

11. Add vacancy title/location search while preserving employer search and employer pagination.

## Adapt: employer semantics

12. Keep employer register region and candidate vacancy region as separate concepts.

13. Keep employer score explicitly framed as the best visible vacancy score.

14. Use separate labels for:

- Apply on employer site
- Smart Apply
- Send CV for a vacancy
- Send CV speculatively

15. Consider a non-actionable evidence summary for stale/dead/unverified rows without making them clickable or email-only.

## Defer or skip

- Opportunities self-promotion card
- Dormant tracker tab inside Opportunities
- AI Best Matches on the employer directory unless product intent changes
- Share/report actions
- Paid AI web-search enrichment
- Full Opportunities ranking bands inside every employer
- Company-wide scan controls on Opportunities

---

# Part 5 — Open questions

1. Should Sponsor Licence vacancies offer the ATS Smart Apply flow, or only tracked external Apply plus Send CV?
2. Should not-yet-eligible candidates continue with advisory messaging on both surfaces?
3. Should Sponsor Licences consume the saved Professional Profile region preference?
4. Should vacancy-region filtering occur inside each employer panel or across the employer list?
5. Should Sponsor vacancy clicks create website application tracker rows immediately?
6. Should careers-homepage visits count as applications, leads, or only outbound navigation?
7. Should stale/unverified/dead evidence be visible as non-actionable evidence?
8. Should Sponsor vacancy rows show `confirmed`, `not_offered`, or `unknown` sponsorship status?
9. Should Sponsor Licences expose the existing `directContactOnly` filter?
10. Should Sponsor rows show NHS Jobs/Reed/company-site source badges?
11. Should LinkedIn/Indeed restrictions apply to Sponsor actions outside the Send CV tab?
12. Should employer-level CV Sent be shown separately from vacancy-level CV Sent?
13. Should the client click-check window be changed to six hours?
14. Should Sponsor vacancy details include safeguarding and required-registration fields?
15. Is the dormant Applications tab intended to return, or should it be treated as obsolete?
16. Should contact enrichment be removed/replaced because it uses paid AI web search?

---

# Parity backlog

## P0 — Trust and consistency

1. Unify outbound application tracking across every vacancy and careers-site action.
2. Add non-blocking Sponsor vacancy link checking using the shared checker.
3. Resolve the six-hour versus twelve-hour exact-link freshness mismatch.
4. Separate 24-hour discovery-cache messaging from six-hour URL verification.
5. Expose explicit vacancy sponsorship status without conflating it with licence membership.
6. Remove paid AI web search from any parity implementation plan.

## P1 — Action parity

7. Choose and enforce one eligibility policy across Opportunities and Sponsor Licences.
8. Add exact vacancy Applied/CV Sent state to Sponsor rows.
9. Add Sponsor vacancy source/board labels and shared board exclusions.
10. Decide whether eligible Sponsor vacancies receive the dedicated Smart Apply action.
11. Return/display required registration and safeguarding requirements on Sponsor vacancies.

## P2 — Discovery parity

12. Add vacancy-title/location search while preserving employer search.
13. Add optional candidate-preferred vacancy-region filtering without replacing register-region filtering.
14. Expose the existing direct-contact-only server filter if the product wants a Send CV-oriented employer view.
15. Consider hidden/dismissed vacancy behavior separately from employer bookmarks.

## Intentionally different

- Sector-first employer browsing
- Employer bookmarks
- Register route/rating metadata
- Careers-site fallback
- Employer-level speculative CV
- Sponsor sync/check controls
- Employer pagination
- Best-vacancy score as an employer sorting aid