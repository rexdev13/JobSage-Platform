import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  employerProfilesTable,
  jobListingsTable,
  applicationsTable,
  profilesTable,
  decisionRecordsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireRole, requireAuthenticated } from "../middlewares/requireRole";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

function requireEmployer() {
  return requireRole("employer", "admin");
}

const DISCLAIMER =
  "This platform provides decision support only. AI-generated job descriptions should be reviewed and edited before publishing. Final regulatory compliance responsibilities rest with the employer.";

router.get("/employer/profile", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [profile] = await db
    .select()
    .from(employerProfilesTable)
    .where(eq(employerProfilesTable.userId, userId));
  if (!profile) {
    res.status(404).json({ error: "Employer profile not found." });
    return;
  }
  res.json(profile);
});

router.post("/employer/profile", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { companyName, industry, sponsorLicenceNumber, region } = req.body as {
    companyName?: string;
    industry?: string;
    sponsorLicenceNumber?: string;
    region?: string;
  };

  if (!companyName?.trim()) {
    res.status(400).json({ error: "Company name is required." });
    return;
  }
  const validIndustries = ["nhs_trust", "university", "private_healthcare", "charity", "other"];
  if (!industry || !validIndustries.includes(industry)) {
    res.status(400).json({ error: `Industry must be one of: ${validIndustries.join(", ")}.` });
    return;
  }
  if (!region?.trim()) {
    res.status(400).json({ error: "Region is required." });
    return;
  }

  const [existing] = await db
    .select({ id: employerProfilesTable.id })
    .from(employerProfilesTable)
    .where(eq(employerProfilesTable.userId, userId));

  let profile;
  if (existing) {
    [profile] = await db
      .update(employerProfilesTable)
      .set({ companyName: companyName.trim(), industry: industry as "nhs_trust" | "university" | "private_healthcare" | "charity" | "other", sponsorLicenceNumber: sponsorLicenceNumber?.trim() ?? null, region: region.trim() })
      .where(eq(employerProfilesTable.userId, userId))
      .returning();
  } else {
    [profile] = await db
      .insert(employerProfilesTable)
      .values({
        userId,
        companyName: companyName.trim(),
        industry: industry as "nhs_trust" | "university" | "private_healthcare" | "charity" | "other",
        sponsorLicenceNumber: sponsorLicenceNumber?.trim() ?? null,
        region: region.trim(),
      })
      .returning();
    await db.update(usersTable).set({ role: "employer" }).where(eq(usersTable.id, userId));
  }

  res.json(profile);
});

router.get("/employer/jobs", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [empProfile] = await db
    .select()
    .from(employerProfilesTable)
    .where(eq(employerProfilesTable.userId, userId));

  if (!empProfile) {
    res.json({ jobs: [] });
    return;
  }

  const jobs = await db
    .select()
    .from(jobListingsTable)
    .where(eq(jobListingsTable.employerProfileId, empProfile.id))
    .orderBy(desc(jobListingsTable.createdAt));

  const jobsWithCounts = await Promise.all(
    jobs.map(async (job) => {
      const applicants = await db
        .select({ id: applicationsTable.id })
        .from(applicationsTable)
        .where(eq(applicationsTable.roleId, job.id + 1_000_000));
      return { ...job, applicantCount: applicants.length };
    }),
  );

  res.json({ jobs: jobsWithCounts, employerProfile: empProfile });
});

router.post("/employer/jobs", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [empProfile] = await db
    .select()
    .from(employerProfilesTable)
    .where(eq(employerProfilesTable.userId, userId));

  if (!empProfile) {
    res.status(400).json({ error: "Complete your employer profile first." });
    return;
  }

  const { title, specialty, location, salaryBand, sponsorshipOffered, requirements, description, regulator, requiredRegistration, targetProfessions, targetRegions } = req.body as {
    title?: string;
    specialty?: string;
    location?: string;
    salaryBand?: string;
    sponsorshipOffered?: boolean;
    requirements?: string;
    description?: string;
    regulator?: string;
    requiredRegistration?: string;
    targetProfessions?: string[];
    targetRegions?: string[];
  };

  if (!title?.trim()) { res.status(400).json({ error: "Job title is required." }); return; }
  if (!location?.trim()) { res.status(400).json({ error: "Location is required." }); return; }
  if (!regulator || !["GMC", "NMC", "HCPC"].includes(regulator)) {
    res.status(400).json({ error: "Regulator must be GMC, NMC, or HCPC." }); return;
  }
  if (!requiredRegistration?.trim()) { res.status(400).json({ error: "Required registration is required." }); return; }

  const [job] = await db
    .insert(jobListingsTable)
    .values({
      employerProfileId: empProfile.id,
      title: title.trim(),
      specialty: specialty?.trim() ?? null,
      location: location.trim(),
      salaryBand: salaryBand?.trim() ?? null,
      sponsorshipOffered: sponsorshipOffered ?? false,
      requirements: requirements?.trim() ?? null,
      description: description?.trim() ?? null,
      status: "draft",
      regulator: regulator as "GMC" | "NMC" | "HCPC",
      requiredRegistration: requiredRegistration.trim(),
      targetProfessions: targetProfessions ?? [],
      targetRegions: targetRegions ?? [],
    })
    .returning();

  res.status(201).json(job);
});

