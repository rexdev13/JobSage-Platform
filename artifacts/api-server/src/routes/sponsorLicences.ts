import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { GetSponsorLicenceVacanciesParams, GetSponsorLicenceVacanciesResponse } from "@workspace/api-zod";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable, sponsorLicenceVacancyChecksTable, sponsorLicenceBookmarksTable, sponsorLicenceVacanciesTable, sponsorLicenceVacancyScoresTable, sponsorLicenceGapAnalysesTable, roleGapAnalysesTable, applicationsTable, speculativeApplicationsTable, profilesTable } from "@workspace/db";
import { eq, ilike, and, desc, sql, isNotNull, inArray, gte, ne, or } from "drizzle-orm";
import { countyToRegion } from "../lib/countyToRegion";
import {
  getVacancyLinkStatus,
  RECENT_VERIFY_SKIP_MS,
  COMPANY_SITE_VISIBLE_WINDOW_MS,
  vacancyVisibilityWindowMs,
} from "../lib/vacancyLiveness";
import { requireAuthenticated, requireRole } from "../middlewares/requireRole";
import { runVacancyCheck } from "../lib/vacancyCheckHelper";
import { startCheckAllVacancies, getCheckAllStatus } from "../lib/vacancyCheckAllRunner";
import { scoreVacanciesForCompany } from "../lib/sponsorVacancyScoring";
import { getOrGenerateGapAnalysis, LimitReachedError } from "../lib/vacancyGapAnalysis";
import { getNextReadinessReset, getReadinessMonthStart, READINESS_CHECK_LIMIT } from "../lib/readinessQuota";
import { getDirectContactEligibility } from "../lib/employerRecipient";
import { SPONSOR_VACANCY_ID_OFFSET, classifyVacancyCategory, inferSafeguardingRequirements, inferVacancySponsorshipStatus } from "../lib/sponsorVacancyRoles";
import { opportunityRegistrationLabel } from "../lib/opportunityProfession";
import { assessSafeguarding } from "../lib/safeguarding";
import { regionsFromLocationText } from "../lib/regionMatching";

const router: IRouter = Router();


// ── UK Regions ────────────────────────────────────────────────────────────────

const UK_REGIONS = [
  "London",
  "South East",
  "South West",
  "East of England",
  "East Midlands",
  "West Midlands",
  "Yorkshire and the Humber",
  "North West",
  "North East",
  "Scotland",
  "Wales",
  "Northern Ireland",
];

// ── Check Vacancies ──────────────────────────────────────────────────────────

router.post("/sponsor-licences/:id/check-vacancies", requireAuthenticated, async (req, res) => {
  try {
    const rawId = typeof req.params["id"] === "string" ? req.params["id"] : "";
    const id = parseInt(rawId, 10);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: "Invalid company ID." });
      return;
    }

    const [company] = await db
      .select({ organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicencesTable)
      .where(eq(sponsorLicencesTable.id, id))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Company not found." });
      return;
    }

    const { organisationName } = company;
    const result = await runVacancyCheck(organisationName);
    res.json(result);
  } catch (err) {
    console.error("[sponsor-licences] /check-vacancies error:", err);
    res.status(500).json({ error: "Vacancy check failed. Please try again." });
  }
});

// ── Batch Check (visible page) ───────────────────────────────────────────────

const BATCH_MAX_IDS = 20;
const BATCH_CONCURRENCY = 15;
const BATCH_COOLDOWN_MS = 45_000;
const batchCooldowns = new Map<string, number>();

