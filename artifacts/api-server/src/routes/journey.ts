import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import {
  db,
  profilesTable,
  applicationsTable,
  documentsTable,
  remediationPlansTable,
  remediationStepsTable,
  decisionRecordsTable,
  candidateBadgesTable,
  BADGE_DEFINITIONS,
} from "@workspace/db";
import type { BadgeKey } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { computeCompletionPct } from "../lib/profileCompleteness";

const router: IRouter = Router();

router.get("/journey/status", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [profiles, documents, decisions, applications, earnedBadges, plans] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    db.select().from(documentsTable).where(eq(documentsTable.userId, userId)),
    db.select().from(decisionRecordsTable).where(eq(decisionRecordsTable.userId, userId)).orderBy(desc(decisionRecordsTable.createdAt)),
    db.select().from(applicationsTable).where(eq(applicationsTable.userId, userId)),
    db.select().from(candidateBadgesTable).where(eq(candidateBadgesTable.userId, userId)),
    db.select().from(remediationPlansTable).where(eq(remediationPlansTable.userId, userId)).orderBy(desc(remediationPlansTable.createdAt)).limit(1),
  ]);

  const profile = profiles[0] ?? null;
  const latestDecision = decisions[0] ?? null;
  const docCount = documents.length;
  const totalApps = applications.length;
  const shortlistedCount = applications.filter((a) => a.status === "shortlisted").length;
  const interviews = applications.filter((a) => a.status === "interview" || a.status === "offer").length;
  const offers = applications.filter((a) => a.status === "offer").length;
  const profilePct = profile ? computeCompletionPct(profile) : 0;
  const latestPlan = plans[0] ?? null;

  let planStepsDone = 0;
  let planStepsTotal = 0;
  if (latestPlan) {
    const steps = await db.select().from(remediationStepsTable).where(eq(remediationStepsTable.planId, latestPlan.id));
    planStepsDone = steps.filter((s) => s.status === "done").length;
    planStepsTotal = steps.length;
  }
  const planPct = planStepsTotal > 0 ? Math.round((planStepsDone / planStepsTotal) * 100) : 0;

  // Award any newly earned badges
  const existingKeys = new Set(earnedBadges.map((b) => b.badgeKey));
  const toAward: BadgeKey[] = [];
  if (profilePct >= 100 && !existingKeys.has("profile_complete")) toAward.push("profile_complete");
  if (docCount >= 2 && !existingKeys.has("documents_ready")) toAward.push("documents_ready");
  if (latestDecision && !existingKeys.has("eligibility_checked")) toAward.push("eligibility_checked");
  if (totalApps >= 1 && !existingKeys.has("first_application")) toAward.push("first_application");
  if (shortlistedCount > 0 && !existingKeys.has("shortlisted")) toAward.push("shortlisted");
  if (interviews > 0 && !existingKeys.has("interview_ready")) toAward.push("interview_ready");
  if (offers > 0 && !existingKeys.has("offer_received")) toAward.push("offer_received");

  if (toAward.length > 0) {
    await db.insert(candidateBadgesTable).values(toAward.map((key) => ({ userId, badgeKey: key })));
    toAward.forEach((k) => existingKeys.add(k));
  }

  // Build complete badge list (earned + awarded this request)
  const allEarnedKeys = [...existingKeys];
  const badges = allEarnedKeys
    .filter((k): k is BadgeKey => k in BADGE_DEFINITIONS)
    .map((k) => {
      const def = BADGE_DEFINITIONS[k];
      const record = earnedBadges.find((b) => b.badgeKey === k);
      return {
        key: k,
        name: def.name,
        description: def.description,
        iconName: def.iconName,
        awardedAt: record?.awardedAt?.toISOString() ?? new Date().toISOString(),
        isNew: toAward.includes(k),
      };
    });

  // Readiness score (0–100)
  const eligibilityPts = latestDecision?.outcome === "eligible" ? 30 : latestDecision ? 15 : 0;
  const planPts = planStepsTotal > 0 ? Math.round((planStepsDone / planStepsTotal) * 20) : 0;
  const docPts = Math.round(Math.min(docCount / 5, 1) * 15);
  const appPts = Math.round(Math.min(totalApps / 5, 1) * 15);
  const profilePtsNum = Math.round((profilePct / 100) * 20);
  const readinessScore = Math.min(100, eligibilityPts + planPts + docPts + appPts + profilePtsNum);

  // Build 10 stages
  const stages = [
    {
      id: "profile",
      index: 0,
      name: "Profile",
      description: "Build your professional profile so we can match you to the right roles",
      href: "/profile",
      iconName: "User",
      status: profilePct >= 100 ? "complete" : profilePct > 0 ? "inProgress" : "notStarted",
      completionPct: profilePct,
      locked: false,
      subTasks: [
        { id: "profession", label: "Add your profession", done: !!profile?.profession, href: "/profile" },
        { id: "specialty", label: "Add your specialty", done: !!profile?.specialty, href: "/profile" },
        { id: "qualifications", label: "Add qualifications", done: !!(profile?.qualificationType && profile?.qualificationCountry), href: "/profile" },
        { id: "experience", label: "Add experience years", done: (profile?.experienceYears ?? 0) > 0, href: "/profile" },
        { id: "residency", label: "Set residency status", done: !!profile?.residencyStatus, href: "/profile" },
        { id: "photo", label: "Upload profile photo", done: !!profile?.profilePhotoKey, href: "/profile" },
        { id: "languages", label: "Add languages spoken", done: (profile?.languages?.length ?? 0) > 0, href: "/profile" },
      ],
      nextUnlockHint: profilePct < 100 ? "Complete all profile fields to earn the Profile Champion badge" : null,
      badgeKey: "profile_complete",
    },
    {
      id: "documents",
      index: 1,
      name: "Documents",
      description: "Upload your qualification certificates and registration documents",
      href: "/documents",
      iconName: "Files",
      status: docCount >= 3 ? "complete" : docCount > 0 ? "inProgress" : profilePct > 0 ? "notStarted" : "locked",
      completionPct: Math.min(100, Math.round((docCount / 3) * 100)),
      locked: profilePct === 0,
      subTasks: [
        { id: "cv", label: "Upload your CV", done: docCount >= 1, href: "/documents" },
        { id: "qualification", label: "Upload qualification certificate", done: docCount >= 2, href: "/documents" },
        { id: "registration", label: "Upload registration proof", done: docCount >= 3, href: "/documents" },
      ],
      nextUnlockHint: profilePct === 0 ? "Complete your profile first" : null,
      badgeKey: "documents_ready",
    },
    {
      id: "eligibility",
      index: 2,
      name: "Eligibility & Compliance",
      description: "Run your eligibility check to get a personalised career path",
      href: "/eligibility",
      iconName: "ShieldCheck",
      status: latestDecision?.outcome === "eligible" ? "complete" : latestDecision ? "inProgress" : docCount > 0 ? "notStarted" : "locked",
      completionPct: latestDecision?.outcome === "eligible" ? 100 : latestDecision ? 50 : 0,
      locked: docCount === 0,
      subTasks: [
        { id: "check", label: "Run your eligibility check", done: !!latestDecision, href: "/eligibility" },
        { id: "plan", label: "Review remediation plan", done: planStepsTotal > 0, href: "/path" },
        { id: "eligible", label: "Achieve eligible status", done: latestDecision?.outcome === "eligible", href: "/eligibility" },
      ],
      nextUnlockHint: docCount === 0 ? "Upload at least one document first" : !latestDecision ? "Run your eligibility assessment to continue" : null,
      badgeKey: "eligibility_checked",
    },
    {
      id: "career_matching",
      index: 3,
      name: "Career Matching",
      description: "Explore roles matched to your profile and eligibility status",
      href: "/opportunities",
      iconName: "Briefcase",
      status: totalApps > 0 ? "complete" : latestDecision ? "inProgress" : "locked",
      completionPct: totalApps > 0 ? 100 : latestDecision ? 50 : 0,
      locked: !latestDecision,
      subTasks: [
        { id: "view", label: "View your matched roles", done: !!latestDecision, href: "/opportunities" },
        { id: "filter", label: "Filter by location or regulator", done: !!latestDecision, href: "/opportunities" },
        { id: "apply_one", label: "Apply to your first role", done: totalApps >= 1, href: "/opportunities" },
      ],
      nextUnlockHint: !latestDecision ? "Complete your eligibility check to unlock career matching" : null,
      badgeKey: null,
    },
    {
      id: "applications",
      index: 4,
      name: "Applications",
      description: "Apply to matched roles and track your application progress",
      href: "/applications",
      iconName: "ClipboardList",
      status: totalApps >= 5 ? "complete" : totalApps > 0 ? "inProgress" : latestDecision ? "notStarted" : "locked",
      completionPct: Math.min(100, Math.round((totalApps / 5) * 100)),
      locked: !latestDecision,
      subTasks: [
        { id: "apply1", label: "Submit first application", done: totalApps >= 1, href: "/opportunities" },
        { id: "apply3", label: "Apply to 3 roles", done: totalApps >= 3, href: "/opportunities" },
        { id: "apply5", label: "Apply to 5 roles", done: totalApps >= 5, href: "/opportunities" },
        { id: "shortlisted", label: "Get shortlisted", done: shortlistedCount > 0, href: "/applications" },
      ],
      nextUnlockHint: !latestDecision ? "Complete eligibility check first" : null,
      badgeKey: "first_application",
    },
    {
      id: "interview_prep",
      index: 5,
      name: "Interview Prep",
      description: "Prepare for NHS and healthcare interviews with AI-generated questions",
      href: "/interview-prep",
      iconName: "MessageSquare",
      status: interviews > 0 ? "complete" : totalApps > 0 ? "inProgress" : "locked",
      completionPct: interviews > 0 ? 100 : totalApps > 0 ? 50 : 0,
      locked: totalApps === 0,
      subTasks: [
        { id: "questions", label: "Generate interview questions", done: totalApps > 0, href: "/interview-prep" },
        { id: "practice", label: "Review practice answers", done: totalApps > 0, href: "/interview-prep" },
        { id: "interview", label: "Reach the interview stage", done: interviews > 0, href: "/applications" },
      ],
      nextUnlockHint: totalApps === 0 ? "Submit at least one application first" : null,
      badgeKey: "interview_ready",
    },
    {
      id: "offer_placement",
      index: 6,
      name: "Offer & Placement",
      description: "Receive and accept a job offer from a UK healthcare employer",
      href: "/applications",
      iconName: "Trophy",
      status: offers > 0 ? "complete" : interviews > 0 ? "inProgress" : "locked",
      completionPct: offers > 0 ? 100 : interviews > 0 ? 50 : 0,
      locked: interviews === 0 && offers === 0,
      subTasks: [
        { id: "interview_inv", label: "Receive an interview invitation", done: interviews > 0, href: "/applications" },
        { id: "offer", label: "Receive a job offer", done: offers > 0, href: "/applications" },
        { id: "accepted", label: "Accept your offer", done: offers > 0, href: "/applications" },
      ],
      nextUnlockHint: interviews === 0 ? "Reach the interview stage to unlock this" : null,
      badgeKey: "offer_received",
    },
    {
      id: "visa_processing",
      index: 7,
      name: "Visa Processing",
      description: "Navigate the skilled worker visa process with step-by-step guidance",
      href: "/regulatory-guidance",
      iconName: "Globe",
      status: offers > 0 ? "inProgress" : "locked",
      completionPct: offers > 0 ? 33 : 0,
      locked: offers === 0,
      subTasks: [
        { id: "cos", label: "Certificate of Sponsorship requested", done: false, href: "/regulatory-guidance" },
        { id: "visa_app", label: "Submit visa application", done: false, href: "/regulatory-guidance" },
        { id: "biometrics", label: "Complete biometrics appointment", done: false, href: "/regulatory-guidance" },
      ],
      nextUnlockHint: offers === 0 ? "Receive a job offer to unlock visa guidance" : null,
      badgeKey: null,
    },
    {
      id: "relocation",
      index: 8,
      name: "Relocation",
      description: "Prepare your move to the UK and settle into your new role",
      href: "/regulatory-guidance",
      iconName: "Home",
      status: offers > 0 ? "inProgress" : "locked",
      completionPct: offers > 0 ? 20 : 0,
      locked: offers === 0,
      subTasks: [
        { id: "accommodation", label: "Arrange accommodation", done: false, href: "/regulatory-guidance" },
        { id: "ni", label: "Apply for National Insurance number", done: false, href: "/regulatory-guidance" },
        { id: "bank", label: "Open a UK bank account", done: false, href: "/regulatory-guidance" },
        { id: "registration_body", label: "Register with UK regulatory body", done: false, href: "/regulatory-guidance" },
      ],
      nextUnlockHint: offers === 0 ? "Receive a job offer to unlock relocation guidance" : null,
      badgeKey: null,
    },
    {
      id: "career_growth",
      index: 9,
      name: "Career Growth",
      description: "Track your progress and continue growing your UK healthcare career",
      href: "/my-report",
      iconName: "TrendingUp",
      status: planPct >= 100 && planStepsTotal > 0 ? "complete" : "notStarted",
      completionPct: planPct,
      locked: false,
      subTasks: [
        { id: "report", label: "View your progress report", done: totalApps > 0, href: "/my-report" },
        { id: "plan_complete", label: "Complete remediation plan", done: planPct >= 100 && planStepsTotal > 0, href: "/path" },
        { id: "boost", label: "Boost your profile", done: profile?.boostProfile ?? false, href: "/profile" },
      ],
      nextUnlockHint: null,
      badgeKey: null,
    },
  ];

  // Next action
  const firstIncomplete = stages.find((s) => !s.locked && s.status !== "complete");
  const nextAction = firstIncomplete
    ? firstIncomplete.subTasks.find((t) => !t.done)?.label ?? `Continue: ${firstIncomplete.name}`
    : "You've made great progress! Keep applying to roles.";

  res.json({ stages, badges, readinessScore, nextAction });
});

export default router;