router.get("/employer/jobs/:id", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.id as string, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [job] = await db.select().from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!job) { res.status(404).json({ error: "Job listing not found." }); return; }

  res.json(job);
});

router.put("/employer/jobs/:id", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.id as string, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [existing] = await db.select({ id: jobListingsTable.id, status: jobListingsTable.status }).from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!existing) { res.status(404).json({ error: "Job listing not found." }); return; }

  const { title, specialty, location, salaryBand, sponsorshipOffered, requirements, description, regulator, requiredRegistration, targetProfessions, targetRegions } = req.body as {
    title?: string; specialty?: string; location?: string; salaryBand?: string;
    sponsorshipOffered?: boolean; requirements?: string; description?: string;
    regulator?: string; requiredRegistration?: string; targetProfessions?: string[]; targetRegions?: string[];
  };

  const updates: Partial<typeof jobListingsTable.$inferInsert> = {};
  if (title !== undefined) updates.title = title.trim();
  if (specialty !== undefined) updates.specialty = specialty.trim() || null;
  if (location !== undefined) updates.location = location.trim();
  if (salaryBand !== undefined) updates.salaryBand = salaryBand.trim() || null;
  if (sponsorshipOffered !== undefined) updates.sponsorshipOffered = sponsorshipOffered;
  if (requirements !== undefined) updates.requirements = requirements.trim() || null;
  if (description !== undefined) updates.description = description.trim() || null;
  if (regulator !== undefined && ["GMC", "NMC", "HCPC"].includes(regulator)) updates.regulator = regulator as "GMC" | "NMC" | "HCPC";
  if (requiredRegistration !== undefined) updates.requiredRegistration = requiredRegistration.trim();
  if (targetProfessions !== undefined) updates.targetProfessions = targetProfessions;
  if (targetRegions !== undefined) updates.targetRegions = targetRegions;

  const [updated] = await db.update(jobListingsTable).set(updates).where(eq(jobListingsTable.id, jobId)).returning();
  res.json(updated);
});

router.delete("/employer/jobs/:id", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.id as string, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [deleted] = await db.delete(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id))).returning({ id: jobListingsTable.id });
  if (!deleted) { res.status(404).json({ error: "Job listing not found." }); return; }

  res.json({ message: "Job listing deleted." });
});

router.put("/employer/jobs/:id/publish", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.id as string, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [job] = await db.select().from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!job) { res.status(404).json({ error: "Job listing not found." }); return; }

  if (!job.description?.trim() && !job.requirements?.trim()) {
    res.status(400).json({ error: "Please add a description or requirements before publishing." });
    return;
  }

  const [updated] = await db.update(jobListingsTable).set({ status: "published" }).where(eq(jobListingsTable.id, jobId)).returning();
  res.json(updated);
});

router.put("/employer/jobs/:id/close", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.id as string, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [updated] = await db.update(jobListingsTable).set({ status: "closed" }).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id))).returning();
  if (!updated) { res.status(404).json({ error: "Job listing not found." }); return; }

  res.json(updated);
});