router.post("/sponsor-licences/check-batch", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rawIds: unknown = req.body?.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array of company IDs." });
      return;
    }
    if (rawIds.length > BATCH_MAX_IDS) {
      res.status(400).json({ error: `A maximum of ${BATCH_MAX_IDS} ids may be checked per batch.` });
      return;
    }
    const ids = [...new Set(rawIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))];
    if (ids.length === 0) {
      res.status(400).json({ error: "ids must contain valid numeric company IDs." });
      return;
    }

    const now = Date.now();
    const cooldownUntil = batchCooldowns.get(userId) ?? 0;
    if (cooldownUntil > now) {
      const retryAfterSeconds = Math.ceil((cooldownUntil - now) / 1000);
      res.status(429).json({
        error: `Please wait ${retryAfterSeconds}s before refreshing again.`,
        retryAfterSeconds,
      });
      return;
    }
    batchCooldowns.set(userId, now + BATCH_COOLDOWN_MS);

    const companies = await db
      .select({ id: sponsorLicencesTable.id, organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicencesTable)
      .where(inArray(sponsorLicencesTable.id, ids));

    // Distinct organisation names → one AI check per org, shared across ids.
    const orgNames = [...new Set(companies.map((c) => c.organisationName))];
    const orgResults = new Map<
      string,
      { vacanciesFound: boolean; vacancyCount: number | null; checkedAt: string; fromCache: boolean; error: string | null }
    >();

    let orgIdx = 0;
    async function worker(): Promise<void> {
      while (orgIdx < orgNames.length) {
        const name = orgNames[orgIdx++];
        if (!name) continue;
        try {
          const r = await runVacancyCheck(name);
          orgResults.set(name, {
            vacanciesFound: r.vacanciesFound,
            vacancyCount: r.vacancyCount,
            checkedAt: r.checkedAt.toISOString(),
            fromCache: r.fromCache,
            error: null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[check-batch] Failed for "${name}":`, msg);
          orgResults.set(name, {
            vacanciesFound: false,
            vacancyCount: null,
            checkedAt: new Date().toISOString(),
            fromCache: false,
            error: msg.slice(0, 500),
          });
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, orgNames.length || 1) }, () => worker()),
    );

    const results = companies.map((c) => {
      const r = orgResults.get(c.organisationName);
      return {
        id: c.id,
        organisationName: c.organisationName,
        vacanciesFound: r?.vacanciesFound ?? false,
        vacancyCount: r?.vacancyCount ?? null,
        checkedAt: r?.checkedAt ?? null,
        fromCache: r?.fromCache ?? false,
        error: r?.error ?? null,
      };
    });

    res.json({
      results,
      checkedOrganisations: orgNames.length,
      newChecks: results.filter((r) => r.error === null && !r.fromCache).length,
      cacheHits: results.filter((r) => r.fromCache).length,
      errors: results.filter((r) => r.error !== null).length,
    });
  } catch (err) {
    console.error("[sponsor-licences] /check-batch error:", err);
    res.status(500).json({ error: "Batch vacancy check failed. Please try again." });
  }
});

// ── Check All Vacancies (admin only) ─────────────────────────────────────────

router.post("/sponsor-licences/check-all-vacancies", requireRole("admin", "super_admin"), (req, res) => {
  try {
    const userId = req.user!.id;
    const rawRegions = req.body?.regions;
    const regions: string[] | undefined =
      Array.isArray(rawRegions) && rawRegions.every((r: unknown) => typeof r === "string")
        ? (rawRegions as string[])
        : undefined;
    const result = startCheckAllVacancies(userId, regions);
    res.json(result);
  } catch (err) {
    console.error("[sponsor-licences] /check-all-vacancies POST error:", err);
    res.status(500).json({ error: "Failed to start vacancy check." });
  }
});

router.get("/sponsor-licences/check-all-vacancies/status", requireAuthenticated, (_req, res) => {
  res.json(getCheckAllStatus());
});

// ── Employer Vacancies (ranked by suitability) ────────────────────────────────

router.get("/sponsor-licences/:id/vacancies", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const parsedParams = GetSponsorLicenceVacanciesParams.safeParse(req.params);
    const id = parsedParams.success ? parsedParams.data.id : Number.NaN;
    if (!id || !Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid company ID." });
      return;
    }

    const [company] = await db
      .select({ organisationName: sponsorLicencesTable.organisationName })
      .from(sponsorLicencesTable)
      .where(eq(sponsorLicencesTable.id, id))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Company not found." });
      return;
    }

    // Expanded actionable vacancies use the same confirmed-live bar as counts.
    const allVacancyRows = await db
      .select()
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.organisationName, company.organisationName));
    const vacancyRows = allVacancyRows.filter(
      (vacancy) => getVacancyLinkStatus(
        vacancy.url,
        vacancy.liveness,
        vacancy.lastVerifiedAt,
        vacancy.livenessReason,
        vacancyVisibilityWindowMs(vacancy.sourceType),
      ) === "live",
    );

    let scoreRows = await db
      .select()
      .from(sponsorLicenceVacancyScoresTable)
      .where(
        and(
          eq(sponsorLicenceVacancyScoresTable.userId, userId),
          eq(sponsorLicenceVacancyScoresTable.organisationName, company.organisationName),
        ),
      );
    let scoreMap = new Map(scoreRows.map((s) => [s.vacancyId, s]));

    // On-demand best-fit scoring: if any of this employer's vacancies have no
    // cached score for this candidate, score them now so "Check Best Fit"
    // always returns a numeric match percentage.
    const hasUnscored = vacancyRows.some((v) => !scoreMap.has(v.id));
    if (hasUnscored) {
      try {
        await scoreVacanciesForCompany(userId, company.organisationName);
        scoreRows = await db
          .select()
          .from(sponsorLicenceVacancyScoresTable)
          .where(
            and(
              eq(sponsorLicenceVacancyScoresTable.userId, userId),
              eq(sponsorLicenceVacancyScoresTable.organisationName, company.organisationName),
            ),
          );
        scoreMap = new Map(scoreRows.map((s) => [s.vacancyId, s]));
      } catch (scoreErr) {
        // Scoring failure should not block the vacancy list — scores stay null.
        console.error("[sponsor-licences] on-demand scoring failed:", scoreErr);
      }
    }

    const [[lastCheck], [profile], appliedApps, cvSends] = await Promise.all([
      db
        .select({ checkedAt: sponsorLicenceVacancyChecksTable.checkedAt })
        .from(sponsorLicenceVacancyChecksTable)
        .where(eq(sponsorLicenceVacancyChecksTable.organisationName, company.organisationName))
        .orderBy(desc(sponsorLicenceVacancyChecksTable.checkedAt))
        .limit(1),
      db
        .select({
          dbsClearanceLevel: profilesTable.dbsClearanceLevel,
          safeguardingTrainingLevel: profilesTable.safeguardingTrainingLevel,
        })
        .from(profilesTable)
        .where(eq(profilesTable.userId, userId))
        .limit(1),
      db
        .select({ roleId: applicationsTable.roleId, status: applicationsTable.status })
        .from(applicationsTable)
        .where(eq(applicationsTable.userId, userId)),
      db
        .select({
          roleId: speculativeApplicationsTable.roleId,
          vacancyRef: speculativeApplicationsTable.vacancyRef,
          vacancyTitle: speculativeApplicationsTable.vacancyTitle,
        })
        .from(speculativeApplicationsTable)
        .where(eq(speculativeApplicationsTable.userId, userId)),
    ]);
    const appliedRoleIds = new Set(
      appliedApps
        .filter((application) => application.status !== "link_clicked")
        .map((application) => application.roleId),
    );
    const cvSentRoleIds = new Set(
      cvSends.flatMap((application) => {
        if (application.roleId != null) return [application.roleId];
        const vacancyId = application.vacancyRef?.match(/^sponsor-vacancy:(\d+)$/)?.[1];
        return vacancyId ? [Number(vacancyId) + SPONSOR_VACANCY_ID_OFFSET] : [];
      }),
    );

    const vacancies = vacancyRows
      .map((v) => {
        const s = scoreMap.get(v.id);
        const inferredRequirements =
          v.requiredDbsClearanceLevel == null || v.requiredSafeguardingLevel == null
            ? inferSafeguardingRequirements(v.title, v.description)
            : null;
        const requiredDbsClearanceLevel = v.requiredDbsClearanceLevel ?? inferredRequirements?.requiredDbsClearanceLevel ?? null;
        const requiredSafeguardingLevel = v.requiredSafeguardingLevel ?? inferredRequirements?.requiredSafeguardingLevel ?? null;
        const category = classifyVacancyCategory(v.title, v.description);
        const linkStatus = getVacancyLinkStatus(
          v.url,
          v.liveness,
          v.lastVerifiedAt,
          v.livenessReason,
          vacancyVisibilityWindowMs(v.sourceType),
        );
        const roleId = v.id + SPONSOR_VACANCY_ID_OFFSET;
        return {
          id: v.id,
          roleId,
          title: v.title,
          sponsorshipStatus: inferVacancySponsorshipStatus(v.title, v.description),
          requiredRegistration: category ? opportunityRegistrationLabel(category) : "Not specified",
          requiredDbsClearanceLevel,
          requiredSafeguardingLevel,
          safeguarding: assessSafeguarding(
            {
              dbsClearanceLevel: profile?.dbsClearanceLevel ?? null,
              safeguardingTrainingLevel: profile?.safeguardingTrainingLevel ?? null,
            },
            { requiredDbsClearanceLevel, requiredSafeguardingLevel },
          ),
          location: v.location,
          salary: v.salary,
          url: v.url,
          linkStatus,
          linkVerified: linkStatus === "live",
          linkCheckedAt: v.lastVerifiedAt ?? null,
          description: v.description,
          postedDate: v.postedDate,
          targetRegions:
            Array.isArray(v.targetRegions) && v.targetRegions.length > 0
              ? v.targetRegions
              : regionsFromLocationText(v.location),
          sourceType: v.sourceType,
          boardName: v.boardName,
          matchScore: s?.score ?? null,
          isEligible: s?.isEligible ?? null,
          missingRequirements: (s?.missingRequirements as string[] | null) ?? [],
          matchExplanation: s?.explanation ?? null,
          applied: appliedRoleIds.has(roleId),
          cvSent: cvSentRoleIds.has(roleId),
        };
      })
      .sort((a, b) => {
        // 1. matchScore DESC — unscored items (null) treated as -1, pushed to bottom
        const sa = a.matchScore ?? -1;
        const sb = b.matchScore ?? -1;
        if (sb !== sa) return sb - sa;
        // 2. id DESC — higher (newer) DB row first
        if (b.id !== a.id) return b.id - a.id;
        // 3. title ASC — alphabetical as final stable tie-break
        return (a.title ?? "").localeCompare(b.title ?? "", "en", { sensitivity: "base" });
      });

    const nonLiveReasons = [...new Set(
      allVacancyRows
        .filter((vacancy) => getVacancyLinkStatus(
          vacancy.url,
          vacancy.liveness,
          vacancy.lastVerifiedAt,
          vacancy.livenessReason,
          vacancyVisibilityWindowMs(vacancy.sourceType),
        ) !== "live")
        .map((vacancy) => vacancy.livenessReason?.trim() || getVacancyLinkStatus(
          vacancy.url,
          vacancy.liveness,
          vacancy.lastVerifiedAt,
          vacancy.livenessReason,
          vacancyVisibilityWindowMs(vacancy.sourceType),
        ))
        .filter(Boolean),
    )].slice(0, 5);

    res.json(GetSponsorLicenceVacanciesResponse.parse({
      organisationName: company.organisationName,
      vacancies,
      lastCheckedAt: lastCheck?.checkedAt ?? null,
      nonLiveEvidence: {
        count: allVacancyRows.length - vacancyRows.length,
        reasons: nonLiveReasons,
      },
    }));
  } catch (err) {
    console.error("[sponsor-licences] /:id/vacancies error:", err);
    res.status(500).json({ error: "Failed to fetch vacancies." });
  }
});

// ── Enrich Contact Details ────────────────────────────────────────────────────

router.post("/sponsor-licences/:id/enrich", requireAuthenticated, async (req, res) => {
  try {
    const rawId = typeof req.params["id"] === "string" ? req.params["id"] : "";
    const id = parseInt(rawId, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "Invalid company id." });

    const [company] = await db
      .select()
      .from(sponsorLicencesTable)
      .where(eq(sponsorLicencesTable.id, id))
      .limit(1);
    if (!company) return void res.status(404).json({ error: "Company not found." });

    const { openai } = await import("@workspace/integrations-openai-ai-server");

    const prompt = `You are a UK business researcher. Find publicly available contact details for the following UK company from their own website or reputable directories. Return ONLY a JSON object (no markdown, no commentary) with these exact keys:
- "website": the company's main website URL (must start with https:// or http://) or null
- "contactEmail": a contact or HR email address or null
- "contactPhone": a UK phone number (include country code if available) or null
- "address": the full business address including postcode or null

Company name: ${company.organisationName}
Location hint: ${[company.townCity, company.county].filter(Boolean).join(", ") || "United Kingdom"}

Only include information you are confident about. Return null for any field you cannot find.`;

    let website: string | null = null;
    let contactEmail: string | null = null;
    let contactPhone: string | null = null;
    let address: string | null = null;

    try {
      const response = await openai.responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: prompt,
      });

      const text = response.output_text?.trim() ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, string | null>;
        website = typeof parsed["website"] === "string" ? parsed["website"] : null;
        contactEmail = typeof parsed["contactEmail"] === "string" ? parsed["contactEmail"] : null;
        contactPhone = typeof parsed["contactPhone"] === "string" ? parsed["contactPhone"] : null;
        address = typeof parsed["address"] === "string" ? parsed["address"] : null;
      }
    } catch (aiErr) {
      console.error("[sponsor-licences] enrich AI error:", aiErr);
    }

    await db
      .update(sponsorLicencesTable)
      .set({ website, contactEmail, contactPhone, address })
      .where(eq(sponsorLicencesTable.id, id));

    res.json({ website, contactEmail, contactPhone, address });
  } catch (err) {
    console.error("[sponsor-licences] /:id/enrich error:", err);
    res.status(500).json({ error: "Failed to enrich contact details." });
  }
});

// ── Vacancy Stats ─────────────────────────────────────────────────────────────

router.get("/sponsor-licences/vacancy-stats", requireAuthenticated, async (_req, res) => {
  try {
    // Candidate-facing vacancy statistics only count live, source-classified
    // rows with a specific URL. Historical, unverified, and legacy rows must
    // not inflate the banner.
    const countRows = await db
      .select({
        organisationName: sponsorLicenceVacanciesTable.organisationName,
        vacancyCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(sponsorLicenceVacanciesTable)
      .where(
        and(
          eq(sponsorLicenceVacanciesTable.liveness, "live"),
          or(
            and(
              eq(sponsorLicenceVacanciesTable.sourceType, "company_site"),
              gte(
                sponsorLicenceVacanciesTable.lastVerifiedAt,
                new Date(Date.now() - COMPANY_SITE_VISIBLE_WINDOW_MS),
              ),
            ),
            and(
              ne(sponsorLicenceVacanciesTable.sourceType, "company_site"),
              gte(
                sponsorLicenceVacanciesTable.lastVerifiedAt,
                new Date(Date.now() - RECENT_VERIFY_SKIP_MS),
              ),
            ),
          ),
          isNotNull(sponsorLicenceVacanciesTable.sourceType),
          isNotNull(sponsorLicenceVacanciesTable.url),
        ),
      )
      .groupBy(sponsorLicenceVacanciesTable.organisationName);

    const companiesWithVacancies = countRows.length;
    const totalVacanciesFound = countRows.reduce((acc, r) => acc + r.vacancyCount, 0);

    // companiesChecked = organisations that have ever had a check run
    const [checkedCountRow] = await db
      .select({ count: sql<number>`cast(count(distinct organisation_name) as integer)` })
      .from(sponsorLicenceVacancyChecksTable);
    const companiesChecked = checkedCountRow?.count ?? 0;

    res.json({ companiesChecked, companiesWithVacancies, totalVacanciesFound });
  } catch (err) {
    console.error("[sponsor-licences] /vacancy-stats error:", err);
    res.status(500).json({ error: "Failed to fetch vacancy stats." });
  }
});

// ── Regions ──────────────────────────────────────────────────────────────────

router.get("/sponsor-licences/regions", requireAuthenticated, (_req, res) => {
  res.json({ regions: UK_REGIONS });
});

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/sponsor-licences/routes", requireAuthenticated, async (_req, res) => {
  try {
    const rows = await db
      .selectDistinct({ route: sponsorLicencesTable.route })
      .from(sponsorLicencesTable)
      .where(isNotNull(sponsorLicencesTable.route))
      .orderBy(sponsorLicencesTable.route);

    const routes = rows.map((r) => r.route).filter(Boolean) as string[];
    res.json({ routes });
  } catch (err) {
    console.error("[sponsor-licences] /routes error:", err);
    res.status(500).json({ error: "Failed to fetch routes." });
  }
});

// ── Industry Counts ──────────────────────────────────────────────────────────

router.get("/sponsor-licences/industry-counts", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rows = await db
      .select({
        industry: sponsorLicencesTable.industry,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(sponsorLicencesTable)
      .where(isNotNull(sponsorLicencesTable.industry))
      .groupBy(sponsorLicencesTable.industry)
      .orderBy(desc(sql`count(*)`));

    const bookmarkRows = await db
      .select({
        industry: sponsorLicencesTable.industry,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(sponsorLicenceBookmarksTable)
      .innerJoin(sponsorLicencesTable, eq(sponsorLicencesTable.id, sponsorLicenceBookmarksTable.sponsorLicenceId))
      .where(and(
        eq(sponsorLicenceBookmarksTable.userId, userId),
        isNotNull(sponsorLicencesTable.industry),
      ))
      .groupBy(sponsorLicencesTable.industry);

    const bookmarkedByIndustry = new Map(
      bookmarkRows.filter((r) => r.industry).map((r) => [r.industry as string, r.count]),
    );

    const counts = rows
      .filter((r) => r.industry)
      .map((r) => ({
        industry: r.industry as string,
        count: r.count,
        bookmarkedCount: bookmarkedByIndustry.get(r.industry as string) ?? 0,
      }));

    res.json({ counts });
  } catch (err) {
    console.error("[sponsor-licences] /industry-counts error:", err);
    res.status(500).json({ error: "Failed to fetch industry counts." });
  }
});

// ── Industries ───────────────────────────────────────────────────────────────

router.get("/sponsor-licences/industries", requireAuthenticated, async (_req, res) => {
  try {
    const rows = await db
      .selectDistinct({ industry: sponsorLicencesTable.industry })
      .from(sponsorLicencesTable)
      .where(isNotNull(sponsorLicencesTable.industry))
      .orderBy(sponsorLicencesTable.industry);

    const industries = rows.map((r) => r.industry).filter(Boolean) as string[];
    res.json({ industries });
  } catch (err) {
    console.error("[sponsor-licences] /industries error:", err);
    res.status(500).json({ error: "Failed to fetch industries." });
  }
});

// ── Bookmarks ─────────────────────────────────────────────────────────────────

router.get("/sponsor-licences/bookmarks", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const bookmarks = await db
      .select({
        id: sponsorLicenceBookmarksTable.id,
        sponsorLicenceId: sponsorLicenceBookmarksTable.sponsorLicenceId,
        createdAt: sponsorLicenceBookmarksTable.createdAt,
      })
      .from(sponsorLicenceBookmarksTable)
      .where(eq(sponsorLicenceBookmarksTable.userId, userId))
      .orderBy(desc(sponsorLicenceBookmarksTable.createdAt));

    res.json({ bookmarks });
  } catch (err) {
    console.error("[sponsor-licences] /bookmarks GET error:", err);
    res.status(500).json({ error: "Failed to fetch bookmarks." });
  }
});

router.post("/sponsor-licences/:id/bookmark", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rawId = typeof req.params["id"] === "string" ? req.params["id"] : "";
    const sponsorLicenceId = parseInt(rawId, 10);
    if (!sponsorLicenceId || isNaN(sponsorLicenceId)) {
      res.status(400).json({ error: "Invalid company ID." });
      return;
    }

    const [company] = await db
      .select({ id: sponsorLicencesTable.id })
      .from(sponsorLicencesTable)
      .where(eq(sponsorLicencesTable.id, sponsorLicenceId))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Company not found." });
      return;
    }

    await db
      .insert(sponsorLicenceBookmarksTable)
      .values({ userId, sponsorLicenceId })
      .onConflictDoNothing();

    res.json({ bookmarked: true, sponsorLicenceId });
  } catch (err) {
    console.error("[sponsor-licences] /bookmark POST error:", err);
    res.status(500).json({ error: "Failed to bookmark company." });
  }
});

router.delete("/sponsor-licences/:id/bookmark", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rawId = typeof req.params["id"] === "string" ? req.params["id"] : "";
    const sponsorLicenceId = parseInt(rawId, 10);
    if (!sponsorLicenceId || isNaN(sponsorLicenceId)) {
      res.status(400).json({ error: "Invalid company ID." });
      return;
    }

    await db
      .delete(sponsorLicenceBookmarksTable)
      .where(
        and(
          eq(sponsorLicenceBookmarksTable.userId, userId),
          eq(sponsorLicenceBookmarksTable.sponsorLicenceId, sponsorLicenceId),
        ),
      );

    res.json({ bookmarked: false, sponsorLicenceId });
  } catch (err) {
    console.error("[sponsor-licences] /bookmark DELETE error:", err);
    res.status(500).json({ error: "Failed to remove bookmark." });
  }
});

// ── List Sponsor Licences ─────────────────────────────────────────────────────

router.get("/sponsor-licences", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
    const route = typeof req.query["route"] === "string" ? req.query["route"].trim() : "";
    const industry = typeof req.query["industry"] === "string" ? req.query["industry"].trim() : "";
    const rawRegion = req.query["region"];
    const regions: string[] = Array.isArray(rawRegion)
      ? (rawRegion as string[]).map((r) => r.trim()).filter(Boolean)
      : typeof rawRegion === "string" && rawRegion.trim()
        ? [rawRegion.trim()]
        : [];
    const hasVacanciesParam = req.query["hasVacancies"];
    const filterVacancies = hasVacanciesParam === "true";
    const directContactOnly = req.query["directContactOnly"] === "true";
    const bookmarkedOnly = req.query["bookmarkedOnly"] === "true";
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "20"), 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (search) conditions.push(ilike(sponsorLicencesTable.organisationName, `%${search}%`));
    if (route) conditions.push(eq(sponsorLicencesTable.route, route));
    if (industry) conditions.push(eq(sponsorLicencesTable.industry, industry));
    if (regions.length > 0) conditions.push(inArray(sponsorLicencesTable.region, regions));
    if (filterVacancies) {
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM sponsor_licence_vacancies
          WHERE organisation_name = ${sponsorLicencesTable.organisationName}
            AND liveness = 'live'
            AND last_verified_at >= now() - CASE
              WHEN source_type = 'company_site' THEN interval '48 hours'
              ELSE interval '6 hours'
            END
            AND source_type IS NOT NULL
            AND url IS NOT NULL
        )`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const bookmarkRows = await db
      .select({ sponsorLicenceId: sponsorLicenceBookmarksTable.sponsorLicenceId })
      .from(sponsorLicenceBookmarksTable)
      .where(eq(sponsorLicenceBookmarksTable.userId, userId));
    const bookmarkedIds = new Set(bookmarkRows.map((b) => b.sponsorLicenceId));

    let companiesQuery = db
      .select()
      .from(sponsorLicencesTable)
      .$dynamic();

    if (whereClause) {
      companiesQuery = companiesQuery.where(whereClause);
    }

    const allCompanies = await companiesQuery.orderBy(sponsorLicencesTable.organisationName);
    const directContactEligibility = await getDirectContactEligibility(
      allCompanies.map((company) => ({
        companyName: company.organisationName,
        sponsorLicenceId: company.id,
      })),
    );

    const visibleVacancyRows = await db.execute<{ organisation_name: string; vacancy_count: number }>(
      sql`SELECT lower(trim(organisation_name)) AS organisation_name,
                 cast(count(*) as integer) AS vacancy_count
          FROM sponsor_licence_vacancies
          WHERE liveness = 'live'
            AND last_verified_at >= now() - CASE
              WHEN source_type = 'company_site' THEN interval '48 hours'
              ELSE interval '6 hours'
            END
            AND source_type IS NOT NULL
            AND url IS NOT NULL
          GROUP BY lower(trim(organisation_name))`,
    );
    const latestCheckRows = await db.execute<{ organisation_name: string; checked_at: string }>(
      sql`SELECT DISTINCT ON (organisation_name) organisation_name, checked_at
          FROM sponsor_licence_vacancy_checks
          ORDER BY organisation_name, checked_at DESC`,
    );
    const storedVacancyCounts = new Map<string, number>(
      visibleVacancyRows.rows.map((r) => [r.organisation_name, r.vacancy_count]),
    );
    const lastVacancyCheckedAtByOrg = new Map<string, string>(
      latestCheckRows.rows.map((r) => [r.organisation_name.toLowerCase().trim(), r.checked_at]),
    );

    // Top vacancy match score/eligibility per org for the current candidate.
    const matchScoreRows = await db.execute<{ organisation_name: string; score: number; is_eligible: boolean }>(
      sql`SELECT DISTINCT ON (organisation_name) organisation_name, score, is_eligible
          FROM sponsor_licence_vacancy_scores
          WHERE user_id = ${userId}
          ORDER BY organisation_name, score DESC`,
    );
    const matchScoresByOrg = new Map<string, { score: number; isEligible: boolean }>(
      matchScoreRows.rows.map((r) => [r.organisation_name.toLowerCase().trim(), { score: r.score, isEligible: r.is_eligible }]),
    );

    const annotated = allCompanies.map((c, index) => {
      const key = c.organisationName.toLowerCase().trim();
      const storedVacancyCount = storedVacancyCounts.get(key) ?? null;
      const match = matchScoresByOrg.get(key);
      return {
        ...c,
        hasVacancies: storedVacancyCount !== null && storedVacancyCount > 0,
        storedVacancyCount,
        isBookmarked: bookmarkedIds.has(c.id),
        region: c.region ?? countyToRegion(c.county),
        matchScore: match?.score ?? null,
        matchIsEligible: match?.isEligible ?? null,
        lastVacancyCheckedAt: lastVacancyCheckedAtByOrg.get(key) ?? null,
        sendCvEligible: directContactEligibility[index] === true,
      };
    });

    // Ordering: confirmed live vacancies first (best match % first within the
    // group), then companies never checked, then companies confirmed to have
    // no vacancies. Alphabetical as a stable tie-break within each group.
    const sortGroup = (c: (typeof annotated)[number]): number => {
      if (c.hasVacancies) return 0;
      const checked = lastVacancyCheckedAtByOrg.has(c.organisationName.toLowerCase().trim());
      return checked ? 2 : 1;
    };
    annotated.sort((a, b) => {
      const ga = sortGroup(a);
      const gb = sortGroup(b);
      if (ga !== gb) return ga - gb;
      if (ga === 0) {
        // 1. bestFitScore DESC
        const sa = a.matchScore ?? -1;
        const sb = b.matchScore ?? -1;
        if (sa !== sb) return sb - sa;
        // 2. storedVacancyCount DESC — more live vacancies ranked higher on equal scores
        const va = a.storedVacancyCount ?? 0;
        const vb = b.storedVacancyCount ?? 0;
        if (va !== vb) return vb - va;
      }
      // 3. organisationName ASC — stable alphabetical tie-break for all groups
      return a.organisationName.localeCompare(b.organisationName, "en", { sensitivity: "base" });
    });

    let filtered = annotated;
    if (bookmarkedOnly) filtered = filtered.filter((c) => c.isBookmarked);
    if (directContactOnly) filtered = filtered.filter((c) => c.sendCvEligible);

    const total = filtered.length;
    const companies = filtered.slice(offset, offset + limit);

    const [lastSync] = await db
      .select({ createdAt: sponsorLicenceSyncLogTable.createdAt })
      .from(sponsorLicenceSyncLogTable)
      .where(eq(sponsorLicenceSyncLogTable.status, "success"))
      .orderBy(desc(sponsorLicenceSyncLogTable.createdAt))
      .limit(1);

    const [lastAttempt] = await db
      .select()
      .from(sponsorLicenceSyncLogTable)
      .orderBy(desc(sponsorLicenceSyncLogTable.createdAt))
      .limit(1);

    const lastSyncFailed =
      lastAttempt?.status === "error" &&
      (!lastSync || lastAttempt.createdAt > lastSync.createdAt);

    res.json({
      companies,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      withVacancies: new Set(
        annotated
          .filter((c) => c.hasVacancies)
          .map((c) => c.organisationName.toLowerCase().trim()),
      ).size,
      bookmarkedCount: annotated.filter((c) => c.isBookmarked).length,
      lastSyncedAt: lastSync?.createdAt ?? null,
      lastSyncFailed,
    });
  } catch (err) {
    console.error("[sponsor-licences] list error:", err);
    res.status(500).json({ error: "Failed to fetch sponsor licence companies." });
  }
});

// ── Gap Analysis Usage (candidate's own) ─────────────────────────────────────

router.get("/sponsor-licences/gap-analyses/usage", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const monthStart = getReadinessMonthStart();
    const [[sponsorRow], [roleRow]] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(sponsorLicenceGapAnalysesTable)
        .where(and(
          eq(sponsorLicenceGapAnalysesTable.userId, userId),
          gte(sponsorLicenceGapAnalysesTable.generatedAt, monthStart),
        )),
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(roleGapAnalysesTable)
        .where(and(
          eq(roleGapAnalysesTable.userId, userId),
          gte(roleGapAnalysesTable.generatedAt, monthStart),
        )),
    ]);
    res.json({
      used: (sponsorRow?.count ?? 0) + (roleRow?.count ?? 0),
      limit: READINESS_CHECK_LIMIT,
      resetsAt: getNextReadinessReset().toISOString(),
    });
  } catch (err) {
    console.error("[sponsor-licences] /gap-analyses/usage error:", err);
    res.status(500).json({ error: "Failed to fetch usage." });
  }
});

