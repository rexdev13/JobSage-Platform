import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable, jobListingsTable } from "@workspace/db";
import { eq, ilike, and, desc, sql, isNotNull } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";

const router: IRouter = Router();

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