router.post("/employer/jobs/:id/generate-description", requireEmployer(), async (req, res): Promise<void> => {
  const jobId = parseInt(req.params.id as string, 10);
  const userId = req.user!.id;

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(400).json({ error: "Employer profile not found." }); return; }

  const [job] = await db.select().from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!job) { res.status(404).json({ error: "Job listing not found." }); return; }

  const prompt = `Generate a professional UK healthcare job description for:
- Role: ${job.title}
- Organisation: ${empProfile.companyName} (${empProfile.industry.replace(/_/g, " ")})
- Location: ${job.location}
- Specialty: ${job.specialty ?? "General"}
- Salary Band: ${job.salaryBand ?? "Competitive"}
- Regulator: ${job.regulator}
- Required Registration: ${job.requiredRegistration}
- Sponsorship offered: ${job.sponsorshipOffered ? "Yes" : "No"}
${job.requirements ? `- Requirements/person spec:\n${job.requirements}` : ""}

Write a clear, compelling, professionally-worded job description (300–500 words) suitable for posting on a UK healthcare jobs board. Include: role overview, key responsibilities, person specification highlights, and what the organisation offers. Use plain English — avoid jargon. End with a note about the regulatory requirement.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert NHS and UK healthcare HR writer. Write clear, inclusive, professionally-formatted job descriptions." },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
      temperature: 0.7,
    });

    const description = response.choices[0]?.message?.content?.trim() ?? "";

    const [updated] = await db
      .update(jobListingsTable)
      .set({ description })
      .where(eq(jobListingsTable.id, jobId))
      .returning();

    res.json({ description: updated.description, disclaimer: DISCLAIMER });
  } catch (err) {
    console.error("[employer] AI description generation failed:", err);
    res.status(500).json({ error: "AI service unavailable. Please write the description manually." });
  }
});

router.get("/employer/jobs/:id/applicants", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.id as string, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [job] = await db.select().from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!job) { res.status(404).json({ error: "Job listing not found." }); return; }

  const apps = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.roleId, jobId + 1_000_000))
    .orderBy(desc(applicationsTable.appliedAt));

  const enriched = await Promise.all(
    apps.map(async (app) => {
      const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, app.userId));
      const [user] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, app.userId));
      const [latestDecision] = await db
        .select({ outcome: decisionRecordsTable.outcome, explanationText: decisionRecordsTable.explanationText, createdAt: decisionRecordsTable.createdAt })
        .from(decisionRecordsTable)
        .where(eq(decisionRecordsTable.userId, app.userId))
        .orderBy(desc(decisionRecordsTable.createdAt))
        .limit(1);

      const isEligible = latestDecision?.outcome === "eligible";
      const registrationStatuses = ["registered", "fully_registered", "full_registration"];
      const hasRegistration = profile?.registrationStatus != null && registrationStatuses.includes(profile.registrationStatus.toLowerCase());

      let matchScore = 20;
      if (isEligible) matchScore += 40;
      if (hasRegistration) matchScore += 20;
      if (profile?.requiresSponsorship === job.sponsorshipOffered) matchScore += 15;
      if (profile?.experienceYears != null && profile.experienceYears >= 2) matchScore += 5;
      matchScore = Math.min(matchScore, 100);

      const complianceConfidence = isEligible ? (hasRegistration ? "high" : "medium") : "low";

      return {
        applicationId: app.id,
        userId: app.userId,
        candidateName: user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Candidate" : "Candidate",
        candidateEmail: user?.email ?? null,
        profession: profile?.profession ?? null,
        registrationStatus: profile?.registrationStatus ?? null,
        requiresSponsorship: profile?.requiresSponsorship ?? false,
        experienceYears: profile?.experienceYears ?? null,
        qualificationCountry: profile?.qualificationCountry ?? null,
        eligibilityOutcome: latestDecision?.outcome ?? null,
        isEligible,
        matchScore,
        complianceConfidence,
        stage: app.status,
        appliedAt: app.appliedAt,
        notes: app.notes ?? null,
      };
    }),
  );

  enriched.sort((a, b) => b.matchScore - a.matchScore);

  res.json({ applicants: enriched, job });
});

router.put("/employer/jobs/:jobId/applicants/:applicationId/stage", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const jobId = parseInt(req.params.jobId as string, 10);
  const applicationId = parseInt(req.params.applicationId as string, 10);
  const { stage, notes } = req.body as { stage?: string; notes?: string };

  const validStages = ["applied", "shortlisted", "interview", "offer", "rejected", "no_response"];
  if (!stage || !validStages.includes(stage)) {
    res.status(400).json({ error: `Stage must be one of: ${validStages.join(", ")}.` });
    return;
  }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [job] = await db.select({ id: jobListingsTable.id }).from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!job) { res.status(404).json({ error: "Job listing not found." }); return; }

  const updateData: { status: string; notes?: string } = { status: stage };
  if (notes !== undefined) updateData.notes = notes;

  const [updated] = await db
    .update(applicationsTable)
    .set(updateData)
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.roleId, jobId + 1_000_000)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Application not found." }); return; }

  res.json({ applicationId: updated.id, stage: updated.status, notes: updated.notes });
});

export default router;
