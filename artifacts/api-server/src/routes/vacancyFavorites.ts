import { Router, type IRouter, type Request, type Response } from "express";
import { getCandidateVacancyStatus } from "../lib/vacancyLiveness";
import {
  db,
  vacancyFavoritesTable,
  rolesTable,
  jobListingsTable,
  employerProfilesTable,
  sponsorLicenceVacanciesTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";

const router: IRouter = Router();

// Unified vacancy id-space (same convention as the Opportunities page):
//   <= 1,000,000            → imported roles (roles.id)
//   1,000,001 – 2,000,000   → employer job listings (job_listings.id + 1,000,000)
//   > 2,000,000             → AI-discovered sponsor vacancies (sponsor_licence_vacancies.id + 2,000,000)
const JOB_LISTING_OFFSET = 1_000_000;
const SPONSOR_VACANCY_OFFSET = 2_000_000;

router.get("/vacancy-favorites", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const favorites = await db
      .select({
        vacancyId: vacancyFavoritesTable.vacancyId,
        createdAt: vacancyFavoritesTable.createdAt,
      })
      .from(vacancyFavoritesTable)
      .where(eq(vacancyFavoritesTable.userId, userId))
      .orderBy(desc(vacancyFavoritesTable.createdAt));

    const roleIds = favorites
      .map((f) => f.vacancyId)
      .filter((id) => id > 0 && id <= JOB_LISTING_OFFSET);
    const listingIds = favorites
      .filter((f) => f.vacancyId > JOB_LISTING_OFFSET && f.vacancyId <= SPONSOR_VACANCY_OFFSET)
      .map((f) => f.vacancyId - JOB_LISTING_OFFSET);
    const sponsorVacancyIds = favorites
      .filter((f) => f.vacancyId > SPONSOR_VACANCY_OFFSET)
      .map((f) => f.vacancyId - SPONSOR_VACANCY_OFFSET);

    const [roleRows, listingRows, sponsorRows] = await Promise.all([
      roleIds.length > 0
        ? db
            .select({
              id: rolesTable.id,
              title: rolesTable.title,
              employer: rolesTable.employer,
              location: rolesTable.location,
              applyUrl: rolesTable.applyUrl,
            })
            .from(rolesTable)
            .where(inArray(rolesTable.id, roleIds))
        : Promise.resolve([]),
      listingIds.length > 0
        ? db
            .select({
              id: jobListingsTable.id,
              title: jobListingsTable.title,
              location: jobListingsTable.location,
              applyUrl: jobListingsTable.applyUrl,
              employerProfileId: jobListingsTable.employerProfileId,
            })
            .from(jobListingsTable)
            .where(inArray(jobListingsTable.id, listingIds))
        : Promise.resolve([]),
      sponsorVacancyIds.length > 0
        ? db
            .select({
              id: sponsorLicenceVacanciesTable.id,
              title: sponsorLicenceVacanciesTable.title,
              organisationName: sponsorLicenceVacanciesTable.organisationName,
              location: sponsorLicenceVacanciesTable.location,
              url: sponsorLicenceVacanciesTable.url,
              sourceType: sponsorLicenceVacanciesTable.sourceType,
              liveness: sponsorLicenceVacanciesTable.liveness,
              lastVerifiedAt: sponsorLicenceVacanciesTable.lastVerifiedAt,
              lastDiscoveredAt: sponsorLicenceVacanciesTable.lastDiscoveredAt,
              sourceMissingSince: sponsorLicenceVacanciesTable.sourceMissingSince,
              sourceMissingObservations: sponsorLicenceVacanciesTable.sourceMissingObservations,
              closesAt: sponsorLicenceVacanciesTable.closesAt,
              expiresAt: sponsorLicenceVacanciesTable.expiresAt,
              closedReason: sponsorLicenceVacanciesTable.closedReason,
              companyVacancyEvidence: sponsorLicenceVacanciesTable.companyVacancyEvidence,
              companyEvidenceLegacyUntil: sponsorLicenceVacanciesTable.companyEvidenceLegacyUntil,
            })
            .from(sponsorLicenceVacanciesTable)
            .where(inArray(sponsorLicenceVacanciesTable.id, sponsorVacancyIds))
        : Promise.resolve([]),
    ]);

    const employerProfileIds = listingRows.map((l) => l.employerProfileId);
    const companyByProfileId: Record<number, string> = {};
    if (employerProfileIds.length > 0) {
      const profiles = await db
        .select({ id: employerProfilesTable.id, companyName: employerProfilesTable.companyName })
        .from(employerProfilesTable)
        .where(inArray(employerProfilesTable.id, employerProfileIds));
      for (const p of profiles) companyByProfileId[p.id] = p.companyName;
    }

    type Detail = {
      title: string | null;
      company: string | null;
      location: string | null;
      applyUrl: string | null;
      closed?: boolean;
      pendingReview?: boolean;
    };
    const detailByVacancyId = new Map<number, Detail>();
    for (const r of roleRows) {
      detailByVacancyId.set(r.id, {
        title: r.title,
        company: r.employer,
        location: r.location,
        applyUrl: r.applyUrl ?? null,
      });
    }
    for (const l of listingRows) {
      detailByVacancyId.set(l.id + JOB_LISTING_OFFSET, {
        title: l.title,
        company: companyByProfileId[l.employerProfileId] ?? null,
        location: l.location,
        applyUrl: l.applyUrl ?? null,
      });
    }
    for (const s of sponsorRows) {
      const status = getCandidateVacancyStatus({ ...s, title: s.title });
      const pendingReview = status === "pending_review";
      detailByVacancyId.set(s.id + SPONSOR_VACANCY_OFFSET, {
        title: pendingReview ? null : s.title,
        company: pendingReview ? null : s.organisationName,
        location: pendingReview ? null : (s.location ?? null),
        applyUrl: status === "visible" ? (s.url ?? null) : null,
        closed: status !== "visible",
        pendingReview,
      });
    }

    res.json({
      favorites: favorites.flatMap((f) => {
        const d = detailByVacancyId.get(f.vacancyId);
        // Keep the persisted favorite, but do not expose a pending-review
        // company vacancy in the candidate-facing list.
        if (f.vacancyId > SPONSOR_VACANCY_OFFSET && !d) return [];
        if (f.vacancyId > SPONSOR_VACANCY_OFFSET && d?.pendingReview) return [];
        return [{
          vacancyId: f.vacancyId,
          createdAt: f.createdAt.toISOString(),
          title: d?.title ?? null,
          company: d?.company ?? null,
          location: d?.location ?? null,
          applyUrl: d?.applyUrl ?? null,
          closed: d?.closed ?? false,
        }];
      }),
    });
  } catch (err) {
    console.error("[vacancy-favorites] GET error:", err);
    res.status(500).json({ error: "Failed to fetch favorites." });
  }
});

