import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { db, profilesTable, jobListingsTable, smartApplyDraftsTable, documentsTable, sponsorLicenceVacanciesTable, sponsorLicencesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuthenticated } from "../middlewares/requireRole";
import { getStandardQuestions, prefillApplicationAnswers } from "../lib/smartApply";
import { computeSmartApplyReady } from "../lib/profileCompleteness";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { ensureCanonicalJobsageAlias } from "../lib/jobsageEmailGen";
import {
  classifyVacancyCategory,
  inferVacancySponsorshipStatus,
  isSponsorVacancyRoleId,
  sponsorVacancyIdFromRoleId,
} from "../lib/sponsorVacancyRoles";
import { statutoryRegulatorForCategory } from "../lib/professionCategory";
import { getCandidateVacancyStatus } from "../lib/vacancyLiveness";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.get("/smart-apply/questions", requireAuthenticated, (_req: Request, res: Response): void => {
  res.json({ questions: getStandardQuestions() });
});

/**
 * Safe identity/contact fields for browser-based application forms.
 * Keep this allowlist deliberately small: do not return an entire user or profile row.
 */
router.get("/smart-apply/candidate-prefill", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const firstName = user.firstName ?? null;
  const lastName = user.lastName ?? null;
  const fullName = [firstName, lastName].filter((name): name is string => Boolean(name)).join(" ");
  const jobsageEmail = await ensureCanonicalJobsageAlias(user.id, firstName, lastName);
  const [profile] = await db
    .select({
      phone: profilesTable.phone,
      streetAddress: profilesTable.streetAddress,
      city: profilesTable.city,
      postcode: profilesTable.postcode,
      country: profilesTable.country,
      profession: profilesTable.profession,
      specialty: profilesTable.specialty,
      qualificationCountry: profilesTable.qualificationCountry,
      qualificationType: profilesTable.qualificationType,
      qualificationYear: profilesTable.qualificationYear,
      experienceYears: profilesTable.experienceYears,
      registrationStatus: profilesTable.registrationStatus,
      residencyStatus: profilesTable.residencyStatus,
      preferredStartDate: profilesTable.preferredStartDate,
      languages: profilesTable.languages,
    })
    .from(profilesTable)
    .where(eq(profilesTable.userId, user.id));

  res.json({
    firstName,
    lastName,
    fullName,
    email: jobsageEmail,
    phone: profile?.phone ?? null,
    streetAddress: profile?.streetAddress ?? null,
    city: profile?.city ?? null,
    postcode: profile?.postcode ?? null,
    country: profile?.country ?? "United Kingdom",
    profession: profile?.profession ?? null,
    specialty: profile?.specialty ?? null,
    qualificationCountry: profile?.qualificationCountry ?? null,
    qualificationType: profile?.qualificationType ?? null,
    qualificationYear: profile?.qualificationYear ?? null,
    experienceYears: profile?.experienceYears ?? null,
    registrationStatus: profile?.registrationStatus ?? null,
    residencyStatus: profile?.residencyStatus ?? null,
    preferredStartDate: profile?.preferredStartDate ?? null,
    languages: profile?.languages ?? null,
  });
});

const STRUCTURED_PREFILL_SENSITIVE_PATTERN =
  /\b(caution|criminal|conviction|asbo|disclosure|dbs|health|medical|disab|ethnic|sex|gender|religion|sexual orientation|diversity|equal opportunit|national insurance|ni number|passport|date of birth|dob|declaration|consent|right to work|rtw|work permit|sponsorship|current employee|currently work|bank account|sort code|marital|dependant|next of kin)\b/i;