// ── Gap Analysis Admin: view and reset a candidate's quota ────────────────────

router.get("/sponsor-licences/gap-analyses/usage/:userId", requireRole("admin"), async (req, res) => {
  try {
    const targetUserId = typeof req.params["userId"] === "string" ? req.params["userId"] : "";
    if (!targetUserId) return void res.status(400).json({ error: "Invalid user ID." });
    const monthStart = getReadinessMonthStart();
    const [[sponsorRow], [roleRow]] = await Promise.all([
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(sponsorLicenceGapAnalysesTable)
        .where(and(
          eq(sponsorLicenceGapAnalysesTable.userId, targetUserId),
          gte(sponsorLicenceGapAnalysesTable.generatedAt, monthStart),
        )),
      db.select({ count: sql<number>`cast(count(*) as integer)` })
        .from(roleGapAnalysesTable)
        .where(and(
          eq(roleGapAnalysesTable.userId, targetUserId),
          gte(roleGapAnalysesTable.generatedAt, monthStart),
        )),
    ]);
    res.json({
      used: (sponsorRow?.count ?? 0) + (roleRow?.count ?? 0),
      limit: READINESS_CHECK_LIMIT,
      resetsAt: getNextReadinessReset().toISOString(),
    });
  } catch (err) {
    console.error("[sponsor-licences] /gap-analyses/usage/:userId error:", err);
    res.status(500).json({ error: "Failed to fetch usage." });
  }
});

