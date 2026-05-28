import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable, jobListingsTable, sponsorLicenceVacancyChecksTable } from "@workspace/db";
import { eq, ilike, and, desc, sql, isNotNull, gt } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const VACANCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

    // Check 24-hour cache
    const cutoff = new Date(Date.now() - VACANCY_CACHE_TTL_MS);
    const [cached] = await db
      .select()
      .from(sponsorLicenceVacancyChecksTable)
      .where(
        and(
          eq(sponsorLicenceVacancyChecksTable.organisationName, organisationName),
          gt(sponsorLicenceVacancyChecksTable.checkedAt, cutoff),
        ),
      )
      .orderBy(desc(sponsorLicenceVacancyChecksTable.checkedAt))
      .limit(1);

    if (cached) {
      res.json({
        vacanciesFound: cached.vacanciesFound,
        vacancyCount: cached.vacancyCount,
        sourceUrl: cached.sourceUrl,
        summary: cached.summary,
        checkedAt: cached.checkedAt,
        fromCache: true,
      });
      return;
    }

    // Use OpenAI Responses API with web_search_preview
    const query = `Current job vacancies at "${organisationName}" UK 2025`;
    let vacanciesFound = false;
    let vacancyCount: number | null = null;
    let sourceUrl: string | null = `https://www.reed.co.uk/jobs?keywords=${encodeURIComponent(organisationName)}&locationName=United+Kingdom`;
    let summary = "No active vacancies found.";

    try {
      const response = await openai.responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" as const }],
        input: `Search for current job openings at "${organisationName}" in the United Kingdom in 2025. 
Look on Reed, Indeed, LinkedIn, NHS Jobs, and the company's own careers page.
After searching, reply with a JSON block ONLY in this exact format (no extra text):
{
  "vacanciesFound": true or false,
  "vacancyCount": number or null,
  "sourceUrl": "URL to search results or careers page",
  "summary": "1-2 sentence summary of what you found"
}`,
      });

      const text = response.output_text ?? "";
      const jsonMatch = /\{[\s\S]*?"vacanciesFound"[\s\S]*?\}/.exec(text);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          vacanciesFound?: boolean;
          vacancyCount?: number | null;
          sourceUrl?: string | null;
          summary?: string;
        };
        vacanciesFound = parsed.vacanciesFound === true;
        vacancyCount = typeof parsed.vacancyCount === "number" ? parsed.vacancyCount : null;
        sourceUrl = typeof parsed.sourceUrl === "string" && parsed.sourceUrl.startsWith("http")
          ? parsed.sourceUrl
          : sourceUrl;
        summary = typeof parsed.summary === "string" ? parsed.summary : (vacanciesFound ? `Vacancies found for ${organisationName}.` : `No active vacancies found for ${organisationName}.`);
      }
    } catch (aiErr) {
      console.warn("[sponsor-licences] AI vacancy check failed:", aiErr instanceof Error ? aiErr.message : aiErr);
      // Fall through with default values — still cache the miss to avoid hammering
    }

    const [saved] = await db
      .insert(sponsorLicenceVacancyChecksTable)
      .values({ organisationName, vacanciesFound, vacancyCount, sourceUrl, summary })
      .returning();

    res.json({
      vacanciesFound,
      vacancyCount,
      sourceUrl,
      summary,
      checkedAt: saved?.checkedAt ?? new Date(),
      fromCache: false,
    });
  } catch (err) {
    console.error("[sponsor-licences] /check-vacancies error:", err);
    res.status(500).json({ error: "Vacancy check failed. Please try again." });
  }
});

router.get("/sponsor-licences/routes", requireAuthenticated, async (req, res) => {
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

router.get("/sponsor-licences/industry-counts", requireAuthenticated, async (req, res) => {
  try {
    const rows = await db
      .select({
        industry: sponsorLicencesTable.industry,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(sponsorLicencesTable)
      .where(isNotNull(sponsorLicencesTable.industry))
      .groupBy(sponsorLicencesTable.industry)
      .orderBy(desc(sql`count(*)`));

    const counts = rows
      .filter((r) => r.industry)
      .map((r) => ({ industry: r.industry as string, count: r.count }));

    res.json({ counts });
  } catch (err) {
    console.error("[sponsor-licences] /industry-counts error:", err);
    res.status(500).json({ error: "Failed to fetch industry counts." });
  }
});

router.get("/sponsor-licences/industries", requireAuthenticated, async (req, res) => {
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

router.get("/sponsor-licences", requireAuthenticated, async (req, res) => {
  try {
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
    const route = typeof req.query["route"] === "string" ? req.query["route"].trim() : "";
    const industry = typeof req.query["industry"] === "string" ? req.query["industry"].trim() : "";
    const hasVacanciesParam = req.query["hasVacancies"];
    const filterVacancies = hasVacanciesParam === "true";
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "20"), 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (search) conditions.push(ilike(sponsorLicencesTable.organisationName, `%${search}%`));
    if (route) conditions.push(eq(sponsorLicencesTable.route, route));
    if (industry) conditions.push(eq(sponsorLicencesTable.industry, industry));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const { employerProfilesTable } = await import("@workspace/db");
    const employerRows = await db
      .selectDistinct({ companyName: employerProfilesTable.companyName })
      .from(employerProfilesTable)
      .innerJoin(jobListingsTable, eq(jobListingsTable.employerProfileId, employerProfilesTable.id))
      .where(eq(jobListingsTable.status, "published"));

    const employerNamesWithVacancies = new Set(
      employerRows.map((r) => r.companyName.toLowerCase().trim()),
    );

    let companiesQuery = db
      .select()
      .from(sponsorLicencesTable)
      .$dynamic();

    if (whereClause) {
      companiesQuery = companiesQuery.where(whereClause);
    }

    const allCompanies = await companiesQuery.orderBy(sponsorLicencesTable.organisationName);

    const annotated = allCompanies.map((c) => ({
      ...c,
      hasVacancies: employerNamesWithVacancies.has(c.organisationName.toLowerCase().trim()),
    }));

    const filtered = filterVacancies ? annotated.filter((c) => c.hasVacancies) : annotated;

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
      lastSyncedAt: lastSync?.createdAt ?? null,
      lastSyncFailed,
    });
  } catch (err) {
    console.error("[sponsor-licences] list error:", err);
    res.status(500).json({ error: "Failed to fetch sponsor licence companies." });
  }
});

export default router;
