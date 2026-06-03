import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable, jobListingsTable, sponsorLicenceVacancyChecksTable, sponsorLicenceBookmarksTable } from "@workspace/db";
import { eq, ilike, and, desc, sql, isNotNull, gt } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const VACANCY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── County → UK Region mapping ──────────────────────────────────────────────

const COUNTY_TO_REGION: Record<string, string> = {
  "london": "London",
  "greater london": "London",
  "city of london": "London",
  "surrey": "South East",
  "kent": "South East",
  "east sussex": "South East",
  "west sussex": "South East",
  "hampshire": "South East",
  "berkshire": "South East",
  "buckinghamshire": "South East",
  "oxfordshire": "South East",
  "isle of wight": "South East",
  "brighton and hove": "South East",
  "southampton": "South East",
  "portsmouth": "South East",
  "reading": "South East",
  "slough": "South East",
  "bracknell forest": "South East",
  "windsor and maidenhead": "South East",
  "wokingham": "South East",
  "medway": "South East",
  "milton keynes": "South East",
  "dorset": "South West",
  "somerset": "South West",
  "devon": "South West",
  "cornwall": "South West",
  "wiltshire": "South West",
  "gloucestershire": "South West",
  "bristol": "South West",
  "bath and north east somerset": "South West",
  "north somerset": "South West",
  "south gloucestershire": "South West",
  "swindon": "South West",
  "bournemouth": "South West",
  "poole": "South West",
  "bournemouth, christchurch and poole": "South West",
  "torbay": "South West",
  "plymouth": "South West",
  "essex": "East of England",
  "hertfordshire": "East of England",
  "bedfordshire": "East of England",
  "cambridgeshire": "East of England",
  "norfolk": "East of England",
  "suffolk": "East of England",
  "peterborough": "East of England",
  "luton": "East of England",
  "southend-on-sea": "East of England",
  "thurrock": "East of England",
  "central bedfordshire": "East of England",
  "bedford": "East of England",
  "leicestershire": "East Midlands",
  "lincolnshire": "East Midlands",
  "derbyshire": "East Midlands",
  "nottinghamshire": "East Midlands",
  "northamptonshire": "East Midlands",
  "rutland": "East Midlands",
  "leicester": "East Midlands",
  "nottingham": "East Midlands",
  "derby": "East Midlands",
  "warwickshire": "West Midlands",
  "staffordshire": "West Midlands",
  "shropshire": "West Midlands",
  "herefordshire": "West Midlands",
  "worcestershire": "West Midlands",
  "west midlands": "West Midlands",
  "coventry": "West Midlands",
  "birmingham": "West Midlands",
  "wolverhampton": "West Midlands",
  "stoke-on-trent": "West Midlands",
  "telford and wrekin": "West Midlands",
  "north yorkshire": "Yorkshire and the Humber",
  "south yorkshire": "Yorkshire and the Humber",
  "west yorkshire": "Yorkshire and the Humber",
  "east yorkshire": "Yorkshire and the Humber",
  "east riding of yorkshire": "Yorkshire and the Humber",
  "yorkshire": "Yorkshire and the Humber",
  "sheffield": "Yorkshire and the Humber",
  "leeds": "Yorkshire and the Humber",
  "bradford": "Yorkshire and the Humber",
  "hull": "Yorkshire and the Humber",
  "kingston upon hull": "Yorkshire and the Humber",
  "york": "Yorkshire and the Humber",
  "north lincolnshire": "Yorkshire and the Humber",
  "north east lincolnshire": "Yorkshire and the Humber",
  "calderdale": "Yorkshire and the Humber",
  "kirklees": "Yorkshire and the Humber",
  "wakefield": "Yorkshire and the Humber",
  "doncaster": "Yorkshire and the Humber",
  "rotherham": "Yorkshire and the Humber",
  "barnsley": "Yorkshire and the Humber",
  "lancashire": "North West",
  "cheshire": "North West",
  "cumbria": "North West",
  "greater manchester": "North West",
  "merseyside": "North West",
  "manchester": "North West",
  "liverpool": "North West",
  "salford": "North West",
  "cheshire east": "North West",
  "cheshire west and chester": "North West",
  "warrington": "North West",
  "halton": "North West",
  "knowsley": "North West",
  "sefton": "North West",
  "st helens": "North West",
  "wirral": "North West",
  "bolton": "North West",
  "bury": "North West",
  "oldham": "North West",
  "rochdale": "North West",
  "stockport": "North West",
  "tameside": "North West",
  "trafford": "North West",
  "wigan": "North West",
  "blackburn with darwen": "North West",
  "blackpool": "North West",
  "county durham": "North East",
  "northumberland": "North East",
  "tyne and wear": "North East",
  "durham": "North East",
  "newcastle upon tyne": "North East",
  "newcastle": "North East",
  "sunderland": "North East",
  "gateshead": "North East",
  "south tyneside": "North East",
  "north tyneside": "North East",
  "middlesbrough": "North East",
  "stockton-on-tees": "North East",
  "hartlepool": "North East",
  "darlington": "North East",
  "redcar and cleveland": "North East",
  "scotland": "Scotland",
  "edinburgh": "Scotland",
  "glasgow": "Scotland",
  "highland": "Scotland",
  "aberdeenshire": "Scotland",
  "aberdeen": "Scotland",
  "fife": "Scotland",
  "perth and kinross": "Scotland",
  "stirling": "Scotland",
  "dundee": "Scotland",
  "south lanarkshire": "Scotland",
  "north lanarkshire": "Scotland",
  "east lothian": "Scotland",
  "west lothian": "Scotland",
  "midlothian": "Scotland",
  "angus": "Scotland",
  "renfrewshire": "Scotland",
  "east renfrewshire": "Scotland",
  "inverclyde": "Scotland",
  "east ayrshire": "Scotland",
  "north ayrshire": "Scotland",
  "south ayrshire": "Scotland",
  "argyll and bute": "Scotland",
  "falkirk": "Scotland",
  "clackmannanshire": "Scotland",
  "dumfries and galloway": "Scotland",
  "scottish borders": "Scotland",
  "orkney": "Scotland",
  "shetland": "Scotland",
  "western isles": "Scotland",
  "moray": "Scotland",
  "east dunbartonshire": "Scotland",
  "west dunbartonshire": "Scotland",
  "wales": "Wales",
  "cardiff": "Wales",
  "swansea": "Wales",
  "newport": "Wales",
  "caerphilly": "Wales",
  "rhondda cynon taf": "Wales",
  "neath port talbot": "Wales",
  "bridgend": "Wales",
  "vale of glamorgan": "Wales",
  "merthyr tydfil": "Wales",
  "flintshire": "Wales",
  "wrexham": "Wales",
  "denbighshire": "Wales",
  "conwy": "Wales",
  "gwynedd": "Wales",
  "isle of anglesey": "Wales",
  "ceredigion": "Wales",
  "pembrokeshire": "Wales",
  "carmarthenshire": "Wales",
  "powys": "Wales",
  "blaenau gwent": "Wales",
  "torfaen": "Wales",
  "monmouthshire": "Wales",
  "northern ireland": "Northern Ireland",
  "belfast": "Northern Ireland",
  "antrim": "Northern Ireland",
  "armagh": "Northern Ireland",
  "down": "Northern Ireland",
  "fermanagh": "Northern Ireland",
  "londonderry": "Northern Ireland",
  "derry": "Northern Ireland",
  "tyrone": "Northern Ireland",
  "antrim and newtownabbey": "Northern Ireland",
  "ards and north down": "Northern Ireland",
  "belfast city": "Northern Ireland",
  "causeway coast and glens": "Northern Ireland",
  "derry city and strabane": "Northern Ireland",
  "fermanagh and omagh": "Northern Ireland",
  "lisburn and castlereagh": "Northern Ireland",
  "mid and east antrim": "Northern Ireland",
  "mid ulster": "Northern Ireland",
  "newry, mourne and down": "Northern Ireland",
};

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

function countyToRegion(county: string | null | undefined): string | null {
  if (!county) return null;
  return COUNTY_TO_REGION[county.toLowerCase().trim()] ?? null;
}

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

router.get("/sponsor-licences/industry-counts", requireAuthenticated, async (_req, res) => {
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
    const region = typeof req.query["region"] === "string" ? req.query["region"].trim() : "";
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

    const annotated = allCompanies.map((c) => ({
      ...c,
      hasVacancies: employerNamesWithVacancies.has(c.organisationName.toLowerCase().trim()),
      isBookmarked: bookmarkedIds.has(c.id),
      region: countyToRegion(c.county),
    }));

    let filtered = annotated;
    if (filterVacancies) filtered = filtered.filter((c) => c.hasVacancies);
    if (region) filtered = filtered.filter((c) => c.region === region);
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