router.post("/smart-apply/structured-prefill", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const rawFields = Array.isArray(req.body?.fields) ? req.body.fields : [];
  const fields = rawFields
    .slice(0, 120)
    .flatMap((field: unknown) => {
      if (!field || typeof field !== "object") return [];
      const candidate = field as Record<string, unknown>;
      const id = typeof candidate.id === "string" ? candidate.id.slice(0, 120) : "";
      const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 500) : "";
      const controlType = typeof candidate.controlType === "string" ? candidate.controlType.slice(0, 20) : "text";
      const options = Array.isArray(candidate.options)
        ? candidate.options.filter((option): option is string => typeof option === "string").slice(0, 80).map((option) => option.slice(0, 200))
        : [];
      if (!id || !label || STRUCTURED_PREFILL_SENSITIVE_PATTERN.test(label)) return [];
      return [{ id, label, controlType, options }];
    });
  if (fields.length === 0) {
    res.json({ values: [] });
    return;
  }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, req.user!.id));
  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }
  const cvText = await fetchSmartApplyCvText(req.user!.id);
  const firstName = req.user!.firstName ?? "";
  const lastName = req.user!.lastName ?? "";
  const jobsageEmail = await ensureCanonicalJobsageAlias(req.user!.id, firstName, lastName);
  const roleTitle = typeof req.body?.jobTitle === "string" ? req.body.jobTitle.trim().slice(0, 300) : "";
  const employer = typeof req.body?.employer === "string" ? req.body.employer.trim().slice(0, 300) : "";
  const evidence = `
Candidate:
- Name: ${[firstName, lastName].filter(Boolean).join(" ")}
- Email: ${jobsageEmail}
- Phone: ${profile.phone ?? ""}
- Address: ${[profile.streetAddress, profile.city, profile.postcode, profile.country].filter(Boolean).join(", ")}
- Profession: ${profile.profession}
- Specialty: ${profile.specialty}
- Qualification: ${profile.qualificationType}, ${profile.qualificationCountry}, ${profile.qualificationYear}
- Experience: ${profile.experienceYears} years
- Registration status: ${profile.registrationStatus}
- Residency status: ${profile.residencyStatus}
- Preferred start date: ${profile.preferredStartDate ?? ""}
- Languages: ${profile.languages?.join(", ") ?? ""}
- Vacancy: ${roleTitle}${employer ? ` at ${employer}` : ""}

CV extract:
${cvText ?? "Unavailable"}`.trim();

  const prompt = `Map the supplied candidate evidence into these empty job-application controls.

Rules:
- Return a value only when it is explicitly supported by the profile or CV.
- Never invent an employer, role, duty, qualification, course, trainer, date, reason for leaving, reference, achievement, or sick-day count.
- For repeated employment, education, qualification, or training groups, map records newest-first and respect the row number in the label.
- Use concise factual values, not essay prose.
- For select/radio controls, use one option exactly as written or null.
- Return null when evidence is missing or ambiguous.

Fields:
${JSON.stringify(fields)}

Evidence:
${evidence}

Return only JSON: {"values":[{"id":"field id","value":"exact value or null"}]}`;

  try {
    const request = () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You extract structured job-application facts. Never fabricate missing candidate history." },
          { role: "user", content: prompt },
        ],
      });

    let response;
    try {
      response = await request();
    } catch (primaryError) {
      console.warn(
        "[smart-apply-structured-prefill] model failed; retrying with gpt-4o-mini:",
        primaryError instanceof Error ? primaryError.message : String(primaryError),
      );
      response = await request();
    }
    let parsed: { values?: unknown[] } = {};
    try {
      parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as { values?: unknown[] };
    } catch {
      parsed = {};
    }
    const allowedIds = new Set(fields.map((field: { id: string }) => field.id));
    const values = Array.isArray(parsed.values)
      ? parsed.values.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Record<string, unknown>;
          const id = typeof candidate.id === "string" ? candidate.id : "";
          const value = typeof candidate.value === "string" ? candidate.value.trim().slice(0, 4000) : null;
          return allowedIds.has(id) ? [{ id, value: value || null }] : [];
        })
      : [];
    res.json({ values });
  } catch (error) {
    console.error("[smart-apply-structured-prefill] mapping error:", error);
    res.status(503).json({ error: "Could not map your saved profile and CV details right now. Please retry." });
  }
});

async function fetchSmartApplyCvText(userId: string): Promise<string | null> {
  try {
    const [cv] = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.userId, userId), eq(documentsTable.documentType, "cv")))
      .orderBy(desc(documentsTable.isPrimary), desc(documentsTable.uploadedAt));

    if (!cv || cv.mimeType !== "application/pdf") return null;
    const objectFile = await objectStorageService.getObjectEntityFile(cv.storageKey);
    const response = await objectStorageService.downloadObject(objectFile);
    const buffer = Buffer.from(await response.arrayBuffer());
    const { PDFParse } = (await import("pdf-parse")) as unknown as {
      PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
        getText(): Promise<{ text: string }>;
      };
    };
    const parsed = await new PDFParse({ data: buffer }).getText();
    return parsed.text?.replace(/\s+/g, " ").trim().slice(0, 6000) || null;
  } catch {
    // CV context improves a draft when available but must never stop an application.
    return null;
  }
}

/**
 * Downloads the authenticated candidate's current CV without disclosing its storage path.
 */
