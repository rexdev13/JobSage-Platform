import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  employerProfilesTable,
  jobListingsTable,
  applicationsTable,
  profilesTable,
  decisionRecordsTable,
  usersTable,
  headhuntCampaignsTable,
  candidateMessagesTable,
  documentsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, gte, isNotNull, count } from "drizzle-orm";
import { requireRole, requireAuthenticated } from "../middlewares/requireRole";
import { openai } from "@workspace/integrations-openai-ai-server";
import { sendCandidateContactEmail } from "../lib/email";

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
        .select({ id: applicationsTable.id, status: applicationsTable.status })
        .from(applicationsTable)
        .where(eq(applicationsTable.roleId, job.id + 1_000_000));
      const shortlistedCount = applicants.filter((a) => a.status === "shortlisted").length;
      const rejectedCount = applicants.filter((a) => a.status === "rejected").length;
      return { ...job, applicantCount: applicants.length, shortlistedCount, rejectedCount };
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

function buildDescriptionPrompt(params: {
  title: string;
  orgName: string;
  industry: string;
  location: string;
  specialty: string;
  salaryBand: string;
  regulator: string;
  requiredRegistration?: string;
  sponsorshipOffered: boolean;
  requirements?: string;
}) {
  return `Generate a professional UK healthcare job description for:
- Role: ${params.title}
- Organisation: ${params.orgName} (${params.industry.replace(/_/g, " ")})
- Location: ${params.location}
- Specialty: ${params.specialty}
- Salary Band: ${params.salaryBand}
- Regulator: ${params.regulator}${params.requiredRegistration ? `\n- Required Registration: ${params.requiredRegistration}` : ""}
- Sponsorship offered: ${params.sponsorshipOffered ? "Yes" : "No"}
${params.requirements ? `- Requirements/person spec:\n${params.requirements}` : ""}

Write a structured, professionally-worded job description for a UK healthcare jobs board.
Format your response using EXACTLY this structure (markdown):

**Overview**
[2–3 sentence paragraph describing the role, organisation, and what makes this opportunity compelling]

**Duties**
- [key duty]
- [key duty]
- [key duty]
- [key duty]
- [key duty]
- [key duty]

**Experience**
- [experience/qualification requirement]
- [experience/qualification requirement]
- [experience/qualification requirement]
- [experience/qualification requirement]
- [experience/qualification requirement]

Use plain English — avoid jargon. Do not add extra sections. Each bullet should be a single clear statement.`;
}

router.post("/employer/jobs/generate-description", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(400).json({ error: "Employer profile not found." }); return; }

  const { title, specialty, location, salaryBand, regulator, requirements, sponsorshipOffered } = req.body as {
    title: string;
    specialty?: string;
    location: string;
    salaryBand?: string;
    regulator?: string;
    requirements?: string;
    sponsorshipOffered?: boolean;
  };

  if (!title?.trim() || !location?.trim()) {
    res.status(400).json({ error: "title and location are required." });
    return;
  }

  const prompt = buildDescriptionPrompt({
    title: title.trim(),
    orgName: empProfile.companyName,
    industry: empProfile.industry,
    location: location.trim(),
    specialty: specialty?.trim() || "General",
    salaryBand: salaryBand?.trim() || "Competitive",
    regulator: regulator || "GMC",
    sponsorshipOffered: sponsorshipOffered ?? false,
    requirements: requirements?.trim(),
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert NHS and UK healthcare HR writer. Write clear, inclusive, structured job descriptions using the exact format requested." },
        { role: "user", content: prompt },
      ],
      max_tokens: 900,
      temperature: 0.7,
    });

    const description = response.choices[0]?.message?.content?.trim() ?? "";
    res.json({ description, disclaimer: DISCLAIMER });
  } catch (err) {
    console.error("[employer] AI description preview generation failed:", err);
    res.status(500).json({ error: "AI service unavailable. Please write the description manually." });
  }
});

router.post("/employer/jobs/description-feedback", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { sentiment, jobTitle, specialty } = req.body as { sentiment: "up" | "down"; jobTitle: string; specialty?: string };

  console.info(`[ai-feedback] employer=${userId} title="${jobTitle}" specialty="${specialty ?? ""}" sentiment=${sentiment}`);
  res.json({ ok: true });
});