router.delete("/sponsor-licences/gap-analyses/:userId", requireRole("admin"), async (req, res) => {
  try {
    const targetUserId = typeof req.params["userId"] === "string" ? req.params["userId"] : "";
    if (!targetUserId) return void res.status(400).json({ error: "Invalid user ID." });
    await Promise.all([
      db.delete(sponsorLicenceGapAnalysesTable).where(eq(sponsorLicenceGapAnalysesTable.userId, targetUserId)),
      db.delete(roleGapAnalysesTable).where(eq(roleGapAnalysesTable.userId, targetUserId)),
    ]);
    res.json({ reset: true });
  } catch (err) {
    console.error("[sponsor-licences] /gap-analyses/:userId DELETE error:", err);
    res.status(500).json({ error: "Failed to reset quota." });
  }
});

// ── Gap Analysis ──────────────────────────────────────────────────────────────
// Deep per-vacancy AI gap analysis. Cached for 7 days per user+vacancy.
// Monthly limit: 10 new analyses per candidate (enforced in vacancyGapAnalysis.ts).

router.get("/sponsor-licences/vacancies/:vacancyId/gap-analysis", requireAuthenticated, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rawId = typeof req.params["vacancyId"] === "string" ? req.params["vacancyId"] : "";
    const vacancyId = parseInt(rawId, 10);
    if (!vacancyId || isNaN(vacancyId)) {
      res.status(400).json({ error: "Invalid vacancy ID." });
      return;
    }

    const result = await getOrGenerateGapAnalysis(userId, vacancyId);
    res.json(result);
  } catch (err) {
    if (err instanceof LimitReachedError) {
      res.status(429).json({
        error: "You have used all 10 of your Readiness Checks this month.",
        resetsAt: getNextReadinessReset().toISOString(),
      });
      return;
    }
    console.error("[sponsor-licences] /gap-analysis error:", err);
    res.status(500).json({ error: "Failed to generate gap analysis." });
  }
});

export default router;
