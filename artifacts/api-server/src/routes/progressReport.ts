import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db, profilesTable, applicationsTable, documentsTable } from "@workspace/db";
import { remediationPlansTable, remediationStepsTable, decisionRecordsTable } from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { generateProgressRecommendations } from "../lib/progressReportGenerator";

const router: IRouter = Router();

router.get("/my-progress-report", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  const allApplications = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.userId, userId));

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const appsThisMonth = allApplications.filter((a) => new Date(a.appliedAt) >= monthStart);

  const documents = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId));

  const [latestDecision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const [plan] = await db
    .select()
    .from(remediationPlansTable)
    .where(eq(remediationPlansTable.userId, userId))
    .orderBy(desc(remediationPlansTable.createdAt))
    .limit(1);

  let planStepsDone = 0;
  let planStepsTotal = 0;
  if (plan) {
    const steps = await db
      .select()
      .from(remediationStepsTable)
      .where(eq(remediationStepsTable.planId, plan.id));
    planStepsTotal = steps.length;
    planStepsDone = steps.filter((s) => s.status === "done").length;
  }

  const planProgress = planStepsTotal > 0 ? Math.round((planStepsDone / planStepsTotal) * 100) : 0;

  const stats = {
    total: allApplications.length,
    interviews: allApplications.filter((a) => a.status === "interview").length,
    offers: allApplications.filter((a) => a.status === "offer").length,
    noResponse: allApplications.filter((a) => a.status === "no_response").length,
    applicationsThisMonth: appsThisMonth.length,
    responseRate:
      allApplications.length > 0
        ? Math.round(
            ((allApplications.filter((a) => a.status !== "applied" && a.status !== "no_response")
              .length) /
              allApplications.length) *
              100,
          )
        : 0,
  };

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || user.email || "Candidate";

  let recommendations = { recommendedNextSteps: "", topCompanies: [] as import("../lib/progressReportGenerator").CompanyRecommendation[], disclaimer: "" };
  if (profile) {
    try {
      recommendations = await generateProgressRecommendations({
        candidateName,
        profession: profile.profession,
        specialty: profile.specialty,
        registrationStatus: profile.registrationStatus,
        eligibilityOutcome: latestDecision?.outcome ?? null,
        applicationsThisMonth: appsThisMonth.length,
        totalApplications: allApplications.length,
        interviews: stats.interviews,
        offers: stats.offers,
        noResponse: stats.noResponse,
        planProgress,
        planStepsDone,
        planStepsTotal,
        boostProfile: profile.boostProfile,
        documentCount: documents.length,
        preferredRegion: profile.preferredRegion ?? null,
      });
    } catch (err) {
      console.error("[progress-report] AI error:", err);
    }
  }

  res.json({
    period: {
      month: now.toLocaleString("en-GB", { month: "long" }),
      year: now.getFullYear(),
    },
    stats,
    eligibility: {
      outcome: latestDecision?.outcome ?? null,
      checkedAt: latestDecision?.createdAt ?? null,
    },
    plan: {
      stepsDone: planStepsDone,
      stepsTotal: planStepsTotal,
      progressPct: planProgress,
    },
    documentCount: documents.length,
    boostProfile: profile?.boostProfile ?? false,
    recommendations: recommendations.recommendedNextSteps,
    disclaimer: recommendations.disclaimer,
    topCompanies: recommendations.topCompanies,
  });
});

export default router;
