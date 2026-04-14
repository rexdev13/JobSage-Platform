import { Router, type IRouter, type Request, type Response } from "express";
import { db, profilesTable, jobListingsTable, smartApplyDraftsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { getStandardQuestions, prefillApplicationAnswers } from "../lib/smartApply";

const router: IRouter = Router();

router.get("/smart-apply/questions", requireAuthenticated, (_req: Request, res: Response): void => {
  res.json({ questions: getStandardQuestions() });
});

router.post("/roles/:id/smart-apply/prefill", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.id, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const userId = req.user!.id;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(404).json({ error: "Candidate profile not found. Please complete your profile first." });
    return;
  }

  let roleContext = {
    title: `Role #${roleId}`,
    description: null as string | null,
    regulator: "GMC/NMC/HCPC",
    location: "UK",
    sponsorshipOffered: false,
  };

  if (roleId > 1_000_000) {
    const jobId = roleId - 1_000_000;
    const [job] = await db
      .select()
      .from(jobListingsTable)
      .where(eq(jobListingsTable.id, jobId));

    if (job) {
      roleContext = {
        title: job.title,
        description: job.description,
        regulator: job.regulator,
        location: job.location,
        sponsorshipOffered: job.sponsorshipOffered ?? false,
      };
    }
  }

  try {
    const prefills = await prefillApplicationAnswers(
      {
        profession: profile.profession,
        specialty: profile.specialty,
        qualificationCountry: profile.qualificationCountry,
        qualificationType: profile.qualificationType,
        qualificationYear: profile.qualificationYear,
        experienceYears: profile.experienceYears,
        registrationStatus: profile.registrationStatus,
        requiresSponsorship: profile.requiresSponsorship,
        preferredRegion: profile.preferredRegion,
      },
      roleContext
    );

    res.json({
      questions: getStandardQuestions(),
      prefills,
      roleContext: {
        title: roleContext.title,
        location: roleContext.location,
        regulator: roleContext.regulator,
        sponsorshipOffered: roleContext.sponsorshipOffered,
      },
    });
  } catch (err) {
    console.error("Smart apply prefill error:", err);
    res.status(500).json({ error: "Failed to generate application answers. Please try again." });
  }
});

router.get("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const [draft] = await db
    .select()
    .from(smartApplyDraftsTable)
    .where(
      and(
        eq(smartApplyDraftsTable.userId, req.user!.id),
        eq(smartApplyDraftsTable.roleId, roleId)
      )
    );

  if (!draft) {
    res.json({ answers: null });
    return;
  }

  res.json({ answers: draft.answers, updatedAt: draft.updatedAt.toISOString() });
});

router.put("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const { answers } = req.body as { answers?: Record<string, string> };
  if (!answers || typeof answers !== "object") {
    res.status(400).json({ error: "answers object is required" });
    return;
  }

  await db
    .insert(smartApplyDraftsTable)
    .values({
      userId: req.user!.id,
      roleId,
      answers,
    })
    .onConflictDoUpdate({
      target: [smartApplyDraftsTable.userId, smartApplyDraftsTable.roleId],
      set: { answers, updatedAt: new Date() },
    });

  res.json({ ok: true });
});

router.delete("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  await db
    .delete(smartApplyDraftsTable)
    .where(
      and(
        eq(smartApplyDraftsTable.userId, req.user!.id),
        eq(smartApplyDraftsTable.roleId, roleId)
      )
    );

  res.sendStatus(204);
});

export default router;
