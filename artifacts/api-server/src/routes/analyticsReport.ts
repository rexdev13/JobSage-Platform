import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import {
  db,
  profilesTable,
  applicationsTable,
  speculativeApplicationsTable,
  documentsTable,
  remediationPlansTable,
  remediationStepsTable,
  decisionRecordsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { Application } from "@workspace/db";
import { buildWeeklyApplicationStats } from "../lib/weeklyStats";

const router: IRouter = Router();

const DISCLAIMER =
  "AI-generated insights are for guidance only and do not constitute professional advice.";

function fallbackInsight(score: number): string {
  if (score >= 80)
    return "You are in a strong position — keep your application momentum going and UK registration is well within reach.";
  if (score >= 60)
    return "Good progress — completing your remediation plan and adding more applications will accelerate your UK registration journey.";
  if (score >= 40)
    return "You're on your way — focus on completing your eligibility check and uploading key documents to boost your readiness score.";
  return "Start by completing your profile and running your eligibility check to unlock personalised guidance for your UK healthcare journey.";
}

async function generatePredictiveInsight(params: {
  candidateName: string;
  profession: string;
  readinessScore: number;
  eligibilityOutcome: string | null;
  planProgress: number;
  totalApplications: number;
  interviews: number;
}): Promise<string> {
  try {
    const prompt = `You are a UK healthcare career advisor. Write exactly ONE forward-looking sentence (max 30 words) predicting or encouraging this candidate based on their journey data. Return only the sentence, no preamble.

Candidate: ${params.candidateName}
Profession: ${params.profession.replace(/_/g, " ")}
Readiness score: ${params.readinessScore}/100
Eligibility: ${params.eligibilityOutcome ?? "not checked"}
Remediation plan: ${params.planProgress}% complete
Applications: ${params.totalApplications} total (${params.interviews} reached interview stage)`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });
    return response.choices[0]?.message?.content?.trim() || fallbackInsight(params.readinessScore);
  } catch {
    return fallbackInsight(params.readinessScore);
  }
}

type MonthEntry = {
  month: string;
  total: number;
  link_clicked: number;
  applied: number;
  shortlisted: number;
  interview: number;
  offer: number;
  rejected: number;
  no_response: number;
};

function buildMonthlyBreakdown(apps: Application[], now: Date): MonthEntry[] {
  const months: MonthEntry[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = d;
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const label = d.toLocaleString("en-GB", { month: "short", year: "numeric" });
    const slice = apps.filter((a) => {
      const t = new Date(a.appliedAt);
      return t >= monthStart && t < monthEnd;
    });
    months.push({
      month: label,
      total: slice.length,
      link_clicked: slice.filter((a) => a.status === "link_clicked" || a.status === "in_progress").length,
      applied: slice.filter((a) => a.status === "applied").length,
      shortlisted: slice.filter((a) => a.status === "shortlisted").length,
      interview: slice.filter((a) => a.status === "interview").length,
      offer: slice.filter((a) => a.status === "offer").length,
      rejected: slice.filter((a) => a.status === "rejected").length,
      no_response: slice.filter((a) => a.status === "no_response").length,
    });
  }
  return months;
}

