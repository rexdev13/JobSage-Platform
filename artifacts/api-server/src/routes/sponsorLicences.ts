import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable, sponsorLicenceVacancyChecksTable, sponsorLicenceBookmarksTable, sponsorLicenceVacanciesTable, sponsorLicenceVacancyScoresTable } from "@workspace/db";
import { eq, ilike, and, desc, sql, isNotNull, inArray } from "drizzle-orm";
import { countyToRegion } from "../lib/countyToRegion";
import { requireAuthenticated } from "../middlewares/requireRole";
import { runVacancyCheck } from "../lib/vacancyCheckHelper";
import { startCheckAllVacancies, getCheckAllStatus } from "../lib/vacancyCheckAllRunner";

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

// ── Check All Vacancies ──────────────────────────────────────────────────────

router.post("/sponsor-licences/check-all-vacancies", requireAuthenticated, (req, res) => {
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

    // Candidates only see live or not-yet-verified vacancies; dead ones are
    // hidden pending an admin review/restore flow.
    const vacancyRows = await db
      .select()
      .from(sponsorLicenceVacanciesTable)
      .where(
        and(
          eq(sponsorLicenceVacanciesTable.organisationName, company.organisationName),
          sql`${sponsorLicenceVacanciesTable.liveness} <> 'dead'`,
        ),
      );

    const scoreRows = await db
      .select()
      .from(sponsorLicenceVacancyScoresTable)
      .where(
        and(
          eq(sponsorLicenceVacancyScoresTable.userId, userId),
          eq(sponsorLicenceVacancyScoresTable.organisationName, company.organisationName),
        ),
      );
    const scoreMap = new Map(scoreRows.map((s) => [s.vacancyId, s]));

    const [lastCheck] = await db
      .select({ checkedAt: sponsorLicenceVacancyChecksTable.checkedAt })
      .from(sponsorLicenceVacancyChecksTable)
      .where(eq(sponsorLicenceVacancyChecksTable.organisationName, company.organisationName))
      .orderBy(desc(sponsorLicenceVacancyChecksTable.checkedAt))
      .limit(1);

    const vacancies = vacancyRows
      .map((v) => {
        const s = scoreMap.get(v.id);
        return {
          id: v.id,
          title: v.title,
          location: v.location,
          salary: v.salary,
          url: v.url,
          description: v.description,
          postedDate: v.postedDate,
          matchScore: s?.score ?? null,
          isEligible: s?.isEligible ?? null,
          missingRequirements: (s?.missingRequirements as string[] | null) ?? [],
          matchExplanation: s?.explanation ?? null,
        };
      })
      .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));

    res.json({
      organisationName: company.organisationName,
      vacancies,
      lastCheckedAt: lastCheck?.checkedAt ?? null,
    });
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
    // Aggregate from persisted sponsor_licence_vacancies rows (no TTL — all
    // stored records), excluding vacancies the liveness sweep marked dead.
    const countRows = await db
      .select({
        organisationName: sponsorLicenceVacanciesTable.organisationName,
        vacancyCount: sql<number>`cast(count(*) as integer)`,
      })
      .from(sponsorLicenceVacanciesTable)
      .where(sql`${sponsorLicenceVacanciesTable.liveness} <> 'dead'`)
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
      // Latest AI-reported count, minus vacancies the liveness sweep marked dead.
      conditions.push(
        sql`0 < COALESCE((
          SELECT vacancy_count
          FROM sponsor_licence_vacancy_checks
          WHERE organisation_name = ${sponsorLicencesTable.organisationName}
          ORDER BY checked_at DESC
          LIMIT 1
        ), 0) - (
          SELECT COUNT(*)
          FROM sponsor_licence_vacancies
          WHERE organisation_name = ${sponsorLicencesTable.organisationName}
            AND liveness = 'dead'
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

    // Fetch the most recent AI-reported vacancy count per org from vacancy_checks.
    // vacancyCount here is the actual total the AI found (e.g. 40), not the count
    // of stored sample rows (which is capped at 8).
    const storedVacancyRows = await db.execute<{ organisation_name: string; vacancy_count: number | null; checked_at: string }>(
      sql`SELECT DISTINCT ON (organisation_name) organisation_name, vacancy_count, checked_at
          FROM sponsor_licence_vacancy_checks
          ORDER BY organisation_name, checked_at DESC`,
    );
    // Vacancies the liveness sweep marked dead per org — subtracted from the
    // AI-reported count so badges only reflect live (or not-yet-verified) roles.
    const deadVacancyRows = await db.execute<{ organisation_name: string; dead_count: number }>(
      sql`SELECT organisation_name, cast(count(*) as integer) AS dead_count
          FROM sponsor_licence_vacancies
          WHERE liveness = 'dead'
          GROUP BY organisation_name`,
    );
    const deadCounts = new Map<string, number>(
      deadVacancyRows.rows.map((r) => [r.organisation_name.toLowerCase().trim(), r.dead_count]),
    );
    const storedVacancyCounts = new Map<string, number>(
      storedVacancyRows.rows
        .filter((r) => r.vacancy_count !== null && r.vacancy_count > 0)
        .map((r) => {
          const key = r.organisation_name.toLowerCase().trim();
          return [key, Math.max(0, r.vacancy_count! - (deadCounts.get(key) ?? 0))];
        }),
    );
    const lastVacancyCheckedAtByOrg = new Map<string, string>(
      storedVacancyRows.rows.map((r) => [r.organisation_name.toLowerCase().trim(), r.checked_at]),
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

    const annotated = allCompanies.map((c) => {
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
      };
    });

    let filtered = annotated;
    if (bookmarkedOnly) filtered = filtered.filter((c) => c.isBookmarked);

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
      withVacancies: annotated.filter((c) => c.hasVacancies).length,
      bookmarkedCount: annotated.filter((c) => c.isBookmarked).length,
      lastSyncedAt: lastSync?.createdAt ?? null,
      lastSyncFailed,
    });
  } catch (err) {
    console.error("[sponsor-licences] list error:", err);
    res.status(500).json({ error: "Failed to fetch sponsor licence companies." });
  }
});

export default router;
