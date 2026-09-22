import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import { db, careerProfilesTable, profilesTable, documentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireConsent } from "../middlewares/consentMiddleware";
import { openai } from "@workspace/integrations-openai-ai-server";
import { maskPersonalContactInfo, resolveJobsageAlias } from "../lib/jobsageEmailGen";

const router: IRouter = Router();

const MAX_PROFILES = 3;

type MakerProfileFacts = {
  profession?: string;
  specialty?: string;
  qualificationType?: string;
  qualificationCountry?: string;
  qualificationYear?: number;
  experienceYears?: number;
  registrationStatus?: "registered" | "not_registered" | "in_process";
  languages?: string[];
  city?: string;
  preferredRegion?: string[];
  contactEmail?: string;
};

export type CareerProfileMakerEvidence = {
  candidateName: string;
  profileFacts: MakerProfileFacts;
  sourceCvFacts: MakerProfileFacts | null;
  targetDirection: string;
};

export function validateCareerProfileMakerSource(
  sourceDocument: {
    userId: string;
    documentType: string | null;
    parsedData: unknown;
  } | null,
  userId: string,
): { statusCode: number; error: string } | null {
  if (!sourceDocument || sourceDocument.userId !== userId || sourceDocument.documentType !== "cv") {
    return {
      statusCode: 404,
      error: "Source CV not found. Choose one of your documents categorised as a CV.",
    };
  }
  if (!sourceDocument.parsedData || typeof sourceDocument.parsedData !== "object" || Array.isArray(sourceDocument.parsedData)) {
    return {
      statusCode: 400,
      error: "This source CV has no candidate-confirmed fields yet. Parse it and save the reviewed fields on Documents first.",
    };
  }
  return null;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned || /^(unknown|not specified|n\/a)$/i.test(cleaned)) return undefined;
  return cleaned;
}

function cleanNumber(value: unknown, minimum: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : undefined;
}

function cleanRegistrationStatus(value: unknown): MakerProfileFacts["registrationStatus"] {
  return value === "registered" || value === "not_registered" || value === "in_process" ? value : undefined;
}

function pickMakerFacts(source: Record<string, unknown>): MakerProfileFacts {
  const facts: MakerProfileFacts = {};
  const profession = cleanText(source.profession);
  const specialty = cleanText(source.specialty);
  const qualificationType = cleanText(source.qualificationType);
  const qualificationCountry = cleanText(source.qualificationCountry);
  const registrationStatus = cleanRegistrationStatus(source.registrationStatus);
  const qualificationYear = cleanNumber(source.qualificationYear, 1900);
  const experienceYears = cleanNumber(source.experienceYears, 1);
  const city = cleanText(source.city);
  const contactEmail = cleanText(source.contactEmail);
  const languages = Array.isArray(source.languages)
    ? source.languages.map(cleanText).filter((value): value is string => Boolean(value))
    : [];
  const preferredRegion = Array.isArray(source.preferredRegion)
    ? source.preferredRegion.map(cleanText).filter((value): value is string => Boolean(value))
    : [];

  if (profession) facts.profession = profession;
  if (specialty) facts.specialty = specialty;
  if (qualificationType) facts.qualificationType = qualificationType;
  if (qualificationCountry) facts.qualificationCountry = qualificationCountry;
  if (qualificationYear !== undefined) facts.qualificationYear = qualificationYear;
  if (experienceYears !== undefined) facts.experienceYears = experienceYears;
  if (registrationStatus) facts.registrationStatus = registrationStatus;
  if (languages.length) facts.languages = languages;
  if (city) facts.city = city;
  if (preferredRegion.length) facts.preferredRegion = preferredRegion;
  if (contactEmail) facts.contactEmail = contactEmail;
  return facts;
}