router.post("/vacancy-favorites/:vacancyId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const vacancyId = parseInt(String(req.params["vacancyId"] ?? ""), 10);
    if (!vacancyId || isNaN(vacancyId) || vacancyId <= 0) {
      res.status(400).json({ error: "Invalid vacancy id." });
      return;
    }

    await db
      .insert(vacancyFavoritesTable)
      .values({ userId, vacancyId })
      .onConflictDoNothing();

    res.json({ favorited: true, vacancyId });
  } catch (err) {
    console.error("[vacancy-favorites] POST error:", err);
    res.status(500).json({ error: "Failed to favorite vacancy." });
  }
});

router.delete("/vacancy-favorites/:vacancyId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const vacancyId = parseInt(String(req.params["vacancyId"] ?? ""), 10);
    if (!vacancyId || isNaN(vacancyId) || vacancyId <= 0) {
      res.status(400).json({ error: "Invalid vacancy id." });
      return;
    }

    await db
      .delete(vacancyFavoritesTable)
      .where(and(eq(vacancyFavoritesTable.userId, userId), eq(vacancyFavoritesTable.vacancyId, vacancyId)));

    res.json({ favorited: false, vacancyId });
  } catch (err) {
    console.error("[vacancy-favorites] DELETE error:", err);
    res.status(500).json({ error: "Failed to remove favorite." });
  }
});

export default router;