router.get("/my-analytics", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const user = req.user!;

  const [profileRows, allApplications, speculativeApps, documents, decisionRows, planRows] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    db.select().from(applicationsTable).where(eq(applicationsTable.userId, userId)),
    db.select().from(speculativeApplicationsTable).where(eq(speculativeApplicationsTable.userId, userId)),
    db.select({ id: documentsTable.id }).from(documentsTable).where(eq(documentsTable.userId, userId)),
    db
      .select()
      .from(decisionRecordsTable)
      .where(eq(decisionRecordsTable.userId, userId))
      .orderBy(desc(decisionRecordsTable.createdAt))
      .limit(1),
    db
      .select()
      .from(remediationPlansTable)
      .where(eq(remediationPlansTable.userId, userId))
      .orderBy(desc(remediationPlansTable.createdAt))
      .limit(1),
  ]);

  const profile = profileRows[0] ?? null;
  const latestDecision = decisionRows[0] ?? null;
  const plan = planRows[0] ?? null;

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
  const planProgressPct =
    planStepsTotal > 0 ? Math.round((planStepsDone / planStepsTotal) * 100) : 0;

  const totalCombinedApplications = allApplications.length + speculativeApps.length;

  const eligibilityOutcome = latestDecision?.outcome ?? null;
  const eligibilityPts =
    eligibilityOutcome === "eligible" ? 30 : eligibilityOutcome ? 15 : 0;
  const planPts =
    planStepsTotal > 0 ? Math.round((planStepsDone / planStepsTotal) * 25) : 0;
  const docPts = Math.round(Math.min(documents.length / 5, 1) * 20);
  const appPts = Math.round(Math.min(totalCombinedApplications / 10, 1) * 15);

  let filledFields = 0;
  if (profile) {
    if (profile.profession) filledFields++;
    if (profile.specialty) filledFields++;
    if (profile.qualificationCountry) filledFields++;
    if (profile.registrationStatus) filledFields++;
  }
  const profilePts = Math.round((filledFields / 4) * 10);
  const readinessScore = eligibilityPts + planPts + docPts + appPts + profilePts;
  const profileCompleteness = Math.round((filledFields / 4) * 100);

  const now = new Date();
  const monthlyApplications = buildMonthlyBreakdown(allApplications, now);
  const applicationsLast7Days = buildWeeklyApplicationStats(allApplications, now);

  // Add speculative CV sends into monthly totals as "cv_sent" activity
  for (const spec of speculativeApps) {
    const specDate = new Date(spec.createdAt);
    const entry = monthlyApplications.find((m) => {
      const [mon, yr] = m.month.split(" ");
      const d = new Date(`${mon} 1 ${yr}`);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return specDate >= d && specDate < monthEnd;
    });
    if (entry) {
      entry.total += 1;
    }
  }

  const statusBreakdown = {
    link_clicked: allApplications.filter((a) => a.status === "link_clicked" || a.status === "in_progress").length,
    applied: allApplications.filter((a) => a.status === "applied").length,
    shortlisted: allApplications.filter((a) => a.status === "shortlisted").length,
    interview: allApplications.filter((a) => a.status === "interview").length,
    offer: allApplications.filter((a) => a.status === "offer").length,
    rejected: allApplications.filter((a) => a.status === "rejected").length,
    no_response: allApplications.filter((a) => a.status === "no_response").length,
    cv_sent: speculativeApps.length,
  };

  // Most recent activity across both formal and speculative
  const lastFormal = [...allApplications].sort(
    (a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(),
  )[0] ?? null;
  const lastSpeculative = [...speculativeApps].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0] ?? null;
  const lastFormalTime = lastFormal ? new Date(lastFormal.appliedAt).getTime() : 0;
  const lastSpecTime = lastSpeculative ? new Date(lastSpeculative.createdAt).getTime() : 0;
  const lastActivityTime = Math.max(lastFormalTime, lastSpecTime);
  const streakDays = lastActivityTime > 0
    ? Math.floor((now.getTime() - lastActivityTime) / (1000 * 60 * 60 * 24))
    : null;

  const candidateName =
    [
      (user as { firstName?: string }).firstName,
      (user as { lastName?: string }).lastName,
    ]
      .filter(Boolean)
      .join(" ") ||
    user.email ||
    "Candidate";

  const predictiveInsight = await generatePredictiveInsight({
    candidateName,
    profession: profile?.profession ?? "healthcare professional",
    readinessScore,
    eligibilityOutcome,
    planProgress: planProgressPct,
    totalApplications: totalCombinedApplications,
    interviews: statusBreakdown.interview,
  });

  res.json({
    readinessScore,
    readinessBreakdown: {
      eligibility: eligibilityPts,
      planProgress: planPts,
      documents: docPts,
      applications: appPts,
      profileComplete: profilePts,
    },
    monthlyApplications,
    statusBreakdown,
    applicationsLast7Days,
    profileCompleteness,
    streakDays,
    predictiveInsight,
    disclaimer: DISCLAIMER,
  });
});

export default router;