export function buildCareerProfileMakerEvidence(params: {
  careerProfile: { name: string; focusArea: string };
  baseProfile?: Record<string, unknown> | null;
  sourceParsedData?: Record<string, unknown> | null;
  contactEmail?: string | null;
}): CareerProfileMakerEvidence {
  const profileFacts = pickMakerFacts({
    ...(params.baseProfile ?? {}),
    contactEmail: params.contactEmail ?? undefined,
  });
  const sourceCvFacts = params.sourceParsedData ? pickMakerFacts(params.sourceParsedData) : null;
  return {
    candidateName: params.careerProfile.name.trim(),
    profileFacts,
    sourceCvFacts: sourceCvFacts && Object.keys(sourceCvFacts).length > 0 ? sourceCvFacts : null,
    targetDirection: params.careerProfile.focusArea.trim(),
  };
}

export function buildCareerProfileMakerSystemPrompt(): string {
  return (
    "You are an evidence-bound UK CV draft writer. Build a clearly labelled draft from only the candidate-confirmed evidence supplied by the user. " +
    "This is the AI CV Maker, not the uploaded-CV Enhancer: it creates a new draft and must not rewrite or reconstruct an uploaded CV.\n\n" +
    "EVIDENCE CONTRACT:\n" +
    "- profileFacts are candidate-confirmed profile values and may be stated only as supplied.\n" +
    "- sourceCvFacts are candidate-confirmed structured fields saved after the candidate reviewed a source CV. They may be stated only as supplied.\n" +
    "- targetDirection is targeting guidance only. It is not evidence of experience, employment, duties, qualifications, registration, skills, or achievements.\n" +
    "- Do not use or infer facts from a profession, specialty, target direction, or total years of experience. Total years may appear only as the exact supplied number; never turn it into jobs, employers, duties, dates, or metrics.\n" +
    "- Never invent or guess employers, job titles, duties, achievements, dates, qualifications, institutions, registration bodies/numbers/statuses, skills, languages, locations, or metrics.\n" +
    "- If a section has no evidence, keep the section and write an obvious bracketed completion request such as [Add confirmed work experience, employers, dates, and duties]. Never make a completion request look like a candidate fact.\n" +
    "- If profileFacts and sourceCvFacts conflict, do not choose or merge them as fact. Use a bracketed request for the candidate to resolve the conflict.\n\n" +
    "OUTPUT:\n" +
    "- Start with exactly: AI CV MAKER — FACTUAL DRAFT (REVIEW REQUIRED)\n" +
    "- Use candidateName exactly as supplied in the Header; do not replace or embellish it.\n" +
    "- Use these headings in order: HEADER, PERSONAL STATEMENT, WORK EXPERIENCE, EDUCATION & QUALIFICATIONS, PROFESSIONAL REGISTRATIONS, KEY SKILLS.\n" +
    "- The target direction may shape wording in the Personal Statement, but it must never add claims.\n" +
    "- Use only exact supplied facts in the Header and sections. Do not call the draft submission-ready.\n" +
    "- End with exactly: References: Available upon request.\n" +
    "- End the document with exactly one further line: Factual verification required: review, edit, and confirm every detail before using this draft.\n" +
    "Return only the draft."
  );
}

export function buildCareerProfileMakerUserPrompt(evidence: CareerProfileMakerEvidence): string {
  return (
    "Create a new factual CV draft using this evidence contract. Treat targetDirection as targeting guidance only.\n\n" +
    `${JSON.stringify(evidence, null, 2)}\n\n` +
    "Do not fill gaps with plausible or approximate content. Omit unsupported claims and use bracketed completion requests instead."
  );
}

type GenerationResult =
  | { ok: true }
  | { ok: false; statusCode: number; error: string };

