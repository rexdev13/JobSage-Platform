import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db, profilesTable, documentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateCoverLetter, buildPromptMessages } from "../lib/coverLetterGenerator";
import { ObjectStorageService } from "../lib/objectStorage";
import { openai } from "@workspace/integrations-openai-ai-server";
import { maskPersonalContactInfo, resolveJobsageAlias } from "../lib/jobsageEmailGen";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const COVER_LETTER_DISCLAIMER =
  "This cover letter is AI-generated for guidance only. Review and personalise before sending to any employer.";

async function fetchCvText(userId: string, objectStorageSvc: ObjectStorageService): Promise<string | null> {
  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.userId, userId), eq(documentsTable.documentType, "cv")))
      .orderBy(desc(documentsTable.isPrimary), desc(documentsTable.uploadedAt));

    if (docs.length > 0) {
      const doc = docs[0]!;
      const objectFile = await objectStorageSvc.getObjectEntityFile(doc.storageKey);
      const response = await objectStorageSvc.downloadObject(objectFile);
      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const { PDFParse } = (await import("pdf-parse")) as unknown as {
        PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
          getText(): Promise<{ text: string }>;
        };
      };
      const parsed = await new PDFParse({ data: buf }).getText();
      return parsed.text.slice(0, 4000);
    }
  } catch {
    // CV parsing is best-effort — proceed without it
  }
  return null;
}

router.post("/cover-letter/generate", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { jobTitle, employer, jobDescription, location, regulator, roleId } = req.body as {
    jobTitle?: string;
    employer?: string;
    jobDescription?: string | null;
    location?: string | null;
    regulator?: string | null;
    roleId?: number;
  };

  if (!jobTitle || !employer) {
    res.status(400).json({ error: "jobTitle and employer are required." });
    return;
  }

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  const cvText = await fetchCvText(userId, objectStorage);

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || "Candidate";

  const jobsageEmail = await resolveJobsageAlias(userId);
  const maskedCvText = cvText && jobsageEmail ? maskPersonalContactInfo(cvText, jobsageEmail) : cvText;

  try {
    const result = await generateCoverLetter({
      candidateName,
      profession: profile.profession,
      specialty: profile.specialty,
      experienceYears: profile.experienceYears,
      qualificationCountry: profile.qualificationCountry,
      registrationStatus: profile.registrationStatus,
      qualificationType: profile.qualificationType,
      qualificationYear: profile.qualificationYear,
      residencyStatus: profile.residencyStatus,
      requiresSponsorship: profile.requiresSponsorship,
      languages: profile.languages as string[] | null,
      additionalNotes: profile.additionalNotes,
      cvText: maskedCvText,
      jobTitle,
      employer,
      jobDescription: jobDescription ?? null,
      location: location ?? null,
      regulator: regulator ?? null,
      jobsageEmail,
    });

    res.json(result);
  } catch (err) {
    console.error("[cover-letter] generation error:", err);
    res.status(500).json({ error: "Failed to generate cover letter. Please try again." });
  }
});

// SSE streaming endpoint for real-time cover letter generation
router.post("/cover-letter/generate-stream", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { jobTitle, employer, jobDescription, location, regulator, roleId } = req.body as {
    jobTitle?: string;
    employer?: string;
    jobDescription?: string | null;
    location?: string | null;
    regulator?: string | null;
    roleId?: number;
  };

  if (!jobTitle || !employer) {
    res.status(400).json({ error: "jobTitle and employer are required." });
    return;
  }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  const cvText = await fetchCvText(userId, objectStorage);

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || "Candidate";

  const jobsageEmail = await resolveJobsageAlias(userId);
  const maskedCvText = cvText && jobsageEmail ? maskPersonalContactInfo(cvText, jobsageEmail) : cvText;

  const messages = buildPromptMessages({
    candidateName,
    profession: profile.profession,
    specialty: profile.specialty,
    experienceYears: profile.experienceYears,
    qualificationCountry: profile.qualificationCountry,
    registrationStatus: profile.registrationStatus,
    qualificationType: profile.qualificationType,
    qualificationYear: profile.qualificationYear,
    residencyStatus: profile.residencyStatus,
    requiresSponsorship: profile.requiresSponsorship,
    languages: profile.languages as string[] | null,
    additionalNotes: profile.additionalNotes,
    cvText: maskedCvText,
    jobTitle,
    employer,
    jobDescription: jobDescription ?? null,
    location: location ?? null,
    regulator: regulator ?? null,
    jobsageEmail,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 1000,
      stream: true,
      messages,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, disclaimer: COVER_LETTER_DISCLAIMER })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[cover-letter-stream] error:", err);
    res.write(`data: ${JSON.stringify({ error: "Failed to generate cover letter." })}\n\n`);
    res.end();
  }
});

export default router;