router.post("/employer/jobs/:id/generate-description", requireEmployer(), async (req, res): Promise<void> => {
  const jobId = parseInt(req.params.id as string, 10);
  const userId = req.user!.id;

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(400).json({ error: "Employer profile not found." }); return; }

  const [job] = await db.select().from(jobListingsTable).where(and(eq(jobListingsTable.id, jobId), eq(jobListingsTable.employerProfileId, empProfile.id)));
  if (!job) { res.status(404).json({ error: "Job listing not found." }); return; }

  const prompt = buildDescriptionPrompt({
    title: job.title,
    orgName: empProfile.companyName,
    industry: empProfile.industry,
    location: job.location,
    specialty: job.specialty ?? "General",
    salaryBand: job.salaryBand ?? "Competitive",
    regulator: job.regulator,
    requiredRegistration: job.requiredRegistration,
    sponsorshipOffered: job.sponsorshipOffered,
    requirements: job.requirements ?? undefined,
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert NHS and UK healthcare HR writer. Write clear, inclusive, structured job descriptions using the exact format requested." },
        { role: "user", content: prompt },
      ],
      max_tokens: 900,
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

// Headhunting: list boosted candidates visible to employers
router.get("/employer/candidates", requireEmployer(), async (req, res): Promise<void> => {
  const { profession, regulator, sponsorship } = req.query as {
    profession?: string;
    regulator?: string;
    sponsorship?: string;
  };

  const boostedProfiles = await db
    .select({
      userId: profilesTable.userId,
      profession: profilesTable.profession,
      specialty: profilesTable.specialty,
      experienceYears: profilesTable.experienceYears,
      qualificationCountry: profilesTable.qualificationCountry,
      registrationStatus: profilesTable.registrationStatus,
      requiresSponsorship: profilesTable.requiresSponsorship,
    })
    .from(profilesTable)
    .where(
      and(
        eq(profilesTable.boostProfile, true),
        profession ? ilike(profilesTable.profession, `%${profession}%`) : undefined,
      ),
    );

  const enriched = await Promise.all(
    boostedProfiles.map(async (p) => {
      const [user] = await db
        .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
        .from(usersTable)
        .where(eq(usersTable.id, p.userId));

      const [latestDecision] = await db
        .select({ outcome: decisionRecordsTable.outcome, createdAt: decisionRecordsTable.createdAt })
        .from(decisionRecordsTable)
        .where(eq(decisionRecordsTable.userId, p.userId))
        .orderBy(desc(decisionRecordsTable.createdAt))
        .limit(1);

      const isEligible = latestDecision?.outcome === "eligible";

      // Filter by regulator if requested (based on profession mapping)
      if (regulator) {
        const profLower = (p.profession ?? "").toLowerCase();
        const regMap: Record<string, string[]> = {
          GMC: ["doctor", "physician"],
          NMC: ["nurse", "midwife"],
          HCPC: ["allied_health", "physiotherapist", "pharmacist", "radiographer"],
        };
        const matchedProfessions = regMap[regulator] ?? [];
        if (!matchedProfessions.some((kw) => profLower.includes(kw))) {
          return null;
        }
      }

      // Filter by sponsorship requirement if requested
      if (sponsorship === "true" && !p.requiresSponsorship) return null;
      if (sponsorship === "false" && p.requiresSponsorship) return null;

      const initials =
        [(user?.firstName ?? "").charAt(0), (user?.lastName ?? "").charAt(0)]
          .filter(Boolean)
          .join("") || "?";

      return {
        userId: p.userId,
        displayName: user
          ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Healthcare Professional"
          : "Healthcare Professional",
        initials,
        profession: p.profession,
        specialty: p.specialty,
        experienceYears: p.experienceYears,
        qualificationCountry: p.qualificationCountry,
        registrationStatus: p.registrationStatus,
        requiresSponsorship: p.requiresSponsorship,
        isEligible,
        eligibilityOutcome: latestDecision?.outcome ?? null,
        lastChecked: latestDecision?.createdAt ?? null,
      };
    }),
  );

  const candidates = enriched.filter(Boolean);
  res.json({ candidates, total: candidates.length });
});

// --- Talent Search (AI-ranked) ---
const aiMatchCache = new Map<string, { score: number; rationale: string; cachedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getAiMatchScore(
  candidateProfile: Record<string, unknown>,
  vacancyContext: { title?: string; specialty?: string; description?: string; regulator?: string } | null,
): Promise<{ score: number; rationale: string }> {
  if (!vacancyContext) {
    const base =
      (candidateProfile.isEligible ? 40 : 10) +
      (candidateProfile.experienceYears != null ? Math.min((candidateProfile.experienceYears as number) * 3, 30) : 0) +
      20;
    return { score: Math.min(base, 70), rationale: "Match based on eligibility status and experience." };
  }

  const cacheKey = `${JSON.stringify(candidateProfile)}::${JSON.stringify(vacancyContext)}`;
  const cached = aiMatchCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { score: cached.score, rationale: cached.rationale };
  }

  try {
    const prompt = `You are a UK healthcare recruitment AI. Score how well this candidate matches the vacancy.

Vacancy: ${vacancyContext.title ?? "Healthcare Role"}${vacancyContext.specialty ? ` — ${vacancyContext.specialty}` : ""}${vacancyContext.regulator ? ` (${vacancyContext.regulator})` : ""}
${vacancyContext.description ? `Description: ${vacancyContext.description.slice(0, 300)}` : ""}

Candidate Profile:
- Profession: ${candidateProfile.profession ?? "Unknown"}
- Specialty: ${candidateProfile.specialty ?? "General"}
- Experience: ${candidateProfile.experienceYears != null ? `${candidateProfile.experienceYears} years` : "Unknown"}
- Qualification country: ${candidateProfile.qualificationCountry ?? "Unknown"}
- Registration status: ${candidateProfile.registrationStatus ?? "Unknown"}
- Requires sponsorship: ${candidateProfile.requiresSponsorship ? "Yes" : "No"}
- Eligible for UK practice: ${candidateProfile.isEligible ? "Yes" : "Not confirmed"}

Respond with ONLY valid JSON: {"score": <0-100>, "rationale": "<one sentence, max 100 chars>"}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 80,
      temperature: 0.3,
    });
    const raw = response.choices[0]?.message?.content?.trim() ?? '{"score":50,"rationale":"Candidate assessed."}';
    const parsed = JSON.parse(raw) as { score: number; rationale: string };
    const result = { score: Math.min(100, Math.max(0, Math.round(parsed.score))), rationale: parsed.rationale ?? "" };
    aiMatchCache.set(cacheKey, { ...result, cachedAt: Date.now() });
    return result;
  } catch {
    const base =
      (candidateProfile.isEligible ? 40 : 10) +
      (candidateProfile.experienceYears != null ? Math.min((candidateProfile.experienceYears as number) * 3, 30) : 0) +
      20;
    return { score: Math.min(base, 70), rationale: "Match estimated from profile data." };
  }
}

router.get("/employer/talent-search", requireEmployer(), async (req, res): Promise<void> => {
  const {
    profession, specialty, eligibilityStatus, requiresSponsorship,
    experienceYearsMin, preferredRegion, vacancyId, page: pageStr,
  } = req.query as Record<string, string | undefined>;

  const userId = req.user!.id;
  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  let vacancyContext: { title?: string; specialty?: string; description?: string; regulator?: string } | null = null;
  if (vacancyId) {
    const vid = parseInt(vacancyId, 10);
    if (!isNaN(vid)) {
      const [job] = await db.select().from(jobListingsTable).where(and(eq(jobListingsTable.id, vid), eq(jobListingsTable.employerProfileId, empProfile.id)));
      if (job) vacancyContext = { title: job.title, specialty: job.specialty ?? undefined, description: job.description ?? undefined, regulator: job.regulator };
    }
  }

  // Base conditions: must have a profession (completed profile)
  const conditions: ReturnType<typeof eq>[] = [isNotNull(profilesTable.profession) as ReturnType<typeof eq>];
  if (profession) conditions.push(ilike(profilesTable.profession, `%${profession}%`) as ReturnType<typeof eq>);
  if (specialty) conditions.push(ilike(profilesTable.specialty, `%${specialty}%`) as ReturnType<typeof eq>);
  if (experienceYearsMin) {
    const minYrs = parseInt(experienceYearsMin, 10);
    if (!isNaN(minYrs)) conditions.push(gte(profilesTable.experienceYears, minYrs) as ReturnType<typeof eq>);
  }

  const profiles = await db
    .select({
      userId: profilesTable.userId,
      profession: profilesTable.profession,
      specialty: profilesTable.specialty,
      experienceYears: profilesTable.experienceYears,
      qualificationCountry: profilesTable.qualificationCountry,
      registrationStatus: profilesTable.registrationStatus,
      requiresSponsorship: profilesTable.requiresSponsorship,
      preferredRegion: profilesTable.preferredRegion,
      preferredStartDate: profilesTable.preferredStartDate,
      boostProfile: profilesTable.boostProfile,
    })
    .from(profilesTable)
    .where(and(...conditions));

  // Get document counts for all candidate user IDs
  const userIds = profiles.map((p) => p.userId);
  const docCounts: { userId: string; cnt: number }[] = userIds.length > 0
    ? await Promise.all(
        userIds.map(async (uid) => {
          const [row] = await db
            .select({ cnt: count(documentsTable.id) })
            .from(documentsTable)
            .where(eq(documentsTable.userId, uid));
          return { userId: uid, cnt: Number(row?.cnt ?? 0) };
        }),
      )
    : [];

  const docCountMap = new Map(docCounts.map((d) => [d.userId, d.cnt]));

  const enriched = await Promise.all(
    profiles.map(async (p) => {
      const isBoosted = !!p.boostProfile;
      const docCount = docCountMap.get(p.userId) ?? 0;

      // Include only boosted OR candidates with completed profile + at least 1 document
      if (!isBoosted && docCount < 1) return null;

      const [user] = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, p.userId));
      const [latestDecision] = await db
        .select({ outcome: decisionRecordsTable.outcome })
        .from(decisionRecordsTable)
        .where(eq(decisionRecordsTable.userId, p.userId))
        .orderBy(desc(decisionRecordsTable.createdAt))
        .limit(1);

      const isEligible = latestDecision?.outcome === "eligible";

      if (eligibilityStatus === "eligible" && !isEligible) return null;
      if (eligibilityStatus === "not_eligible" && isEligible) return null;
      if (requiresSponsorship === "true" && !p.requiresSponsorship) return null;
      if (requiresSponsorship === "false" && p.requiresSponsorship) return null;
      if (preferredRegion && p.preferredRegion && !p.preferredRegion.toLowerCase().includes(preferredRegion.toLowerCase())) return null;

      const { score, rationale } = await getAiMatchScore(
        { profession: p.profession, specialty: p.specialty, experienceYears: p.experienceYears, qualificationCountry: p.qualificationCountry, registrationStatus: p.registrationStatus, requiresSponsorship: p.requiresSponsorship, isEligible },
        vacancyContext,
      );

      const initials = [(user?.firstName ?? "").charAt(0), (user?.lastName ?? "").charAt(0)].filter(Boolean).join("") || "?";

      return {
        userId: p.userId,
        displayName: user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Healthcare Professional" : "Healthcare Professional",
        initials,
        profession: p.profession,
        specialty: p.specialty,
        experienceYears: p.experienceYears,
        qualificationCountry: p.qualificationCountry,
        registrationStatus: p.registrationStatus,
        requiresSponsorship: p.requiresSponsorship,
        preferredStartDate: p.preferredStartDate ?? null,
        isEligible,
        eligibilityOutcome: latestDecision?.outcome ?? null,
        matchScore: score,
        matchRationale: rationale,
        isBoosted,
      };
    }),
  );

  const filtered = enriched.filter(Boolean) as NonNullable<(typeof enriched)[number]>[];
  // Boosted candidates first, then by match score descending within each group
  filtered.sort((a, b) => {
    if (a.isBoosted !== b.isBoosted) return a.isBoosted ? -1 : 1;
    return b.matchScore - a.matchScore;
  });

  const pageNum = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const PAGE_SIZE = 20;
  const paginated = filtered.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

  res.json({ candidates: paginated, total: filtered.length, page: pageNum, pageSize: PAGE_SIZE });
});

// --- Campaign Management ---
router.get("/employer/campaigns", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.json({ campaigns: [] }); return; }

  const campaigns = await db
    .select()
    .from(headhuntCampaignsTable)
    .where(eq(headhuntCampaignsTable.employerProfileId, empProfile.id))
    .orderBy(desc(headhuntCampaignsTable.createdAt));

  res.json({ campaigns });
});

router.post("/employer/campaigns", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { name, filters, vacancyId } = req.body as { name?: string; filters?: Record<string, unknown>; vacancyId?: number };

  if (!name?.trim()) { res.status(400).json({ error: "Campaign name is required." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [campaign] = await db
    .insert(headhuntCampaignsTable)
    .values({
      employerProfileId: empProfile.id,
      name: name.trim(),
      filters: filters ?? {},
      vacancyId: vacancyId ?? null,
    })
    .returning();

  res.status(201).json(campaign);
});

router.post("/employer/campaigns/:id/run", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const campaignId = parseInt(req.params.id as string, 10);
  if (isNaN(campaignId)) { res.status(400).json({ error: "Invalid campaign ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [campaign] = await db.select().from(headhuntCampaignsTable).where(and(eq(headhuntCampaignsTable.id, campaignId), eq(headhuntCampaignsTable.employerProfileId, empProfile.id)));
  if (!campaign) { res.status(404).json({ error: "Campaign not found." }); return; }

  const [updated] = await db.update(headhuntCampaignsTable).set({ lastRunAt: new Date() }).where(eq(headhuntCampaignsTable.id, campaignId)).returning();
  res.json(updated);
});

router.delete("/employer/campaigns/:id", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const campaignId = parseInt(req.params.id as string, 10);
  if (isNaN(campaignId)) { res.status(400).json({ error: "Invalid campaign ID." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [deleted] = await db.delete(headhuntCampaignsTable).where(and(eq(headhuntCampaignsTable.id, campaignId), eq(headhuntCampaignsTable.employerProfileId, empProfile.id))).returning({ id: headhuntCampaignsTable.id });
  if (!deleted) { res.status(404).json({ error: "Campaign not found." }); return; }

  res.json({ message: "Campaign deleted." });
});

// --- Contact Candidate ---
router.post("/employer/contact-candidate", requireEmployer(), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { recipientUserId, messageText, subject, vacancyId } = req.body as {
    recipientUserId?: string;
    messageText?: string;
    subject?: string;
    vacancyId?: number;
  };

  if (!recipientUserId?.trim()) { res.status(400).json({ error: "Recipient user ID is required." }); return; }
  if (!messageText?.trim()) { res.status(400).json({ error: "Message text is required." }); return; }

  const [empProfile] = await db.select().from(employerProfilesTable).where(eq(employerProfilesTable.userId, userId));
  if (!empProfile) { res.status(404).json({ error: "Employer profile not found." }); return; }

  const [recipient] = await db
    .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, recipientUserId.trim()));
  if (!recipient) { res.status(404).json({ error: "Candidate not found." }); return; }
  if (recipient.role !== "candidate" && recipient.role !== "reviewer") {
    res.status(400).json({ error: "Can only contact candidates." }); return;
  }

  let vacancyTitle: string | null = null;
  if (vacancyId) {
    const [job] = await db.select({ title: jobListingsTable.title }).from(jobListingsTable).where(eq(jobListingsTable.id, vacancyId));
    vacancyTitle = job?.title ?? null;
  }

  const effectiveSubject = subject?.trim() || `Message from ${empProfile.companyName}`;

  const [message] = await db
    .insert(candidateMessagesTable)
    .values({
      senderEmployerProfileId: empProfile.id,
      recipientUserId: recipient.id,
      vacancyId: vacancyId ?? null,
      messageText: messageText.trim(),
      subject: effectiveSubject,
    })
    .returning();

  if (recipient.email) {
    sendCandidateContactEmail({
      to: recipient.email,
      candidateFirstName: recipient.firstName ?? "there",
      companyName: empProfile.companyName,
      subject: effectiveSubject,
      messageText: messageText.trim(),
      vacancyTitle,
    }).catch((err: unknown) => {
      console.error("[employer] Failed to send candidate contact email:", err);
    });
  }

  res.status(201).json({ message, sent: true });
});

// Get messages received by the current candidate
router.get("/candidate/messages", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const messages = await db
    .select({
      id: candidateMessagesTable.id,
      subject: candidateMessagesTable.subject,
      messageText: candidateMessagesTable.messageText,
      isRead: candidateMessagesTable.isRead,
      createdAt: candidateMessagesTable.createdAt,
      vacancyId: candidateMessagesTable.vacancyId,
      senderEmployerProfileId: candidateMessagesTable.senderEmployerProfileId,
    })
    .from(candidateMessagesTable)
    .where(eq(candidateMessagesTable.recipientUserId, userId))
    .orderBy(desc(candidateMessagesTable.createdAt));

  const enriched = await Promise.all(
    messages.map(async (m) => {
      const [empProfile] = await db
        .select({ companyName: employerProfilesTable.companyName, industry: employerProfilesTable.industry })
        .from(employerProfilesTable)
        .where(eq(employerProfilesTable.id, m.senderEmployerProfileId));
      return { ...m, companyName: empProfile?.companyName ?? "An employer", industry: empProfile?.industry ?? null };
    }),
  );

  res.json({ messages: enriched, unreadCount: enriched.filter((m) => !m.isRead).length });
});

router.patch("/candidate/messages/:id/read", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const msgId = parseInt(req.params.id as string, 10);
  if (isNaN(msgId)) { res.status(400).json({ error: "Invalid message ID." }); return; }

  const [updated] = await db
    .update(candidateMessagesTable)
    .set({ isRead: true })
    .where(and(eq(candidateMessagesTable.id, msgId), eq(candidateMessagesTable.recipientUserId, userId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Message not found." }); return; }
  res.json({ message: updated });
});

export default router;