async function generateCvBackground(
  profileId: number,
  userId: string,
  sourceDocumentId: number | null = null,
): Promise<GenerationResult> {
  try {
    const [[careerProfile], [baseProfile]] = await Promise.all([
      db.select().from(careerProfilesTable).where(and(eq(careerProfilesTable.id, profileId), eq(careerProfilesTable.userId, userId))),
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    ]);
    if (!careerProfile) return { ok: false, statusCode: 404, error: "Career profile not found." };
    if (!baseProfile) {
      return {
        ok: false,
        statusCode: 400,
        error: "Complete and save your Professional Profile before making a factual CV draft.",
      };
    }

    let sourceParsedData: Record<string, unknown> | null = null;
    if (sourceDocumentId !== null) {
      const [sourceDocument] = await db
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.id, sourceDocumentId),
            eq(documentsTable.userId, userId),
            eq(documentsTable.documentType, "cv"),
          ),
        )
        .limit(1);

      const sourceValidation = validateCareerProfileMakerSource(sourceDocument ?? null, userId);
      if (sourceValidation) {
        return { ok: false, ...sourceValidation };
      }
      sourceParsedData = sourceDocument.parsedData as Record<string, unknown>;
    }

    // Resolve JOBSAGE alias via centralized resolver (users table first → profiles fallback)
    const resolvedAlias = await resolveJobsageAlias(userId);
    const evidence = buildCareerProfileMakerEvidence({
      careerProfile,
      baseProfile: baseProfile as unknown as Record<string, unknown>,
      sourceParsedData,
      contactEmail: resolvedAlias,
    });
    const hasConfirmedProfileFacts = Object.keys(evidence.profileFacts).some((key) => key !== "contactEmail");
    if (!hasConfirmedProfileFacts && !evidence.sourceCvFacts) {
      return {
        ok: false,
        statusCode: 400,
        error: "Add at least one confirmed profession, specialty, qualification, registration status, language, location, or total experience before making a factual CV draft.",
      };
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: buildCareerProfileMakerSystemPrompt(),
        },
        {
          role: "user",
          content: buildCareerProfileMakerUserPrompt(evidence),
        },
      ],
      max_tokens: 1400,
      temperature: 0.2,
    });

    let aiCvContent = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!aiCvContent) {
      return { ok: false, statusCode: 502, error: "The factual CV maker returned an empty draft. Please try again." };
    }
    // Post-process: mask any personal contact info that slipped through the AI output
    if (resolvedAlias && aiCvContent) {
      aiCvContent = maskPersonalContactInfo(aiCvContent, resolvedAlias);
    }
    await db
      .update(careerProfilesTable)
      .set({
        aiCvContent,
        aiCvReviewedAt: null,
        aiCvSourceDocumentId: sourceDocumentId,
      })
      .where(and(eq(careerProfilesTable.id, profileId), eq(careerProfilesTable.userId, userId)));
    return { ok: true };
  } catch (err) {
    console.error("[career-profiles] Background CV generation failed:", err);
    return { ok: false, statusCode: 500, error: "Factual CV generation failed. Please try again." };
  }
}

router.get("/career-profiles", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const profiles = await db
    .select()
    .from(careerProfilesTable)
    .where(eq(careerProfilesTable.userId, userId))
    .orderBy(careerProfilesTable.createdAt);
  res.json({ profiles });
});

router.post("/career-profiles", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;

  const existing = await db
    .select()
    .from(careerProfilesTable)
    .where(eq(careerProfilesTable.userId, userId));

  if (existing.length >= MAX_PROFILES) {
    res.status(400).json({ error: `You can have at most ${MAX_PROFILES} career profiles.` });
    return;
  }

  const { name, focusArea } = req.body as { name?: string; focusArea?: string };
  if (!name?.trim() || !focusArea?.trim()) {
    res.status(400).json({ error: "name and focusArea are required." });
    return;
  }

  const isFirstProfile = existing.length === 0;

  const [created] = await db
    .insert(careerProfilesTable)
    .values({
      userId,
      name: name.trim(),
      focusArea: focusArea.trim(),
      isActive: isFirstProfile,
    })
    .returning();

  res.status(201).json(created);
});