router.get("/smart-apply/cv", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const [cv] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.userId, req.user!.id), eq(documentsTable.documentType, "cv")))
    .orderBy(desc(documentsTable.isPrimary), desc(documentsTable.uploadedAt));

  if (!cv) {
    res.status(404).json({ error: "Current CV not found" });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(cv.storageKey);
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: req.user!.id,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // The database filename is safe to expose to the file owner; never expose the storage key.
    const filename = cv.filename.replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Current CV not found" });
      return;
    }
    res.status(500).json({ error: "Failed to download current CV" });
  }
});

router.post("/roles/:id/smart-apply/prefill", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.id as string, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid role ID" });
    return;
  }

  const userId = req.user!.id;
  const suppliedContext = (req.body ?? {}) as {
    title?: unknown;
    employer?: unknown;
    location?: unknown;
    salary?: unknown;
    description?: unknown;
    externalUrl?: unknown;
    regulator?: unknown;
  };
  const optionalText = (value: unknown, maxLength: number): string | null =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(404).json({ error: "Candidate profile not found. Please complete your profile first." });
    return;
  }

  const { ready, missingFields } = computeSmartApplyReady(profile);
  if (!ready) {
    res.status(422).json({
      error: `Please complete the following key profile fields before using Smart Apply: ${missingFields.join(", ")}.`,
    });
    return;
  }

  let roleContext = {
    title: optionalText(suppliedContext.title, 300) ?? `Role #${roleId}`,
    employer: optionalText(suppliedContext.employer, 300),
    description: optionalText(suppliedContext.description, 6000),
    regulator: optionalText(suppliedContext.regulator, 100) ?? "GMC/NMC/HCPC",
    location: optionalText(suppliedContext.location, 300) ?? "UK",
    salary: optionalText(suppliedContext.salary, 200),
    externalUrl: optionalText(suppliedContext.externalUrl, 2000),
    sponsorshipOffered: false,
  };

  if (isSponsorVacancyRoleId(roleId)) {
    const sponsorVacancyId = sponsorVacancyIdFromRoleId(roleId)!;
    const [row] = await db
      .select({ vacancy: sponsorLicenceVacanciesTable, licence: sponsorLicencesTable })
      .from(sponsorLicenceVacanciesTable)
      .leftJoin(
        sponsorLicencesTable,
        eq(sponsorLicenceVacanciesTable.organisationName, sponsorLicencesTable.organisationName),
      )
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyId));
    if (!row) {
      res.status(404).json({ error: "Sponsor vacancy not found." });
      return;
    }
    if (row) {
      if (getCandidateVacancyStatus({
        sourceType: row.vacancy.sourceType,
         title: row.vacancy.title,
        liveness: row.vacancy.liveness,
        lastVerifiedAt: row.vacancy.lastVerifiedAt,
        lastDiscoveredAt: row.vacancy.lastDiscoveredAt,
        sourceMissingSince: row.vacancy.sourceMissingSince,
        sourceMissingObservations: row.vacancy.sourceMissingObservations,
        closesAt: row.vacancy.closesAt,
        expiresAt: row.vacancy.expiresAt,
        closedReason: row.vacancy.closedReason,
        companyVacancyEvidence: row.vacancy.companyVacancyEvidence,
        companyEvidenceLegacyUntil: row.vacancy.companyEvidenceLegacyUntil,
      }) !== "visible") {
        res.status(409).json({ error: "This vacancy is no longer available for Smart Apply." });
        return;
      }
      const category = classifyVacancyCategory(row.vacancy.title, row.vacancy.description);
      roleContext = {
        title: row.vacancy.title,
        employer: row.licence?.organisationName ?? row.vacancy.organisationName,
        description: row.vacancy.description,
        regulator: category ? (statutoryRegulatorForCategory(category) ?? "GMC/NMC/HCPC") : "GMC/NMC/HCPC",
        location: row.vacancy.location?.trim() || "United Kingdom",
        salary: optionalText(suppliedContext.salary, 200),
        externalUrl: row.vacancy.url ?? optionalText(suppliedContext.externalUrl, 2000),
        sponsorshipOffered: inferVacancySponsorshipStatus(row.vacancy.title, row.vacancy.description) === "confirmed",
      };
    }
  } else if (roleId > 1_000_000) {
    const jobId = roleId - 1_000_000;
    const [job] = await db
      .select()
      .from(jobListingsTable)
      .where(eq(jobListingsTable.id, jobId));

    if (job) {
      roleContext = {
        title: job.title,
        employer: optionalText(suppliedContext.employer, 300),
        description: job.description,
        regulator: job.regulator,
        location: job.location,
        salary: optionalText(suppliedContext.salary, 200),
        externalUrl: job.applyUrl ?? optionalText(suppliedContext.externalUrl, 2000),
        sponsorshipOffered: job.sponsorshipOffered ?? false,
      };
    }
  }

  try {
    const cvText = await fetchSmartApplyCvText(userId);
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
        preferredRegion: Array.isArray(profile.preferredRegion) ? profile.preferredRegion.join(", ") : (profile.preferredRegion ?? null),
        languages: profile.languages,
        additionalNotes: profile.additionalNotes,
        cvText,
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
  const roleId = parseInt(req.params.roleId as string, 10);
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
  const roleId = parseInt(req.params.roleId as string, 10);
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

// Streaming AI assistant — answers candidate questions using their profile + role context
router.post("/smart-apply/assistant", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { roleId, message, question, questionId, questionText, jobTitle, employer, jobDescription, wordLimit, maxLength } = req.body as {
    roleId?: number;
    message?: string;
    question?: string;
    questionId?: string;
    questionText?: string;
    jobTitle?: string;
    employer?: string;
    jobDescription?: string;
    wordLimit?: number;
    maxLength?: number;
  };

  const userMessage = (message ?? question)?.trim();
  if (!userMessage) {
    res.status(400).json({ error: "message or question is required" });
    return;
  }
  const exactQuestion = (questionText ?? question ?? userMessage).trim();
  if (/\b(caution|criminal|conviction|convicted|criminal record|asbo|disclosure|dbs|health|medical|disab|ethnic|sex|gender|religion|sexual orientation|diversity|equal opportunit|declaration|consent|agree(?:ment)?|payroll|tax declaration|national insurance|ni number|passport|date of birth|dob)\b/i.test(exactQuestion)) {
    res.status(422).json({
      error: "JOBSAGE can't generate an answer because this question asks you to confirm sensitive or personal information. Please review it and answer it yourself.",
    });
    return;
  }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  let roleContext = { title: "UK Healthcare Role", location: "UK", regulator: "GMC/NMC/HCPC", description: null as string | null, sponsorshipOffered: false };
  let scrapedSummary: string | null = null;
  if (!roleId && (jobTitle?.trim() || employer?.trim() || jobDescription?.trim())) {
    scrapedSummary = [
      `Role: ${jobTitle?.trim() || "Unknown role"}`,
      employer?.trim() ? `Employer: ${employer.trim()}` : null,
      jobDescription?.trim() ? `Job description excerpt: ${jobDescription.trim().slice(0, 1500)}` : null,
    ].filter(Boolean).join("\n");
  }
  if (roleId && isSponsorVacancyRoleId(roleId)) {
    const sponsorVacancyId = sponsorVacancyIdFromRoleId(roleId)!;
    const [row] = await db
      .select({ vacancy: sponsorLicenceVacanciesTable, licence: sponsorLicencesTable })
      .from(sponsorLicenceVacanciesTable)
      .leftJoin(
        sponsorLicencesTable,
        eq(sponsorLicenceVacanciesTable.organisationName, sponsorLicencesTable.organisationName),
      )
      .where(eq(sponsorLicenceVacanciesTable.id, sponsorVacancyId));
    if (!row) {
      res.status(404).json({ error: "Sponsor vacancy not found." });
      return;
    }
    if (row) {
      if (getCandidateVacancyStatus({
        sourceType: row.vacancy.sourceType,
        title: row.vacancy.title,
        liveness: row.vacancy.liveness,
        lastVerifiedAt: row.vacancy.lastVerifiedAt,
        lastDiscoveredAt: row.vacancy.lastDiscoveredAt,
        sourceMissingSince: row.vacancy.sourceMissingSince,
        sourceMissingObservations: row.vacancy.sourceMissingObservations,
        closesAt: row.vacancy.closesAt,
        expiresAt: row.vacancy.expiresAt,
        closedReason: row.vacancy.closedReason,
        companyVacancyEvidence: row.vacancy.companyVacancyEvidence,
        companyEvidenceLegacyUntil: row.vacancy.companyEvidenceLegacyUntil,
      }) !== "visible") {
        res.status(409).json({ error: "This vacancy is no longer available for Smart Apply." });
        return;
      }
      const category = classifyVacancyCategory(row.vacancy.title, row.vacancy.description);
      roleContext = {
        title: row.vacancy.title,
        location: row.vacancy.location?.trim() || "United Kingdom",
        regulator: category ? (statutoryRegulatorForCategory(category) ?? "GMC/NMC/HCPC") : "GMC/NMC/HCPC",
        description: row.vacancy.description,
        sponsorshipOffered: inferVacancySponsorshipStatus(row.vacancy.title, row.vacancy.description) === "confirmed",
      };
      scrapedSummary = [
        `Role: ${row.vacancy.title}`,
        `Employer: ${row.licence?.organisationName ?? row.vacancy.organisationName}`,
        `Location: ${row.vacancy.location?.trim() || "United Kingdom"}`,
        row.vacancy.description ? `Job description excerpt: ${row.vacancy.description.slice(0, 1500)}` : null,
        row.vacancy.url ? `Vacancy source URL: ${row.vacancy.url}` : null,
        row.licence?.contactEmail ? `Employer contact email: ${row.licence.contactEmail}` : null,
        row.licence?.contactPhone ? `Employer contact phone: ${row.licence.contactPhone}` : null,
        row.licence?.website ? `Employer website: ${row.licence.website}` : null,
      ].filter(Boolean).join("\n");
    }
  } else if (roleId && roleId > 1_000_000) {
    const jobId = roleId - 1_000_000;
    const [job] = await db.select().from(jobListingsTable).where(eq(jobListingsTable.id, jobId));
    if (job) {
      roleContext = { title: job.title, location: job.location, regulator: job.regulator, description: job.description, sponsorshipOffered: job.sponsorshipOffered ?? false };
    }
  }

  const cvText = await fetchSmartApplyCvText(userId);
  const profileSummary = `Candidate profile:
- Profession: ${profile.profession.replace(/_/g, " ")}
- Specialty: ${profile.specialty ?? "General"}
- Qualification: ${profile.qualificationType ?? "Unknown"} from ${profile.qualificationCountry ?? "International"} (${profile.qualificationYear ?? "?"})
- Experience: ${profile.experienceYears} years
- UK registration: ${profile.registrationStatus?.replace(/_/g, " ") ?? "unknown"}
- Requires sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}
${profile.preferredRegion?.length ? `- Preferred region: ${Array.isArray(profile.preferredRegion) ? profile.preferredRegion.join(", ") : profile.preferredRegion}` : ""}
${profile.languages?.length ? `- Languages: ${profile.languages.join(", ")}` : ""}
${profile.additionalNotes ? `- Candidate notes: ${profile.additionalNotes.slice(0, 1200)}` : ""}
${cvText ? `\nCV extract (use only explicit facts from this extract):\n${cvText}` : "\nCV extract: unavailable"}`.trim();

  const roleSummary = scrapedSummary ?? `Role: ${roleContext.title} | Location: ${roleContext.location} | Regulator: ${roleContext.regulator} | Sponsorship: ${roleContext.sponsorshipOffered ? "offered" : "not offered"}${roleContext.description ? `\nJob description excerpt: ${roleContext.description.slice(0, 500)}` : ""}`;

  const limits = [
    typeof wordLimit === "number" && wordLimit > 0 ? `${wordLimit} words maximum` : null,
    typeof maxLength === "number" && maxLength > 0 ? `${maxLength} characters maximum` : null,
  ].filter(Boolean).join("; ");
  const currentQCtx = `\nThe candidate is currently answering this application question: "${exactQuestion}"${questionId ? ` (id: ${questionId})` : ""}.${limits ? ` Limit: ${limits}.` : ""}`;

  const systemPrompt = `You are a friendly and expert UK healthcare career assistant helping an internationally trained health professional complete a job application.

${profileSummary}

${roleSummary}${currentQCtx}

Guidelines:
- Give direct, practical answers (2–4 sentences) unless more detail is needed
- When asked to help answer an application question, write a ready-to-use response in first person
- Use UK English spelling and professional tone
- If asked about visa/sponsorship, draw on the profile's requiresSponsorship and registration status
- Keep responses concise and actionable
- Use only facts explicitly stated in the profile, CV extract, and role context. Never invent employers, duties, registrations, qualifications, achievements, dates, or personal circumstances.
- If the information does not support a specific claim, say what the candidate needs to add instead of drafting a fictional claim.
- Never produce an answer for cautions, criminal records, DBS, health/medical, disability, diversity/equal-opportunities, declarations, consent, payroll, National Insurance, passport, or date-of-birth fields; those require the candidate's own confirmation.`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 500,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[smart-apply-assistant] stream error:", err);
    res.write(`data: ${JSON.stringify({ error: "Assistant unavailable. Please try again." })}\n\n`);
    res.end();
  }
});

router.delete("/smart-apply/draft/:roleId", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const roleId = parseInt(req.params.roleId as string, 10);
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
