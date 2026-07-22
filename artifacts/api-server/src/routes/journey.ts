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
    await db.insert(candidateBadgesTable)
      .values(toAward.map((key) => ({ userId, badgeKey: key })))
      .onConflictDoNothing();
    toAward.forEach((k) => existingKeys.add(k));
  }

  // Determine if the user has been recently active (within 30 minutes).
  // Badges are only "new" when awarded during an active session — not on cold-load
  // discovery (e.g. user earned criteria months ago but never loaded this page).
  const THIRTY_MINS_MS = 30 * 60 * 1000;
  const activityTimestamps: Date[] = [
    profile?.updatedAt,
    ...documents.map(d => d.uploadedAt),
    ...applications.map(a => (a as unknown as { updatedAt?: Date }).updatedAt ?? (a as unknown as { createdAt: Date }).createdAt),
    latestDecision?.createdAt,
  ].filter((d): d is Date => d != null);
  const mostRecentActivity = activityTimestamps.length > 0
    ? new Date(Math.max(...activityTimestamps.map(d => d.getTime())))
    : null;
  const isActiveSession = mostRecentActivity != null
    ? Date.now() - mostRecentActivity.getTime() < THIRTY_MINS_MS
    : false;

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
        // Only mark isNew when awarded in this request AND user is actively using the app
        isNew: toAward.includes(k) && isActiveSession,
      };
    });

  // Readiness score (0–100)
  const eligibilityPts = latestDecision?.outcome === "eligible" ? 30 : latestDecision ? 15 : 0;
  const planPts = planStepsTotal > 0 ? Math.round((planStepsDone / planStepsTotal) * 20) : 0;
  const docPts = Math.round(Math.min(docCount / 5, 1) * 15);
  const appPts = Math.round(Math.min(totalApps / 5, 1) * 15);
  const profilePtsNum = Math.round((profilePct / 100) * 20);
  const readinessScore = Math.min(100, eligibilityPts + planPts + docPts + appPts + profilePtsNum);

  // Build raw stage data (intrinsic completion status, before sequential gating)
  type RawStage = {
    id: string; index: number; name: string; description: string;
    href: string; iconName: string; completionPct: number;
    subTasks: Array<{ id: string; label: string; done: boolean; href: string }>;
    nextUnlockHint: string | null; badgeKey: string | null;
    _complete: boolean; // true when the stage itself is "done"
  };

  const rawStages: RawStage[] = [
    {
      id: "profile", index: 0, name: "Profile",
      description: "Build your professional profile so we can match you to the right roles",
      href: "/profile", iconName: "User",
      _complete: profilePct >= 100,
      completionPct: profilePct,
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
      id: "documents", index: 1, name: "Verification",
      description: "Upload and verify your qualification certificates and professional documents",
      href: "/documents", iconName: "Files",
      _complete: docCount >= 3,
      completionPct: Math.min(100, Math.round((docCount / 3) * 100)),
      subTasks: [
        { id: "cv", label: "Upload your CV", done: docCount >= 1, href: "/documents" },
        { id: "qualification", label: "Upload qualification certificate", done: docCount >= 2, href: "/documents" },
        { id: "registration", label: "Upload registration proof", done: docCount >= 3, href: "/documents" },
      ],
      nextUnlockHint: "Complete your profile first to unlock document upload",
      badgeKey: "documents_ready",
    },
    {
      id: "eligibility", index: 2, name: "Eligibility & Compliance",
      description: "Run your eligibility check to get a personalised career path",
      href: "/eligibility", iconName: "ShieldCheck",
      _complete: latestDecision?.outcome === "eligible",
      completionPct: latestDecision?.outcome === "eligible" ? 100 : latestDecision ? 50 : 0,
      subTasks: [
        { id: "check", label: "Run your eligibility check", done: !!latestDecision, href: "/eligibility" },
        { id: "plan", label: "Review remediation plan", done: planStepsTotal > 0, href: "/path" },
        { id: "eligible", label: "Achieve eligible status", done: latestDecision?.outcome === "eligible", href: "/eligibility" },
      ],
      nextUnlockHint: !latestDecision ? "Run your eligibility assessment to continue" : "Upload your documents first to unlock eligibility",
      badgeKey: "eligibility_checked",
    },
    {
      id: "career_matching", index: 3, name: "Career Matching",
      description: "Explore roles matched to your profile and eligibility status",
      href: "/opportunities", iconName: "Briefcase",
      _complete: totalApps >= 1,
      completionPct: totalApps >= 1 ? 100 : latestDecision?.outcome === "eligible" ? 50 : 0,
      subTasks: [
        { id: "view", label: "View your matched roles", done: !!latestDecision, href: "/opportunities" },
        { id: "filter", label: "Filter by location or regulator", done: !!latestDecision, href: "/opportunities" },
        { id: "apply_one", label: "Apply to your first role", done: totalApps >= 1, href: "/opportunities" },
      ],
      nextUnlockHint: "Complete your eligibility check to unlock career matching",
      badgeKey: null,
    },
    {
      id: "applications", index: 4, name: "Applications",
      description: "Apply to matched roles and track your application progress",
      href: "/applications", iconName: "ClipboardList",
      _complete: shortlistedCount > 0,
      completionPct: shortlistedCount > 0 ? 100 : Math.min(75, Math.round((totalApps / 5) * 75)),
      subTasks: [
        { id: "apply1", label: "Submit first application", done: totalApps >= 1, href: "/opportunities" },
        { id: "apply3", label: "Apply to 3 roles", done: totalApps >= 3, href: "/opportunities" },
        { id: "apply5", label: "Apply to 5 roles", done: totalApps >= 5, href: "/opportunities" },
        { id: "shortlisted", label: "Get shortlisted", done: shortlistedCount > 0, href: "/applications" },
      ],
      nextUnlockHint: "Explore matched roles to unlock applications",
      badgeKey: "first_application",
    },
    {
      id: "interview_prep", index: 5, name: "Interview Prep",
      description: "Prepare for NHS and healthcare interviews with AI-generated questions",
      href: "/interview-prep", iconName: "MessageSquare",
      _complete: interviews > 0,
      completionPct: interviews > 0 ? 100 : totalApps > 0 ? 50 : 0,
      subTasks: [
        { id: "questions", label: "Generate interview questions", done: totalApps > 0, href: "/interview-prep" },
        { id: "practice", label: "Review practice answers", done: totalApps > 0, href: "/interview-prep" },
        { id: "interview", label: "Reach the interview stage", done: interviews > 0, href: "/applications" },
      ],
      nextUnlockHint: "Get shortlisted to unlock interview preparation",
      badgeKey: "interview_ready",
    },
    {
      id: "offer_placement", index: 6, name: "Offer & Placement",
      description: "Receive and accept a job offer from a UK healthcare employer",
      href: "/applications", iconName: "Trophy",
      _complete: offers > 0,
      completionPct: offers > 0 ? 100 : interviews > 0 ? 50 : 0,
      subTasks: [
        { id: "interview_inv", label: "Receive an interview invitation", done: interviews > 0, href: "/applications" },
        { id: "offer", label: "Receive a job offer", done: offers > 0, href: "/applications" },
        { id: "accepted", label: "Accept your offer", done: offers > 0, href: "/applications" },
      ],
      nextUnlockHint: "Reach the interview stage to unlock this",
      badgeKey: "offer_received",
    },
    {
      id: "visa_processing", index: 7, name: "Visa Processing",
      description: "Navigate the skilled worker visa process with step-by-step guidance",
      href: "/regulatory-guidance", iconName: "Globe",
      _complete: false,
      completionPct: 0,
      subTasks: [
        { id: "cos", label: "Certificate of Sponsorship requested", done: false, href: "/regulatory-guidance" },
        { id: "visa_app", label: "Submit visa application", done: false, href: "/regulatory-guidance" },
        { id: "biometrics", label: "Complete biometrics appointment", done: false, href: "/regulatory-guidance" },
      ],
      nextUnlockHint: "Receive a job offer to unlock visa guidance",
      badgeKey: null,
    },
    {
      id: "relocation", index: 8, name: "Relocation",
      description: "Prepare your move to the UK and settle into your new role",
      href: "/regulatory-guidance", iconName: "Home",
      _complete: false,
      completionPct: 0,
      subTasks: [
        { id: "accommodation", label: "Arrange accommodation", done: false, href: "/regulatory-guidance" },
        { id: "ni", label: "Apply for National Insurance number", done: false, href: "/regulatory-guidance" },
        { id: "bank", label: "Open a UK bank account", done: false, href: "/regulatory-guidance" },
        { id: "registration_body", label: "Register with UK regulatory body", done: false, href: "/regulatory-guidance" },
      ],
      nextUnlockHint: "Complete visa processing to unlock relocation guidance",
      badgeKey: null,
    },
    {
      id: "career_growth", index: 9, name: "Career Growth",
      description: "Track your progress and continue growing your UK healthcare career",
      href: "/my-report", iconName: "TrendingUp",
      _complete: planPct >= 100 && planStepsTotal > 0,
      completionPct: planPct,
      subTasks: [
        { id: "report", label: "View your progress report", done: totalApps > 0, href: "/my-report" },
        { id: "plan_complete", label: "Complete remediation plan", done: planPct >= 100 && planStepsTotal > 0, href: "/path" },
        { id: "boost", label: "Boost your profile", done: profile?.boostProfile ?? false, href: "/profile" },
      ],
      nextUnlockHint: "Complete your relocation to unlock career growth tracking",
      badgeKey: null,
    },
  ];

  // Apply strict sequential locking using an iterative resolved-state pass.
  // Each stage's lock is determined by the RESOLVED complete status of the previous stage
  // (not its raw _complete flag), so a stage that is locked cannot propagate completion forward.
  const resolvedCompleteArr: boolean[] = [];
  const stages = rawStages.map((raw, i) => {
    const prevResolvedComplete = i === 0 || resolvedCompleteArr[i - 1];
    const locked = !prevResolvedComplete;
    const resolvedComplete = !locked && raw._complete;
    resolvedCompleteArr.push(resolvedComplete);

    let status: "locked" | "notStarted" | "inProgress" | "complete";
    if (locked) {
      status = "locked";
    } else if (resolvedComplete) {
      status = "complete";
    } else if (raw.completionPct > 0) {
      status = "inProgress";
    } else {
      status = "notStarted";
    }
    const { _complete, ...rest } = raw;
    return {
      ...rest,
      locked,
      status,
      completionPct: locked ? 0 : raw.completionPct,
      nextUnlockHint: locked ? raw.nextUnlockHint : (resolvedComplete ? null : raw.nextUnlockHint),
    };
  });

  // Next action
  const firstIncomplete = stages.find((s) => !s.locked && s.status !== "complete");
  const nextAction = firstIncomplete
    ? firstIncomplete.subTasks.find((t) => !t.done)?.label ?? `Continue: ${firstIncomplete.name}`
    : "You've made great progress! Keep applying to roles.";

  res.json({ stages, badges, readinessScore, nextAction });
});

export default router;