router.patch("/career-profiles/:id", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  const { name, focusArea, aiCvContent, aiCvReviewed } = req.body as {
    name?: string;
    focusArea?: string;
    aiCvContent?: string | null;
    aiCvReviewed?: boolean;
  };
  const updates: Partial<{
    name: string;
    focusArea: string;
    aiCvContent: string | null;
    aiCvReviewedAt: Date | null;
    aiCvSourceDocumentId: number | null;
  }> = {};
  if (name?.trim()) updates.name = name.trim();
  const focusAreaChanged = !!focusArea?.trim() && focusArea.trim() !== profile.focusArea;
  if (focusAreaChanged) {
    updates.focusArea = focusArea!.trim();
    updates.aiCvContent = null;
    updates.aiCvReviewedAt = null;
    updates.aiCvSourceDocumentId = null;
  }
  // Maker drafts must be explicitly reviewed before the UI treats them as usable.
  if (aiCvContent !== undefined && !focusAreaChanged) {
    updates.aiCvContent = typeof aiCvContent === "string" ? aiCvContent : null;
    updates.aiCvReviewedAt =
      aiCvReviewed === true && typeof aiCvContent === "string" && aiCvContent.trim()
        ? new Date()
        : null;
  }

  if (Object.keys(updates).length === 0) {
    res.json(profile);
    return;
  }

  const [updated] = await db
    .update(careerProfilesTable)
    .set(updates)
    .where(eq(careerProfilesTable.id, id))
    .returning();

  res.json(updated);

});

router.delete("/career-profiles/:id", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  await db.delete(careerProfilesTable).where(eq(careerProfilesTable.id, id));

  if (profile.isActive) {
    const remaining = await db
      .select()
      .from(careerProfilesTable)
      .where(eq(careerProfilesTable.userId, userId))
      .orderBy(careerProfilesTable.createdAt);
    if (remaining.length > 0) {
      await db
        .update(careerProfilesTable)
        .set({ isActive: true })
        .where(eq(careerProfilesTable.id, remaining[0].id));
    }
  }

  res.status(204).send();
});

router.post("/career-profiles/:id/activate", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [profile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!profile) { res.status(404).json({ error: "Career profile not found." }); return; }

  await db
    .update(careerProfilesTable)
    .set({ isActive: false })
    .where(eq(careerProfilesTable.userId, userId));

  const [activated] = await db
    .update(careerProfilesTable)
    .set({ isActive: true })
    .where(eq(careerProfilesTable.id, id))
    .returning();

  res.json(activated);
});

router.post("/career-profiles/:id/generate-cv", requireAuthenticated, requireConsent, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const [careerProfile] = await db
    .select()
    .from(careerProfilesTable)
    .where(and(eq(careerProfilesTable.id, id), eq(careerProfilesTable.userId, userId)));

  if (!careerProfile) { res.status(404).json({ error: "Career profile not found." }); return; }

  const rawSourceDocumentId = (req.body as { sourceDocumentId?: unknown }).sourceDocumentId;
  const sourceDocumentId =
    rawSourceDocumentId === undefined || rawSourceDocumentId === null || rawSourceDocumentId === ""
      ? null
      : typeof rawSourceDocumentId === "number" && Number.isInteger(rawSourceDocumentId) && rawSourceDocumentId > 0
      ? rawSourceDocumentId
      : null;
  if (
    rawSourceDocumentId !== undefined &&
    rawSourceDocumentId !== null &&
    rawSourceDocumentId !== "" &&
    sourceDocumentId === null
  ) {
    res.status(400).json({ error: "sourceDocumentId must be a positive integer." });
    return;
  }

  const generation = await generateCvBackground(id, userId, sourceDocumentId);
  if (!generation.ok) {
    res.status(generation.statusCode).json({ error: generation.error });
    return;
  }

  const [updated] = await db
    .select()
    .from(careerProfilesTable)
    .where(eq(careerProfilesTable.id, id));

  if (!updated) { res.status(404).json({ error: "Career profile not found after generation." }); return; }
  res.json(updated);
});

export default router;
